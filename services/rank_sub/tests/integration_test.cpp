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
    assert(rsp.skus_id_size() == s.expect_sku_count);

    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
}

}  // namespace

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();
    common::logger::AddConsoleSink();

    std::cout << "=== RankSub Service Integration Tests ===" << std::endl;

    run_scenario({"happy path", "user_feat_payload", {1001, 1002}, 0, 2});
    run_scenario({"empty user feat", "", {1001, 1002}, 0x01000001, 0});
    run_scenario({"empty sku ids", "user_feat_payload", {}, 0x01000002, 0});

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
