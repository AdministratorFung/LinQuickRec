#include <brpc/channel.h>
#include <brpc/controller.h>

#include "perf_handler.pb.h"

#include <chrono>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "common/logger.h"
#include "common/perf_registry.h"
#include "common/service_discovery.h"
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

bool PullService(const std::string& host, int port,
                 std::vector<common::perf::Span>& out_spans,
                 uint64_t& out_dropped) {
    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.protocol = "baidu_std";
    opts.timeout_ms = 2000;
    opts.use_ub = FLAGS_use_ub;
    opts.connection_type = "short";
    opts.max_retry = 0;

    std::string addr = host + ":" + std::to_string(port);
    if (channel.Init(addr.c_str(), &opts) != 0) {
        LOG_WARN << "Puller: channel init failed for " << addr;
        return false;
    }

    common::perf::Perf_Stub stub(&channel);
    common::perf::PerfRequest req;
    common::perf::PerfResponse rsp;
    brpc::Controller cntl;

    stub.Dump(&cntl, &req, &rsp, nullptr);

    if (cntl.Failed()) {
        LOG_WARN << "Puller: RPC failed for " << addr << ": " << cntl.ErrorText();
        return false;
    }

    out_dropped = rsp.dropped();
    for (const auto& pb : rsp.spans()) {
        out_spans.push_back(SpanFromProto(pb));
    }
    return true;
}

} // namespace

void StartPuller(
    std::shared_ptr<common::ServiceDiscovery> discovery,
    SqliteStore* sqlite,
    int retention_days) {

    LOG_INFO << "Puller started, pulling from " << kTargetServices.size()
             << " services every 1s";

    std::vector<common::perf::Span> batch;

    while (true) {
        auto start = std::chrono::steady_clock::now();

        for (const auto& service_name : kTargetServices) {
            std::string host;
            int port;
            std::string instance_id;
            if (!discovery->GetInstance(service_name, host, port, instance_id)) {
                LOG_DEBUG << "Puller: " << service_name << " not found in discovery";
                continue;
            }

            std::vector<common::perf::Span> spans;
            uint64_t dropped = 0;
            if (PullService(host, port, spans, dropped)) {
                LOG_INFO << "Puller: pulled " << spans.size() << " spans from "
                         << service_name << " at " << host << ":" << port;
                if (dropped > 0) {
                    LOG_WARN << "Ring buffer overflow on " << service_name
                             << ": " << dropped << " spans dropped";
                }

                for (auto& s : spans) {
                    StatsEngine::Instance().Push(s.service, s.stage, s.duration_ms);
                    batch.push_back(std::move(s));
                }

                if (SeriesManager::Instance().ActiveSeriesId() != 0) {
                    SeriesManager::Instance().IncrementSpanCount();
                }
            } else {
                LOG_ERROR << "Failed to pull /debug/perf from "
                          << service_name << " at " << host << ":" << port;
            }
        }

        if (!batch.empty()) {
            sqlite->Flush(batch);
        }
        sqlite->Cleanup(retention_days > 0 ? static_cast<int64_t>(retention_days) * 24 * 3600 : 0);

        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start).count();
        auto sleep_ms = std::max<int64_t>(0, 1000 - elapsed);
        std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
    }
}

} // namespace perf
