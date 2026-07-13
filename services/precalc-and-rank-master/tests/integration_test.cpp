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
DEFINE_int32(rank_master_sleep_time_ms, 30, "");

constexpr int DISCOVERY_PORT = 18100;
constexpr int RANK_MASTER_PORT = 18004;
constexpr int RANK_SUB_PORT = 18005;

namespace {

enum class RankSubMode { NORMAL, EMPTY, LARGE, ERROR };

enum class DiscoveryMode { NORMAL, RANK_SUB_NOT_FOUND };

class MockDiscoveryService : public discovery::DiscoveryService {
public:
    MockDiscoveryService(DiscoveryMode mode) : mode_(mode) {}

    void Register(google::protobuf::RpcController*,
                  const discovery::RegisterRequest*,
                  discovery::RegisterResponse* response,
                  google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_success(true);
    }

    void Deregister(google::protobuf::RpcController*,
                    const discovery::DeregisterRequest*,
                    discovery::DeregisterResponse* response,
                    google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_success(true);
    }

    void Heartbeat(google::protobuf::RpcController*,
                   const discovery::HeartbeatRequest*,
                   discovery::HeartbeatResponse* response,
                   google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_success(true);
        response->set_needs_reregister(false);
    }

    void Discover(google::protobuf::RpcController*,
                 const discovery::DiscoverRequest* request,
                 discovery::DiscoverResponse* response,
                 google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        if (mode_ == DiscoveryMode::RANK_SUB_NOT_FOUND) {
            return;
        }
        if (request->service_name() == "rank_sub") {
            auto* inst = response->add_instances();
            inst->set_service_name("rank_sub");
            inst->set_host("127.0.0.1");
            inst->set_port(RANK_SUB_PORT);
            inst->set_status(discovery::UP);
        }
    }

private:
    DiscoveryMode mode_;
};

class MockRankSubService : public rank::RankSubService {
public:
    MockRankSubService(RankSubMode mode) : mode_(mode) {}

    void Rank(google::protobuf::RpcController*,
              const rank::RankSubRequest* request,
              rank::RankSubResponse* response,
              google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        if (mode_ == RankSubMode::EMPTY) {
            return;
        }
        if (mode_ == RankSubMode::LARGE) {
            for (uint64_t i = 0; i < 1000; ++i) {
                response->add_skus_id(i);
                response->add_skus_score(1000 + i);
            }
            return;
        }
        for (int i = 0; i < request->sku_ids_size(); ++i) {
            response->add_skus_id(request->sku_ids(i));
            response->add_skus_score(1000 + i);
        }
    }

private:
    RankSubMode mode_;
};

struct Scenario {
    const char* name;
    std::string user_feat_key;
    std::vector<uint64_t> sku_ids;
    int expect_error_code;
    int expect_candidate_count;
    DiscoveryMode discovery_mode;
    RankSubMode rank_sub_mode;
    datasystem::KVErrorMode kv_error_mode;
};

static void run_scenario(const Scenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

    MockDiscoveryService discovery_service(s.discovery_mode);
    brpc::Server discovery_server;
    int ret = discovery_server.AddService(&discovery_service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);
    ret = discovery_server.Start(("127.0.0.1:" + std::to_string(DISCOVERY_PORT)).c_str(), nullptr);
    assert(ret == 0);

    MockRankSubService mock_sub(s.rank_sub_mode);
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
    FLAGS_rank_master_sleep_time_ms = 0;

    datasystem::KVClient::mock_data_.clear();
    if (!s.user_feat_key.empty()) {
        datasystem::KVClient::mock_data_[s.user_feat_key] = "mock_user_feature_data";
    }
    datasystem::KVClient::SetKVErrorMode(s.kv_error_mode);

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

    run_scenario({
        "happy path",
        "user_feat_key",
        {1001, 1002},
        0, 2,
        DiscoveryMode::NORMAL, RankSubMode::NORMAL,
        datasystem::KVErrorMode::NONE
    });

    run_scenario({
        "empty user feat key",
        "",
        {1001, 1002},
        0x01000001, 0,
        DiscoveryMode::NORMAL, RankSubMode::NORMAL,
        datasystem::KVErrorMode::NONE
    });

    run_scenario({
        "empty sku ids",
        "user_feat_key",
        {},
        0x01000002, 0,
        DiscoveryMode::NORMAL, RankSubMode::NORMAL,
        datasystem::KVErrorMode::NONE
    });

    run_scenario({
        "RankSub not discovered (Discover failed)",
        "user_feat_key",
        {1001, 1002},
        0x01000004, 0,
        DiscoveryMode::RANK_SUB_NOT_FOUND, RankSubMode::NORMAL,
        datasystem::KVErrorMode::NONE
    });

    run_scenario({
        "RankSub returns empty results",
        "user_feat_key",
        {1001, 1002},
        0, 0,
        DiscoveryMode::NORMAL, RankSubMode::EMPTY,
        datasystem::KVErrorMode::NONE
    });

    run_scenario({
        "RankSub returns large number of candidates (1000)",
        "user_feat_key",
        {1},
        0, 1000,
        DiscoveryMode::NORMAL, RankSubMode::LARGE,
        datasystem::KVErrorMode::NONE
    });

    run_scenario({
        "KVClient.Get() key not found",
        "nonexistent_key",
        {1001, 1002},
        0x01000006, 0,
        DiscoveryMode::NORMAL, RankSubMode::NORMAL,
        datasystem::KVErrorMode::NONE
    });

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
