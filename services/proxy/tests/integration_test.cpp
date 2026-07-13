#include <atomic>
#include <cassert>
#include <chrono>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include <brpc/channel.h>
#include <brpc/controller.h>
#include <brpc/server.h>
#include <gflags/gflags.h>

#include "common/logger.h"
#include "discovery.pb.h"
#include "feature.pb.h"
#include "precalc.pb.h"
#include "proxy_server.h"
#include "rank_master.pb.h"
#include "recall.pb.h"

DEFINE_string(registry_backend, "discovery_server", "");
DEFINE_string(discovery_addr, "127.0.0.1:18100", "");
DEFINE_string(etcd_endpoints, "127.0.0.1:2379", "");
DEFINE_string(feature_service_name, "feature_service", "");
DEFINE_string(recall_service_name, "recall_service", "");
DEFINE_string(precalc_service_name, "precalc_service", "");
DEFINE_string(rank_service_name, "rank_service", "");
DEFINE_int32(discovery_refresh_interval_ms, 100, "");
DEFINE_int32(downstream_max_retries, 0, "");
DECLARE_int32(top_k);
DECLARE_int32(rank_master_parallelism);
DECLARE_string(downstream_connection_type);

constexpr int DISCOVERY_PORT    = 18100;
constexpr int MOCK_FEATURE_PORT = 18001;
constexpr int MOCK_RECALL_PORT  = 18002;
constexpr int MOCK_PRECALC_PORT = 18003;
constexpr int MOCK_RANK_PORT    = 18004;

class MockDiscoveryService : public discovery::DiscoveryService {
public:
    void Register(google::protobuf::RpcController*,
                  const discovery::RegisterRequest* request,
                  discovery::RegisterResponse* response,
                  google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        {
            std::lock_guard<std::mutex> lock(mutex_);
            instances_[request->instance().service_name()].push_back(request->instance());
        }
        response->set_success(true);
        response->set_instance_id(
            request->instance().service_name() + "_" +
            request->instance().host() + "_" +
            std::to_string(request->instance().port()) + "_1");
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
        std::lock_guard<std::mutex> lock(mutex_);
        auto it = instances_.find(request->service_name());
        if (it != instances_.end()) {
            for (const auto& inst : it->second) {
                auto* added = response->add_instances();
                added->CopyFrom(inst);
                added->set_status(discovery::UP);
            }
        }
    }

private:
    std::mutex mutex_;
    std::unordered_map<std::string, std::vector<discovery::ServiceInstance>> instances_;
};

class MockFeatureService : public feature::FeatureService {
public:
    void GetUserFeatures(google::protobuf::RpcController*,
                         const feature::UserFeatureRequest*,
                         feature::UserFeatureResponse* response,
                         google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_feature_type(feature::KuaiRand);
        auto* kr_rsp = response->mutable_kr_feat_rsp();
        kr_rsp->set_payload("mock_feat_payload");
        auto* log = kr_rsp->add_user_logs();
        log->add_vec(10);
        log->add_vec(20);
        log->add_vec(30);
    }
    void GetSKUFeatures(google::protobuf::RpcController*,
                        const feature::SKUFeatureRequest*,
                        feature::SKUFeatureResponse*,
                        google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
    }
};

class MockRecallService : public recall::RecallService {
public:
    void Recall(google::protobuf::RpcController*,
                const recall::RecallRequest*,
                recall::RecallResponse* response,
                google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->add_sku_ids(1001);
        response->add_sku_ids(1002);
        response->add_sku_ids(1003);
    }
};

class MockPrecalcService : public precalc::PrecalcService {
public:
    void Precalculate(google::protobuf::RpcController*,
                       const precalc::PrecalcRequest*,
                       precalc::PrecalcResponse* response,
                       google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_user_feat_key("mock_feat_key_abc123");
        response->set_payload("mock_payload_data");
    }
};

class MockRankService : public rank::RankMasterService {
public:
    void Rank(google::protobuf::RpcController*,
               const rank::RankMasterRequest* request,
               rank::RankMasterResponse* response,
               google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        for (int i = 0; i < request->sku_ids_size(); ++i) {
            response->add_candidates(request->sku_ids(i));
            response->add_scores(1000 - i);
        }
    }
};

class MockFeatureServiceFailing : public feature::FeatureService {
public:
    void GetUserFeatures(google::protobuf::RpcController* cntl,
                         const feature::UserFeatureRequest*,
                         feature::UserFeatureResponse*,
                         google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock feature failure");
    }
    void GetSKUFeatures(google::protobuf::RpcController*,
                        const feature::SKUFeatureRequest*,
                        feature::SKUFeatureResponse*,
                        google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
    }
};

class MockRecallServiceFailing : public recall::RecallService {
public:
    void Recall(google::protobuf::RpcController* cntl,
                const recall::RecallRequest*,
                recall::RecallResponse*,
                google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock recall failure");
    }
};

class MockPrecalcServiceFailing : public precalc::PrecalcService {
public:
    void Precalculate(google::protobuf::RpcController* cntl,
                       const precalc::PrecalcRequest*,
                       precalc::PrecalcResponse*,
                       google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock precalc failure");
    }
};

class MockRankServiceFailing : public rank::RankMasterService {
public:
    void Rank(google::protobuf::RpcController* cntl,
               const rank::RankMasterRequest*,
               rank::RankMasterResponse*,
               google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock rank failure");
    }
};

class MockRankServiceEmpty : public rank::RankMasterService {
public:
    void Rank(google::protobuf::RpcController*,
               const rank::RankMasterRequest*,
               rank::RankMasterResponse* response,
               google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
    }
};

class MockPrecalcServiceLargePayload : public precalc::PrecalcService {
public:
    void Precalculate(google::protobuf::RpcController*,
                       const precalc::PrecalcRequest*,
                       precalc::PrecalcResponse* response,
                       google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_user_feat_key("large_key");
        response->set_payload(std::string(5 * 1024 * 1024, 'X'));
    }
};

class MockMultiServiceFailing :
        public feature::FeatureService,
        public recall::RecallService,
        public precalc::PrecalcService,
        public rank::RankMasterService {
public:
    void GetUserFeatures(google::protobuf::RpcController* cntl,
                         const feature::UserFeatureRequest*,
                         feature::UserFeatureResponse*,
                         google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock multi-service failure");
    }
    void GetSKUFeatures(google::protobuf::RpcController*,
                        const feature::SKUFeatureRequest*,
                        feature::SKUFeatureResponse*,
                        google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
    }
    void Recall(google::protobuf::RpcController* cntl,
                const recall::RecallRequest*,
                recall::RecallResponse*,
                google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock multi-service failure");
    }
    void Precalculate(google::protobuf::RpcController* cntl,
                       const precalc::PrecalcRequest*,
                       precalc::PrecalcResponse*,
                       google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock multi-service failure");
    }
    void Rank(google::protobuf::RpcController* cntl,
               const rank::RankMasterRequest*,
               rank::RankMasterResponse*,
               google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        cntl->SetFailed("mock multi-service failure");
    }
};

class MockRecallServiceEmpty : public recall::RecallService {
public:
    void Recall(google::protobuf::RpcController*,
                const recall::RecallRequest*,
                recall::RecallResponse* response,
                google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
    }
};

class MockFeatureServiceEmptyPayload : public feature::FeatureService {
public:
    void GetUserFeatures(google::protobuf::RpcController*,
                         const feature::UserFeatureRequest*,
                         feature::UserFeatureResponse* response,
                         google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
        response->set_feature_type(feature::KuaiRand);
        response->mutable_kr_feat_rsp()->set_payload("");
    }
    void GetSKUFeatures(google::protobuf::RpcController*,
                        const feature::SKUFeatureRequest*,
                        feature::SKUFeatureResponse*,
                        google::protobuf::Closure* done) override {
        brpc::ClosureGuard guard(done);
    }
};

struct ServerSet {
    brpc::Server discovery_svr;
    brpc::Server feature_svr;
    brpc::Server recall_svr;
    brpc::Server precalc_svr;
    brpc::Server rank_svr;
};

static bool start_server(brpc::Server* server, int port, google::protobuf::Service* svc) {
    if (server->AddService(svc, brpc::SERVER_DOESNT_OWN_SERVICE) != 0) {
        return false;
    }
    std::string addr = "0.0.0.0:" + std::to_string(port);
    if (server->Start(addr.c_str(), nullptr) != 0) {
        return false;
    }
    return true;
}

static void stop_all(ServerSet& svrs) {
    svrs.discovery_svr.Stop(0); svrs.discovery_svr.Join();
    svrs.feature_svr.Stop(0); svrs.feature_svr.Join();
    svrs.recall_svr.Stop(0); svrs.recall_svr.Join();
    svrs.precalc_svr.Stop(0); svrs.precalc_svr.Join();
    svrs.rank_svr.Stop(0); svrs.rank_svr.Join();
}

static bool register_service(discovery::DiscoveryService_Stub& stub,
                             const std::string& name,
                             const std::string& host, int port) {
    for (int attempt = 0; attempt < 20; ++attempt) {
        discovery::RegisterRequest req;
        req.mutable_instance()->set_service_name(name);
        req.mutable_instance()->set_host(host);
        req.mutable_instance()->set_port(port);
        req.mutable_instance()->set_status(discovery::UP);
        req.set_heartbeat_interval_sec(60);
        discovery::RegisterResponse rsp;
        brpc::Controller cntl;
        cntl.set_timeout_ms(3000);
        stub.Register(&cntl, &req, &rsp, nullptr);
        if (!cntl.Failed() && rsp.success()) {
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    return false;
}

struct TestScenario {
    const char* name;
    feature::FeatureService* feature_svc;
    recall::RecallService* recall_svc;
    precalc::PrecalcService* precalc_svc;
    rank::RankMasterService* rank_svc;
    int expect_candidates;
    int expect_error_code;
};

static void run_scenario(const TestScenario& s) {
    std::cout << "\n--- " << s.name << " ---" << std::endl;

    MockFeatureService   default_feat;
    MockRecallService  default_recall;
    MockPrecalcService default_precalc;
    MockRankService   default_rank;
    MockDiscoveryService mock_discovery;

    feature::FeatureService* f = s.feature_svc ? s.feature_svc : &default_feat;
    recall::RecallService* r = s.recall_svc ? s.recall_svc : &default_recall;
    precalc::PrecalcService* p = s.precalc_svc ? s.precalc_svc : &default_precalc;
    rank::RankMasterService* k = s.rank_svc ? s.rank_svc : &default_rank;

    ServerSet svrs;
    assert(start_server(&svrs.discovery_svr, DISCOVERY_PORT,    &mock_discovery));
    assert(start_server(&svrs.feature_svr,  MOCK_FEATURE_PORT, f));
    assert(start_server(&svrs.recall_svr,   MOCK_RECALL_PORT,  r));
    assert(start_server(&svrs.precalc_svr, MOCK_PRECALC_PORT, p));
    assert(start_server(&svrs.rank_svr,    MOCK_RANK_PORT,    k));
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    brpc::Channel ch;
    brpc::ChannelOptions copts;
    copts.timeout_ms = 3000;
    copts.protocol = "baidu_std";
    assert(ch.Init(("127.0.0.1:" + std::to_string(DISCOVERY_PORT)).c_str(), &copts) == 0);
    discovery::DiscoveryService_Stub stub(&ch);
    assert(register_service(stub, FLAGS_feature_service_name,  "127.0.0.1", MOCK_FEATURE_PORT));
    assert(register_service(stub, FLAGS_recall_service_name,   "127.0.0.1", MOCK_RECALL_PORT));
    assert(register_service(stub, FLAGS_precalc_service_name, "127.0.0.1", MOCK_PRECALC_PORT));
    assert(register_service(stub, FLAGS_rank_service_name,    "127.0.0.1", MOCK_RANK_PORT));
    std::this_thread::sleep_for(std::chrono::milliseconds(200));

    proxy::ProxyServiceImpl proxy_impl;
    std::this_thread::sleep_for(std::chrono::milliseconds(1000));

    proxy::RecommendRequest req;
    req.set_user_id(42);
    req.set_payload("test_payload");
    proxy::RecommendResponse rsp;
    proxy_impl.Recommend(nullptr, &req, &rsp, nullptr);

    assert(rsp.error_code() == s.expect_error_code);
    assert(rsp.candidates_size() == s.expect_candidates);
    if (s.expect_error_code != 0) {
        assert(!rsp.error_message().empty());
        std::cout << "  error_code=0x" << std::hex << rsp.error_code() << std::dec
                  << " message=" << rsp.error_message() << std::endl;
    } else {
        std::cout << "  candidates=[";
        for (int i = 0; i < rsp.candidates_size(); ++i) {
            if (i > 0) std::cout << ",";
            std::cout << rsp.candidates(i);
        }
        std::cout << "]" << std::endl;
    }
    std::cout << "[PASS]" << std::endl;

    stop_all(svrs);
}

int main(int argc, char* argv[]) {
    google::ParseCommandLineFlags(&argc, &argv, true);
    common::logger::InitializeDefault();
    std::cout << "=== Proxy Integration Tests ===" << std::endl;

    MockFeatureServiceFailing mock_feat_fail;
    MockRecallServiceFailing mock_recall_fail;
    MockPrecalcServiceFailing mock_precalc_fail;
    MockRankServiceFailing mock_rank_fail;
    MockRecallServiceEmpty mock_recall_empty;
    MockFeatureServiceEmptyPayload mock_feat_empty;
    MockRankServiceEmpty mock_rank_empty;
    MockPrecalcServiceLargePayload mock_precalc_large;

    run_scenario({"Happy path",
        nullptr, nullptr, nullptr, nullptr, 3, 0});

    run_scenario({"Feature fails",
        &mock_feat_fail,
        nullptr, nullptr, nullptr, 0, 0x01030001});

    run_scenario({"Recall fails",
        nullptr,
        &mock_recall_fail,
        nullptr, nullptr, 0, 0x01030002});

    run_scenario({"Precalc fails",
        nullptr, nullptr,
        &mock_precalc_fail,
        nullptr, 0, 0x01030003});

    run_scenario({"Rank fails",
        nullptr, nullptr, nullptr,
        &mock_rank_fail,
        0, 0x01030004});

    run_scenario({"Recall returns empty SKUs",
        nullptr,
        &mock_recall_empty,
        nullptr, nullptr, 0, 0x01030004});

    run_scenario({"Feature returns empty payload",
        &mock_feat_empty,
        nullptr, nullptr, nullptr, 3, 0});

    run_scenario({"Rank returns empty candidates",
        nullptr, nullptr, nullptr,
        &mock_rank_empty,
        0, 0x01030004});

    run_scenario({"Precalc returns large payload (5MB)",
        nullptr, nullptr,
        &mock_precalc_large,
        nullptr, 3, 0});

    std::cout << "\n--- Multi-service failure (Feature fails first) ---" << std::endl;
    {
        MockFeatureServiceFailing fail_feat;
        MockRecallServiceFailing fail_recall;
        MockPrecalcServiceFailing fail_precalc;
        MockRankServiceFailing fail_rank;
        MockDiscoveryService mock_discovery;
        ServerSet svrs;
        assert(start_server(&svrs.discovery_svr, DISCOVERY_PORT,    &mock_discovery));
        assert(start_server(&svrs.feature_svr,  MOCK_FEATURE_PORT, &fail_feat));
        assert(start_server(&svrs.recall_svr,   MOCK_RECALL_PORT,  &fail_recall));
        assert(start_server(&svrs.precalc_svr, MOCK_PRECALC_PORT, &fail_precalc));
        assert(start_server(&svrs.rank_svr,    MOCK_RANK_PORT,    &fail_rank));
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        brpc::Channel ch;
        brpc::ChannelOptions copts;
        copts.timeout_ms = 3000;
        copts.protocol = "baidu_std";
        assert(ch.Init(("127.0.0.1:" + std::to_string(DISCOVERY_PORT)).c_str(), &copts) == 0);
        discovery::DiscoveryService_Stub stub(&ch);
        assert(register_service(stub, FLAGS_feature_service_name,  "127.0.0.1", MOCK_FEATURE_PORT));
        assert(register_service(stub, FLAGS_recall_service_name,   "127.0.0.1", MOCK_RECALL_PORT));
        assert(register_service(stub, FLAGS_precalc_service_name, "127.0.0.1", MOCK_PRECALC_PORT));
        assert(register_service(stub, FLAGS_rank_service_name,    "127.0.0.1", MOCK_RANK_PORT));
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        proxy::ProxyServiceImpl proxy_impl;
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));
        proxy::RecommendRequest req;
        req.set_user_id(1);
        proxy::RecommendResponse rsp;
        proxy_impl.Recommend(nullptr, &req, &rsp, nullptr);
        assert(rsp.error_code() == 0x01030001);
        assert(rsp.candidates_size() == 0);
        std::cout << "  error_code=0x" << std::hex << rsp.error_code() << std::dec
                  << " message=" << rsp.error_message() << std::endl;
        std::cout << "[PASS] multi-service failure returns Feature error" << std::endl;
        stop_all(svrs);
    }

    std::cout << "\n--- Concurrent requests (5 threads) ---" << std::endl;
    {
        MockFeatureService   default_feat;
        MockRecallService  default_recall;
        MockPrecalcService default_precalc;
        MockRankService   default_rank;
        MockDiscoveryService mock_discovery;
        ServerSet svrs;
        assert(start_server(&svrs.discovery_svr, DISCOVERY_PORT,    &mock_discovery));
        assert(start_server(&svrs.feature_svr,  MOCK_FEATURE_PORT, &default_feat));
        assert(start_server(&svrs.recall_svr,   MOCK_RECALL_PORT,  &default_recall));
        assert(start_server(&svrs.precalc_svr, MOCK_PRECALC_PORT, &default_precalc));
        assert(start_server(&svrs.rank_svr,    MOCK_RANK_PORT,    &default_rank));
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        brpc::Channel ch;
        brpc::ChannelOptions copts;
        copts.timeout_ms = 3000;
        copts.protocol = "baidu_std";
        assert(ch.Init(("127.0.0.1:" + std::to_string(DISCOVERY_PORT)).c_str(), &copts) == 0);
        discovery::DiscoveryService_Stub stub(&ch);
        assert(register_service(stub, FLAGS_feature_service_name,  "127.0.0.1", MOCK_FEATURE_PORT));
        assert(register_service(stub, FLAGS_recall_service_name,   "127.0.0.1", MOCK_RECALL_PORT));
        assert(register_service(stub, FLAGS_precalc_service_name, "127.0.0.1", MOCK_PRECALC_PORT));
        assert(register_service(stub, FLAGS_rank_service_name,    "127.0.0.1", MOCK_RANK_PORT));
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
        proxy::ProxyServiceImpl proxy_impl;
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));

        std::atomic<int> done_count{0};
        std::mutex err_mutex;
        std::string err_msg;
        std::vector<std::thread> threads;
        for (int i = 0; i < 5; ++i) {
            threads.emplace_back([&proxy_impl, i, &done_count, &err_mutex, &err_msg]() {
                proxy::RecommendRequest req;
                req.set_user_id(100 + i);
                req.set_payload("concurrent_payload");
                proxy::RecommendResponse rsp;
                proxy_impl.Recommend(nullptr, &req, &rsp, nullptr);
                if (rsp.error_code() != 0 || rsp.candidates_size() != 3) {
                    std::lock_guard<std::mutex> lock(err_mutex);
                    err_msg = "thread=" + std::to_string(i) +
                              " error_code=0x" + std::to_string(rsp.error_code()) +
                              " candidates=" + std::to_string(rsp.candidates_size());
                }
                ++done_count;
            });
        }
        for (auto& t : threads) t.join();
        assert(done_count == 5);
        assert(err_msg.empty());
        std::cout << "  5 concurrent requests completed successfully" << std::endl;
        std::cout << "[PASS]" << std::endl;
        stop_all(svrs);
    }

    std::cout << "\n=== All Proxy Integration Tests Passed ===" << std::endl;
    return 0;
}
