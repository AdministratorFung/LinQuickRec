// Precalc 服务集成测试
// 单进程启动 mock Discovery + PrecalcServiceImpl，通过 BRPC RPC 端到端验证

#include <cassert>
#include <chrono>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

#include <brpc/channel.h>
#include <brpc/controller.h>
#include <brpc/server.h>
#include <gflags/gflags.h>

#include "common/error.h"
#include "common/logger.h"
#include "precalc.pb.h"
#include "discovery.pb.h"

#include "mock_datasystem.h"

#define private public
#include "precalc_server.h"
#undef private

DECLARE_string(registry_backend);
DECLARE_string(discovery_addr);
DECLARE_string(etcd_endpoints);
DECLARE_string(kv_worker_service);
DECLARE_double(precalc_result_size_mb);
DECLARE_int32(ttl_seconds);
DECLARE_int32(user_feat_key_size_kb);
DECLARE_int32(payload_size_kb);
DECLARE_int32(precalc_sleep_time_ms);

constexpr int DISCOVERY_PORT    = 18103;
constexpr int PRECALC_PORT      = 18003;

namespace {

class MockDiscoveryService : public discovery::DiscoveryService {
public:
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
        if (request->service_name() == FLAGS_kv_worker_service) {
            auto* inst = response->add_instances();
            inst->set_service_name(FLAGS_kv_worker_service);
            inst->set_host("127.0.0.1");
            inst->set_port(31501);
            inst->set_status(discovery::UP);
        }
    }
};

struct Scenario {
    const char* name;
    std::string user_feat;
    std::string trace_id;
    int expect_error_code;
    bool expect_key_nonempty;
};

static void run_scenario(const Scenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

    MockDiscoveryService discovery_service;
    brpc::Server discovery_server;
    int ret = discovery_server.AddService(&discovery_service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);
    ret = discovery_server.Start(("127.0.0.1:" + std::to_string(DISCOVERY_PORT)).c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    FLAGS_registry_backend = "discovery_server";
    FLAGS_discovery_addr = "127.0.0.1:" + std::to_string(DISCOVERY_PORT);
    FLAGS_etcd_endpoints = "127.0.0.1:2379";
    FLAGS_kv_worker_service = "kv_worker";
    FLAGS_precalc_result_size_mb = 0.001;
    FLAGS_ttl_seconds = 5;
    FLAGS_payload_size_kb = 1;
    FLAGS_precalc_sleep_time_ms = 0;

    precalc::PrecalcServiceImpl service;
    brpc::Server server;
    ret = server.AddService(&service, brpc::SERVER_DOESNT_OWN_SERVICE);
    assert(ret == 0);
    std::string addr = "127.0.0.1:" + std::to_string(PRECALC_PORT);
    ret = server.Start(addr.c_str(), nullptr);
    assert(ret == 0);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.timeout_ms = 5000;
    opts.protocol = "baidu_std";
    ret = channel.Init(addr.c_str(), &opts);
    assert(ret == 0);
    precalc::PrecalcService_Stub stub(&channel);

    precalc::PrecalcRequest req;
    req.set_user_feat(s.user_feat);
    req.set_trace_id(s.trace_id);
    precalc::PrecalcResponse rsp;
    brpc::Controller cntl;
    stub.Precalculate(&cntl, &req, &rsp, nullptr);

    assert(!cntl.Failed());
    if (s.expect_error_code == 0) {
        assert(rsp.error_code() == 0);
        if (s.expect_key_nonempty) {
            assert(!rsp.user_feat_key().empty());
        }
    } else {
        assert(rsp.error_code() == s.expect_error_code);
    }

    std::cout << "[PASS]" << std::endl;

    server.Stop(0);
    server.Join();
    discovery_server.Stop(0);
    discovery_server.Join();
}

}  // namespace

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();

    std::cout << "=== Precalc Service Integration Tests ===" << std::endl;

    run_scenario({
        "happy path: valid user_feat",
        "mock_user_feature_data_for_testing",
        "trace_12345678abcd",
        0,
        true
    });

    run_scenario({
        "empty user_feat should fail",
        "",
        "trace_87654321dcba",
        static_cast<int>(common::error::precalc_errors::EMPTY_USER_FEAT),
        false
    });

    std::cout << "\n=== All Integration Tests Passed ===" << std::endl;
    return 0;
}
