#include <atomic>
#include <cassert>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include <brpc/channel.h>
#include <brpc/controller.h>
#include <brpc/server.h>
#include <gflags/gflags.h>

#include "common/error.h"
#include "common/logger.h"
#include "rank_sub.pb.h"
#include "rank_sub_server.h"

constexpr int RANK_SUB_PORT = 18005;

namespace {

struct Scenario {
    const char* name;
    std::string user_feat;
    std::vector<uint64_t> sku_ids;
    int expect_error_code;
    int expect_sku_count;
};

static void run_scenario(const Scenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

    FLAGS_rank_sub_sleep_time_ms = 0;

    rank::RankSubServiceImpl service;
    brpc::Server server;
    int ret = server.AddService(&service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);

    std::string addr = "127.0.0.1:" + std::to_string(RANK_SUB_PORT);
    ret = server.Start(addr.c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.timeout_ms = 5000;
    ret = channel.Init(addr.c_str(), &opts);
    assert(ret == 0);

    rank::RankSubService_Stub stub(&channel);
    rank::RankSubRequest req;
    req.set_trace_id("itest");
    req.set_user_feat(s.user_feat);
    for (uint64_t sku : s.sku_ids) {
        req.add_sku_ids(sku);
    }

    rank::RankSubResponse rsp;
    brpc::Controller cntl;
    stub.Rank(&cntl, &req, &rsp, nullptr);
    assert(!cntl.Failed());
    assert(rsp.error_code() == s.expect_error_code);
    if (s.expect_error_code == 0) {
        assert(rsp.skus_id_size() == s.expect_sku_count);
        assert(rsp.skus_score_size() == s.expect_sku_count);
        for (int i = 0; i < rsp.skus_id_size(); ++i) {
            assert(rsp.skus_id(i) == s.sku_ids[i]);
        }
    }

    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
}

static void run_concurrent_scenario(const char* name,
                                   const std::string& user_feat,
                                   const std::vector<uint64_t>& sku_ids,
                                   int thread_count,
                                   int expect_error_code) {
    std::cout << "\n--- " << name << " ---" << std::endl;

    FLAGS_rank_sub_sleep_time_ms = 0;

    rank::RankSubServiceImpl service;
    brpc::Server server;
    int ret = server.AddService(&service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);

    std::string addr = "127.0.0.1:" + std::to_string(RANK_SUB_PORT);
    ret = server.Start(addr.c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.timeout_ms = 5000;
    ret = channel.Init(addr.c_str(), &opts);
    assert(ret == 0);

    rank::RankSubService_Stub stub(&channel);

    std::atomic<int> ok{0};
    std::atomic<int> fail{0};

    std::vector<std::thread> threads;
    for (int i = 0; i < thread_count; ++i) {
        threads.emplace_back([&]() {
            rank::RankSubRequest req;
            req.set_trace_id("concurrent_test");
            req.set_user_feat(user_feat);
            for (uint64_t sku : sku_ids) {
                req.add_sku_ids(sku);
            }
            rank::RankSubResponse rsp;
            brpc::Controller cntl;
            stub.Rank(&cntl, &req, &rsp, nullptr);
            if (!cntl.Failed() && rsp.error_code() == expect_error_code) {
                ++ok;
            } else {
                ++fail;
            }
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    assert(ok == thread_count);
    assert(fail == 0);
    std::cout << "  concurrent " << thread_count << " threads: ok=" << ok << std::endl;
    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
}

}  // namespace

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();

    std::cout << "=== RankSub Service Integration Tests ===" << std::endl;

    run_scenario({"happy path",
        "user_feat_payload", {1001, 1002}, 0, 2});

    run_scenario({"empty user feat",
        "", {1001, 1002},
        static_cast<int>(common::error::rank_sub_errors::EMPTY_USER_FEAT_KEY), 0});

    run_scenario({"empty sku ids",
        "user_feat_payload", {},
        static_cast<int>(common::error::rank_sub_errors::EMPTY_SKUS_SUB), 0});

    run_scenario({"single sku",
        "user_feat_payload", {999999}, 0, 1});

    run_scenario({"sku_id is zero",
        "user_feat_payload", {0}, 0, 1});

    run_scenario({"large sku_id",
        "user_feat_payload", {UINT64_MAX}, 0, 1});

    run_scenario({"many sku_ids",
        "user_feat_payload", {1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000},
        0, 10});

    run_scenario({"large user_feat (10MB)",
        std::string(10 * 1024 * 1024, 'x'), {1001, 1002}, 0, 2});

    run_concurrent_scenario("concurrent happy path",
        "user_feat_payload", {1001, 1002}, 10, 0);

    run_concurrent_scenario("concurrent with empty user_feat",
        "", {1001, 1002}, 10,
        static_cast<int>(common::error::rank_sub_errors::EMPTY_USER_FEAT_KEY));

    run_concurrent_scenario("concurrent with empty sku_ids",
        "user_feat_payload", {}, 10,
        static_cast<int>(common::error::rank_sub_errors::EMPTY_SKUS_SUB));

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
