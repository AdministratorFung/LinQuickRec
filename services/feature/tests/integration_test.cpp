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
#include "feature.pb.h"
#include "feature_server.h"

constexpr int FEATURE_PORT = 18001;

namespace {

struct Scenario {
    const char* name;
    uint64_t user_id;
    std::vector<uint64_t> sku_ids;
    int expect_user_error_code;
    int expect_sku_error_code;
    int expect_user_log_count;
    int expect_sku_feat_count;
};

static void run_scenario(const Scenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

    FLAGS_feature_sleep_time_ms = 0;

    feature::FeatureServiceImpl service;
    brpc::Server server;
    int ret = server.AddService(&service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);

    std::string addr = "127.0.0.1:" + std::to_string(FEATURE_PORT);
    ret = server.Start(addr.c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.timeout_ms = 5000;
    ret = channel.Init(addr.c_str(), &opts);
    assert(ret == 0);

    feature::FeatureService_Stub stub(&channel);

    feature::UserFeatureRequest user_req;
    user_req.set_feature_type(feature::KuaiRand);
    auto* kr_req = user_req.mutable_kr_feat_req();
    kr_req->set_user_id(s.user_id);

    feature::UserFeatureResponse user_rsp;
    brpc::Controller user_ctrl;
    stub.GetUserFeatures(&user_ctrl, &user_req, &user_rsp, nullptr);
    assert(!user_ctrl.Failed());
    assert(user_rsp.error_code() == s.expect_user_error_code);
    if (s.expect_user_error_code == 0) {
        assert(user_rsp.kr_feat_rsp().user_logs_size() == s.expect_user_log_count);
    }

    feature::SKUFeatureRequest sku_req;
    sku_req.set_feature_type(feature::KuaiRand);
    for (uint64_t id : s.sku_ids) {
        sku_req.add_sku_ids(id);
    }

    feature::SKUFeatureResponse sku_rsp;
    brpc::Controller sku_ctrl;
    stub.GetSKUFeatures(&sku_ctrl, &sku_req, &sku_rsp, nullptr);
    assert(!sku_ctrl.Failed());
    assert(sku_rsp.error_code() == s.expect_sku_error_code);
    if (s.expect_sku_error_code == 0) {
        assert(sku_rsp.kr_sku_feats_size() == s.expect_sku_feat_count);
    }

    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
}

static void run_concurrent_scenario(const char* name,
                                     uint64_t user_id,
                                     const std::vector<uint64_t>& sku_ids,
                                     int thread_count,
                                     int expect_user_error_code,
                                     int expect_sku_error_code) {
    std::cout << "\n--- " << name << " ---" << std::endl;

    FLAGS_feature_sleep_time_ms = 0;

    feature::FeatureServiceImpl service;
    brpc::Server server;
    int ret = server.AddService(&service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);

    std::string addr = "127.0.0.1:" + std::to_string(FEATURE_PORT);
    ret = server.Start(addr.c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.timeout_ms = 5000;
    ret = channel.Init(addr.c_str(), &opts);
    assert(ret == 0);

    feature::FeatureService_Stub stub(&channel);

    std::atomic<int> user_ok{0};
    std::atomic<int> sku_ok{0};
    std::atomic<int> user_fail{0};
    std::atomic<int> sku_fail{0};

    std::vector<std::thread> threads;
    for (int i = 0; i < thread_count; ++i) {
        threads.emplace_back([&, i]() {
            feature::UserFeatureRequest user_req;
            user_req.set_feature_type(feature::KuaiRand);
            user_req.mutable_kr_feat_req()->set_user_id(user_id);
            feature::UserFeatureResponse user_rsp;
            brpc::Controller user_ctrl;
            stub.GetUserFeatures(&user_ctrl, &user_req, &user_rsp, nullptr);
            if (!user_ctrl.Failed() && user_rsp.error_code() == expect_user_error_code) {
                ++user_ok;
            } else {
                ++user_fail;
            }

            feature::SKUFeatureRequest sku_req;
            sku_req.set_feature_type(feature::KuaiRand);
            for (uint64_t id : sku_ids) {
                sku_req.add_sku_ids(id);
            }
            feature::SKUFeatureResponse sku_rsp;
            brpc::Controller sku_ctrl;
            stub.GetSKUFeatures(&sku_ctrl, &sku_req, &sku_rsp, nullptr);
            if (!sku_ctrl.Failed() && sku_rsp.error_code() == expect_sku_error_code) {
                ++sku_ok;
            } else {
                ++sku_fail;
            }
        });
    }

    for (auto& t : threads) {
        t.join();
    }

    assert(user_ok == thread_count);
    assert(user_fail == 0);
    assert(sku_ok == thread_count);
    assert(sku_fail == 0);

    std::cout << "  concurrent " << thread_count << " threads: "
              << "user_ok=" << user_ok << ", sku_ok=" << sku_ok << std::endl;
    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
}

}  // namespace

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();

    std::cout << "=== Feature Service Integration Tests ===" << std::endl;

    run_scenario({"happy path",
        42, {1001, 1002},
        0, 0, 10, 2});

    run_scenario({"user_id is zero",
        0, {1001, 1002},
        static_cast<int>(common::error::feature_errors::EMPTY_USER_ID), 0, 0, 2});

    run_scenario({"sku_ids is empty",
        42, {},
        0, static_cast<int>(common::error::feature_errors::EMPTY_SKU_IDS), 10, 0});

    run_scenario({"user_id zero and sku_ids empty",
        0, {},
        static_cast<int>(common::error::feature_errors::EMPTY_USER_ID),
        static_cast<int>(common::error::feature_errors::EMPTY_SKU_IDS), 0, 0});

    run_scenario({"single sku",
        42, {999999},
        0, 0, 10, 1});

    run_scenario({"sku_id is zero",
        42, {0},
        0, 0, 10, 1});

    run_scenario({"large sku_id",
        42, {UINT64_MAX},
        0, 0, 10, 1});

    run_scenario({"many sku_ids",
        42, {1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000},
        0, 0, 10, 10});

    run_concurrent_scenario("concurrent GetUserFeatures + GetSKUFeatures",
        42, {1001, 1002}, 10, 0, 0);

    run_concurrent_scenario("concurrent with empty user_id",
        0, {1001, 1002}, 10,
        static_cast<int>(common::error::feature_errors::EMPTY_USER_ID), 0);

    run_concurrent_scenario("concurrent with empty sku_ids",
        42, {}, 10, 0,
        static_cast<int>(common::error::feature_errors::EMPTY_SKU_IDS));

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
