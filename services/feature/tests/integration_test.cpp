#include <cassert>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#include <brpc/channel.h>
#include <brpc/controller.h>
#include <brpc/server.h>
#include <gflags/gflags.h>

#include "common/logger.h"
#include "feature.pb.h"
#include "feature_server.h"

constexpr int FEATURE_PORT = 18001;

namespace {

struct Scenario {
    const char* name;
    bool use_valid_user_id;
    bool use_valid_sku_ids;
    int expect_error_code;
    int expect_user_log_count;
    int expect_sku_feat_count;
};

static void run_scenario(const Scenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

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
    kr_req->set_user_id(s.use_valid_user_id ? 42 : 0);

    feature::UserFeatureResponse user_rsp;
    brpc::Controller user_ctrl;
    stub.GetUserFeatures(&user_ctrl, &user_req, &user_rsp, nullptr);
    assert(!user_ctrl.Failed());
    assert(user_rsp.error_code() == s.expect_error_code);
    assert(user_rsp.kr_feat_rsp().user_logs_size() == s.expect_user_log_count);

    feature::SKUFeatureRequest sku_req;
    sku_req.set_feature_type(feature::KuaiRand);
    if (s.use_valid_sku_ids) {
        sku_req.add_sku_ids(1001);
        sku_req.add_sku_ids(1002);
    }

    feature::SKUFeatureResponse sku_rsp;
    brpc::Controller sku_ctrl;
    stub.GetSKUFeatures(&sku_ctrl, &sku_req, &sku_rsp, nullptr);
    assert(!sku_ctrl.Failed());
    assert(sku_rsp.error_code() == s.expect_error_code);
    assert(sku_rsp.kr_sku_feats_size() == s.expect_sku_feat_count);

    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
}

}  // namespace

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();
    common::logger::AddConsoleSink();

    std::cout << "=== Feature Service Integration Tests ===" << std::endl;

    run_scenario({"happy path", true, true, 0, 10, 2});
    run_scenario({"empty user id", false, true, 0x01000001, 0, 2});
    run_scenario({"empty sku ids", true, false, 0x01000002, 10, 0});

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
