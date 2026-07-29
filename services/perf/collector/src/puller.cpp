#include <brpc/channel.h>
#include <brpc/controller.h>

#include "perf_handler.pb.h"

#include <chrono>
#include <future>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "common/logger.h"
#include "common/perf_registry.h"
#include "common/service_discovery.h"
#include "common/thread_pool.h"
#include "series_manager.h"
#include "sqlite_store.h"
#include "stats_engine.h"

DEFINE_bool(use_ub, false, "Enable UBSocket/URMA transport");

namespace perf {

namespace {

const std::vector<std::string> kTargetServices = {
    "proxy",
    "feature_service",
    "recall_service",
    "precalc_service",
    "rank_service",
    "rank_sub",
};

common::perf::Span SpanFromProto(const common::perf::PerfSpan& pb) {
    common::perf::Span s;
    s.ts_us = pb.ts_us();
    s.SetService(pb.service());
    s.SetStage(pb.stage());
    s.SetMetric(pb.metric());
    s.SetTraceId(pb.trace_id());
    s.duration_ms = static_cast<float>(pb.duration_ms());
    s.SetStatus(pb.status());
    return s;
}

struct PullResult {
    std::string service_name;
    std::vector<common::perf::Span> spans;
    uint64_t dropped = 0;
    bool success = false;
};

struct PullTarget {
    std::string service_name;
    std::string host;
    int port;
};

class Puller {
public:
    Puller(std::shared_ptr<common::ServiceDiscovery> discovery,
           SqliteStore* sqlite, int retention_days)
        : discovery_(std::move(discovery))
        , sqlite_(sqlite)
        , retention_days_(retention_days)
        , pool_(std::make_unique<common::ThreadPool>(8)) {}

    void Start() {
        LOG_INFO << "Puller started, pulling from "
                 << kTargetServices.size() << " services every 1s";

        std::vector<common::perf::Span> batch;
        uint64_t cycle_count = 0;

        while (true) {
            auto start = std::chrono::steady_clock::now();

            std::vector<PullTarget> targets;
            for (const auto& svc : kTargetServices) {
                std::vector<common::InstanceInfo> instances;
                discovery_->GetAllInstances(svc, instances);
                for (const auto& inst : instances) {
                    targets.push_back({svc, inst.host, inst.port});
                }
            }

            std::vector<std::future<PullResult>> futures;
            for (const auto& t : targets) {
                futures.push_back(pool_->submit(
                    [this, &t]() { return PullOne(t.service_name, t.host, t.port); }));
            }

            batch.clear();
            for (auto& f : futures) {
                auto result = f.get();
                if (result.success) {
                    LOG_INFO << "Puller: pulled " << result.spans.size()
                             << " spans from " << result.service_name;
                    for (auto& s : result.spans) {
                        StatsEngine::Instance().Push(
                            s.service, s.stage, s.duration_ms);
                        batch.push_back(std::move(s));
                    }
                    if (SeriesManager::Instance().ActiveSeriesId() != 0) {
                        SeriesManager::Instance().IncrementSpanCount();
                    }
                    if (result.dropped > 0) {
                        LOG_WARN << "Ring buffer overflow on "
                                 << result.service_name
                                 << ": " << result.dropped << " spans dropped";
                    }
                } else {
                    LOG_ERROR << "Failed to pull /debug/perf from "
                              << result.service_name;
                }
            }

            if (!batch.empty()) {
                sqlite_->Flush(batch);
            }

            if (++cycle_count % 60 == 0) {
                sqlite_->Cleanup(retention_days_ > 0
                    ? static_cast<int64_t>(retention_days_) * 24 * 3600 : 0);
            }

            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - start).count();
            auto sleep_ms = std::max<int64_t>(0, 1000 - elapsed);
            std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
        }
    }

private:
    PullResult PullOne(const std::string& service_name,
                       const std::string& host, int port) {
        std::string addr = host + ":" + std::to_string(port);
        PullResult result;
        result.service_name = service_name;

        std::shared_ptr<brpc::Channel> channel;
        {
            std::lock_guard<std::mutex> lock(channel_mutex_);
            auto it = channels_.find(addr);
            if (it != channels_.end()) {
                channel = it->second;
            }
        }
        if (!channel) {
            channel = std::make_shared<brpc::Channel>();
            brpc::ChannelOptions opts;
            opts.protocol = "baidu_std";
            opts.timeout_ms = 2000;
            opts.use_ub = FLAGS_use_ub;
            opts.connection_type = "pooled";
            opts.max_retry = 0;
            if (channel->Init(addr.c_str(), &opts) != 0) {
                LOG_WARN << "Puller: channel init failed for " << addr;
                return result;
            }
            std::lock_guard<std::mutex> lock(channel_mutex_);
            channels_[addr] = channel;
        }

        common::perf::Perf_Stub stub(channel.get());
        common::perf::PerfRequest req;
        common::perf::PerfResponse rsp;
        brpc::Controller cntl;
        stub.Dump(&cntl, &req, &rsp, nullptr);

        if (cntl.Failed()) {
            LOG_WARN << "Puller: RPC failed for " << addr
                     << ": " << cntl.ErrorText();
            return result;
        }

        result.dropped = rsp.dropped();
        for (const auto& pb : rsp.spans()) {
            result.spans.push_back(SpanFromProto(pb));
        }
        result.success = true;
        return result;
    }

    std::shared_ptr<common::ServiceDiscovery> discovery_;
    SqliteStore* sqlite_;
    int retention_days_;

    std::mutex channel_mutex_;
    std::unordered_map<std::string, std::shared_ptr<brpc::Channel>> channels_;

    std::unique_ptr<common::ThreadPool> pool_;
};

} // namespace

void StartPuller(std::shared_ptr<common::ServiceDiscovery> discovery,
                 SqliteStore* sqlite,
                 int retention_days) {
    Puller puller(std::move(discovery), sqlite, retention_days);
    puller.Start();
}

} // namespace perf
