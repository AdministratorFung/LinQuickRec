#include "api_handlers.h"

#include <brpc/controller.h>

#include <chrono>
#include <functional>
#include <iomanip>
#include <sstream>

#include "common/logger.h"
#include "init_status.h"
#include "series_manager.h"
#include "span_tree.h"
#include "stats_engine.h"

namespace perf {


namespace {

void JsonOk(brpc::Controller* cntl, const std::string& body) {
    cntl->http_response().set_status_code(200);
    cntl->http_response().set_content_type("application/json");
    cntl->response_attachment().append(body);
}

void JsonError(brpc::Controller* cntl, int code, const std::string& msg) {
    cntl->http_response().set_status_code(code);
    cntl->http_response().set_content_type("application/json");
    std::string body = R"({"error":")" + msg + R"("})";
    cntl->response_attachment().append(body);
}

std::string StatsToJson(const WelfordRunningStats& st) {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(3);
    oss << R"({"avg":)" << st.Avg()
        << R"(,"min":)" << st.Min()
        << R"(,"max":)" << st.Max()
        << R"(,"p50":)" << st.P50()
        << R"(,"p99":)" << st.P99()
        << R"(,"stddev":)" << st.StdDev()
        << R"(,"count":)" << st.Count()
        << "}";
    return oss.str();
}

std::string ExtractParam(const std::string& uri, const std::string& key) {
    std::string pattern = key + "=";
    size_t pos = uri.find(pattern);
    if (pos == std::string::npos) return "";
    pos += pattern.size();
    size_t end = uri.find('&', pos);
    if (end == std::string::npos) end = uri.size();
    return uri.substr(pos, end - pos);
}

} // namespace

void ApiHandlerService::Handle(
    google::protobuf::RpcController* controller,
    const ApiRequest*,
    ApiResponse*,
    google::protobuf::Closure* done) {

    auto* cntl = static_cast<brpc::Controller*>(controller);
    std::string uri = cntl->http_request().uri().path();
    std::string qs = cntl->http_request().uri().query();
    if (!qs.empty()) uri += "?" + qs;

    // Log non-health requests for traceability
    if (uri.find("/api/v1/health") == std::string::npos) {
        LOG_INFO << "API: " << uri;
    }

    if (uri.find("/api/v1/health") != std::string::npos) {
        HandleHealth(cntl);
    } else if (uri.find("/api/v1/stats/current") != std::string::npos) {
        HandleStatsCurrent(cntl);
    } else if (uri.find("/api/v1/trace/") != std::string::npos) {
        HandleTrace(cntl);
    } else if (uri.find("/api/v1/series") != std::string::npos) {
        HandleSeries(cntl);
    } else if (uri.find("/api/v1/outliers") != std::string::npos) {
        HandleOutliers(cntl);
    } else if (uri.find("/api/v1/stages") != std::string::npos) {
        HandleStages(cntl);
    } else if (uri.find("/api/v1/traces") != std::string::npos) {
        HandleTraces(cntl);
    } else {
        HandleNotFound(cntl);
    }

    done->Run();
}

void ApiHandlerService::HandleHealth(brpc::Controller* cntl) {
    if (g_init_status.ready.load(std::memory_order_acquire)) {
        JsonOk(cntl, R"({"status":"ok"})");
    } else {
        std::ostringstream body;
        body << R"({"status":"initializing","progress":)"
             << g_init_status.progress.load(std::memory_order_relaxed)
             << R"(,"total":)"
             << g_init_status.total.load(std::memory_order_relaxed)
             << "}";
        JsonOk(cntl, body.str());
    }
}

void ApiHandlerService::HandleStatsCurrent(brpc::Controller* cntl) {
    if (!g_init_status.ready.load(std::memory_order_acquire)) {
        JsonError(cntl, 503, "initializing");
        return;
    }

    std::string uri = cntl->http_request().uri().path();
    std::string qs = cntl->http_request().uri().query();
    if (!qs.empty()) uri += "?" + qs;
    std::string service = ExtractParam(uri, "service");
    std::string stage = ExtractParam(uri, "stage");

    if (service.empty() || stage.empty()) {
        LOG_WARN << "API: stats/current missing service or stage param";
        JsonError(cntl, 400, "missing service or stage param");
        return;
    }

    auto* st = StatsEngine::Instance().Get(service, stage);
    if (!st) {
        LOG_WARN << "API: no data for " << service << "|" << stage;
        JsonOk(cntl, R"({"avg":0,"min":0,"max":0,"p50":0,"p99":0,"stddev":0,"count":0})");
        return;
    }

    JsonOk(cntl, StatsToJson(*st));
}

void ApiHandlerService::HandleTrace(brpc::Controller* cntl) {
    std::string uri = cntl->http_request().uri().path();
    std::string qs = cntl->http_request().uri().query();
    if (!qs.empty()) uri += "?" + qs;
    size_t pos = uri.rfind('/');
    if (pos == std::string::npos) {
        JsonError(cntl, 400, "missing trace_id");
        return;
    }
    std::string trace_id = uri.substr(pos + 1);

    auto spans = sqlite_store_->QueryTrace(trace_id);

    auto tree = BuildSpanTree(spans);

    // Serialize tree as JSON: recursive
    std::function<void(const SpanTreeNode&, std::ostringstream&)> writeNode;
    writeNode = [&](const SpanTreeNode& node, std::ostringstream& body) {
        body << "{";
        body << R"("service":")" << node.service << R"(",)";
        body << R"("stage":")" << node.stage << R"(",)";
        if (node.has_span) {
            body << R"("trace_id":")" << node.span.trace_id << R"(",)";
            body << R"("duration_ms":)" << node.span.duration_ms << ",";
            body << R"("ts_us":)" << node.span.ts_us << ",";
            body << R"("status":")" << node.span.status << R"(",)";
        } else {
            body << R"("virtual":true,)";
        }
        body << R"("children":[)";
        for (size_t i = 0; i < node.children.size(); ++i) {
            if (i > 0) body << ",";
            writeNode(node.children[i], body);
        }
        body << "]}";
    };

    std::ostringstream body;
    body << R"({"trace_id":")" << trace_id << R"(","tree":)";
    writeNode(tree, body);
    body << "}";
    JsonOk(cntl, body.str());
}

void ApiHandlerService::HandleSeries(brpc::Controller* cntl) {
    std::string uri = cntl->http_request().uri().path();
    std::string qs = cntl->http_request().uri().query();
    if (!qs.empty()) uri += "?" + qs;

    if (uri.find("/start") != std::string::npos) {
        std::string name = ExtractParam(uri, "name");
        if (name.empty()) name = "unnamed";
        int64_t now_us = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        int64_t id = SeriesManager::Instance().Start(name, now_us);
        LOG_INFO << "Series started: id=" << id << " name=" << name;
        std::ostringstream body;
        body << R"({"id":)" << id << R"(,"name":")" << name << R"(","status":"active"})";
        JsonOk(cntl, body.str());
    } else if (uri.find("/stop") != std::string::npos) {
        int64_t now_us = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        SeriesManager::Instance().Stop(now_us);
        LOG_INFO << "Series stopped";
        JsonOk(cntl, R"({"status":"stopped"})");
    } else {
        // List all series
        std::ostringstream body;
        body << R"({"series":[)";
        auto list = SeriesManager::Instance().List();
        for (size_t i = 0; i < list.size(); ++i) {
            if (i > 0) body << ",";
            body << R"({"id":)" << list[i].id
                 << R"(,"name":")" << list[i].name << "\""
                 << R"(,"span_count":)" << list[i].span_count
                 << R"(,"status":")" << (list[i].active ? "active" : "stopped") << R"("})";
        }
        body << "]}";
        JsonOk(cntl, body.str());
    }
}

void ApiHandlerService::HandleOutliers(brpc::Controller* cntl) {
    std::string uri = cntl->http_request().uri().path();
    std::string qs = cntl->http_request().uri().query();
    if (!qs.empty()) uri += "?" + qs;
    std::string stage = ExtractParam(uri, "stage");

    auto* st = StatsEngine::Instance().Get(
        ExtractParam(uri, "service"), stage);
    if (!st) {
        JsonError(cntl, 404, "no data for stage");
        return;
    }

    std::ostringstream body;
    body << R"({"stage":")" << stage << "\""
         << R"(,"avg":)" << st->Avg()
         << R"(,"stddev":)" << st->StdDev()
         << R"(,"outliers":[])";
    body << "}";
    JsonOk(cntl, body.str());
}

void ApiHandlerService::HandleStages(brpc::Controller* cntl) {
    if (!g_init_status.ready.load(std::memory_order_acquire)) {
        JsonError(cntl, 503, "initializing");
        return;
    }
    auto keys = StatsEngine::Instance().GetAllKeys();
    std::ostringstream body;
    body << "[";
    for (size_t i = 0; i < keys.size(); ++i) {
        if (i > 0) body << ",";
        body << R"({"service":")" << keys[i].service
             << R"(","stage":")" << keys[i].stage
             << R"(","count":)" << keys[i].count << "}";
    }
    body << "]";
    JsonOk(cntl, body.str());
}

void ApiHandlerService::HandleTraces(brpc::Controller* cntl) {
    std::string uri = cntl->http_request().uri().path();
    std::string qs = cntl->http_request().uri().query();
    if (!qs.empty()) uri += "?" + qs;
    int limit = 20;
    int offset = 0;
    std::string l = ExtractParam(uri, "limit");
    std::string o = ExtractParam(uri, "offset");
    if (!l.empty()) limit = std::stoi(l);
    if (!o.empty()) offset = std::stoi(o);
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    auto traces = sqlite_store_->QueryTraces(limit, offset);
    std::ostringstream body;
    body << "[";
    for (size_t i = 0; i < traces.size(); ++i) {
        if (i > 0) body << ",";
        body << R"({"trace_id":")" << traces[i].trace_id
             << R"(","ts_us":)" << traces[i].ts_us
             << R"(,"span_count":)" << traces[i].span_count
             << R"(,"total_duration_ms":)" << traces[i].total_duration_ms
             << "}";
    }
    body << "]";
    JsonOk(cntl, body.str());
}

void ApiHandlerService::HandleNotFound(brpc::Controller* cntl) {
    LOG_WARN << "API 404: " << cntl->http_request().uri().path();
    JsonError(cntl, 404, "not found");
}

} // namespace perf
