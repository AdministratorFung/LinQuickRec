#include <cassert>
#include <chrono>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <brpc/channel.h>
#include <brpc/controller.h>
#include <brpc/server.h>
#include <gflags/gflags.h>

#include "common/logger.h"
#include "discovery.pb.h"
#include "rank_master.pb.h"
#include "rank_sub.pb.h"

#include "mock_datasystem.h"

#define private public
#include "rank_master_server.h"
#undef private

DECLARE_string(registry_backend);
DECLARE_string(discovery_addr);
DECLARE_string(etcd_endpoints);
DEFINE_int32(discovery_refresh_interval_ms, 5000, "");
DECLARE_string(sub_worker_service_type);
DECLARE_int32(sub_worker_timeout_ms);
DECLARE_string(sub_worker_connection_type);

constexpr int DISCOVERY_PORT = 18100;
constexpr int RANK_MASTER_PORT = 18004;
constexpr int RANK_SUB_PORT = 18005;

namespace {

class MockDiscoveryService : public discovery::DiscoveryService {
public:
    void Register(google::protobuf::RpcController* cntl,
                  const discovery::RegisterRequest* request,
                  discovery::RegisterResponse* response,
                  google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_success(true);
    }

    void Deregister(google::protobuf::RpcController* cntl,
                    const discovery::DeregisterRequest* request,
                    discovery::DeregisterResponse* response,
                    google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_success(true);
    }

    void Heartbeat(google::protobuf::RpcController* cntl,
                   const discovery::HeartbeatRequest* request,
                   discovery::HeartbeatResponse* response,
                   google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_success(true);
        response->set_needs_reregister(false);
    }

    void Discover(google::protobuf::RpcController* cntl,
                 const discovery::DiscoverRequest* request,
                 discovery::DiscoverResponse* response,
                 google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        if (request->service_name() == "rank_sub") {
            auto* inst = response->add_instances();
            inst->set_service_name("rank_sub");
            inst->set_host("127.0.0.1");
            inst->set_port(RANK_SUB_PORT);
            inst->set_status(discovery::UP);
        }
    }
};

class MockRankSubService : public rank::RankSubService {
public:
    void Rank(google::protobuf::RpcController* cntl,
              const rank::RankSubRequest* request,
              rank::RankSubResponse* response,
              google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        for (int i = 0; i < request->sku_ids_size(); ++i) {
            response->add_skus_id(request->sku_ids(i));
            response->add_skus_score(1000 + i);
        }
    }
};

struct Scenario {
    const char* name;
    std::string user_feat_key;
    std::vector<uint64_t> sku_ids;
    int expect_error_code;
    int expect_candidate_count;
};

static void run_scenario(const Scenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

    MockDiscoveryService discovery_service;
    brpc::Server discovery_server;
    int ret = discovery_server.AddService(&discovery_service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);
    ret = discovery_server.Start(("127.0.0.1:" + std::to_string(DISCOVERY_PORT)).c_str(), nullptr);
    assert(ret == 0);

    MockRankSubService mock_sub;
    brpc::Server sub_server;
    ret = sub_server.AddService(&mock_sub, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);
    ret = sub_server.Start(("127.0.0.1:" + std::to_string(RANK_SUB_PORT)).c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    FLAGS_registry_backend = "discovery_server";
    FLAGS_discovery_addr = "127.0.0.1:" + std::to_string(DISCOVERY_PORT);
    FLAGS_etcd_endpoints = "127.0.0.1:2379";
    FLAGS_discovery_refresh_interval_ms = 100;
    FLAGS_sub_worker_service_type = "rank_sub";
    FLAGS_sub_worker_timeout_ms = 5000;
    FLAGS_sub_worker_connection_type = "pooled";

    datasystem::KVClient::mock_data_["user_feat_key"] = "mock_user_feature_data";

    rank::RankMasterServiceImpl service;

    rank::RankMasterRequest req;
    req.set_user_feat_key(s.user_feat_key);
    req.set_trace_id("itest");
    for (uint64_t sku : s.sku_ids) {
        req.add_sku_ids(sku);
    }

    rank::RankMasterResponse rsp;
    auto status = service.process_rank_request(&req, &rsp);
    if (s.expect_error_code == 0) {
        assert(status.IsOk());
    } else {
        assert(status.IsError());
        assert(static_cast<int>(status.Code()) == s.expect_error_code);
    }

    std::cout << "[PASS]" << std::endl;

    discovery_server.Stop(0);
    discovery_server.Join();
    sub_server.Stop(0);
    sub_server.Join();
}

}  // namespace

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();

    std::cout << "=== RankMaster Service Integration Tests ===" << std::endl;

    run_scenario({"happy path", "user_feat_key", {1001, 1002}, 0, 2});
    run_scenario({"empty user feat key", "", {1001, 1002}, 0x01000001, 0});
    run_scenario({"empty sku ids", "user_feat_key", {}, 0x01000002, 0});

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
