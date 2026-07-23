#include <brpc/server.h>
#include <gflags/gflags.h>

#include <thread>

#include "common/logger.h"
#include "common/perf_handler.h"
#include "common/perf_registry.h"
#include "common/service_discovery.h"
#include "series_manager.h"
#include "stats_engine.h"
#include "api_handlers.h"
#include "init_status.h"
#include "sqlite_store.h"

DEFINE_int32(server_port, 8080, "Perf-collector HTTP server port");
DEFINE_string(registry_backend, "etcd", "Registry backend: etcd or discovery_server");
DEFINE_string(discovery_addr, "127.0.0.1:8100", "Discovery server address");
DEFINE_string(etcd_endpoints, "etcd-client:2379", "etcd endpoints");
DEFINE_int32(server_num_threads, 0, "Server bthread num_threads, 0=BRPC default");
DEFINE_string(sqlite_db_path, "/var/lib/perf/perf.db", "SQLite database path");
DEFINE_int32(retention_days, 30, "Data retention days, 0 = unlimited");
DEFINE_bool(enable_urma, false, "Enable UBSocket/URMA transport");

namespace perf {
void StartPuller(std::shared_ptr<common::ServiceDiscovery> discovery,
                 SqliteStore* sqlite,
                 int retention_days);
} // namespace perf

int main(int argc, char* argv[]) {
    gflags::ParseCommandLineFlags(&argc, &argv, true);

    common::logger::LoggerConfig log_config;
    log_config.level = common::logger::LogLevel::INFO;
    log_config.console_output = true;
    log_config.file_path = "/var/log/linquickrec/perf_collector.log";
    log_config.max_file_size = 100 * 1024 * 1024;
    log_config.max_files = 5;
    log_config.enable_trace_id = true;
    common::logger::Initialize(log_config);

    common::perf::PerfRingRegistry::Instance().Init();

    LOG_INFO << "Perf-collector starting...";

    std::string backend_addr = (FLAGS_registry_backend == "etcd")
        ? FLAGS_etcd_endpoints : FLAGS_discovery_addr;
    auto discovery = std::make_shared<common::ServiceDiscovery>(
        FLAGS_registry_backend, backend_addr, 5000);

    brpc::Server server;
    if (server.AddService(new common::perf::PerfService,
                          brpc::SERVER_OWNS_SERVICE,
                          "/debug/perf => Dump") != 0) {
        LOG_ERROR << "Failed to add PerfService";
    } else {
        LOG_INFO << "PerfService added (/debug/perf => Dump)";
    }

    perf::SqliteStore sqlite;
    if (!sqlite.Open(FLAGS_sqlite_db_path)) {
        LOG_ERROR << "Cannot open database, exiting";
        return -1;
    }

    if (server.AddService(new perf::ApiHandlerService(&sqlite),
                          brpc::SERVER_OWNS_SERVICE,
                          "/api/* => Handle") != 0) {
        LOG_ERROR << "Failed to add ApiHandlerService";
        return -1;
    }
    LOG_INFO << "ApiHandlerService added (/api/* => Handle)";

    LOG_INFO << "Config: backend=" << FLAGS_registry_backend
             << " addr=" << backend_addr
             << " db=" << FLAGS_sqlite_db_path
             << " retention=" << FLAGS_retention_days << "d";

    brpc::ServerOptions opts;
    opts.use_ub = FLAGS_enable_urma;
    opts.has_builtin_services = false;
    if (FLAGS_server_num_threads > 0) opts.num_threads = FLAGS_server_num_threads;

    if (server.Start(FLAGS_server_port, &opts) != 0) {
        LOG_ERROR << "Failed to start server on port " << FLAGS_server_port;
        return -1;
    }
    LOG_INFO << "Perf-collector listening on port " << FLAGS_server_port;

    // Init series manager from SQLite before starting puller
    perf::SeriesManager::Instance().Init(&sqlite);

    // Async rebuild StatsEngine from historical spans
    perf::g_init_status.ready.store(false);

    std::thread rebuild_thread([&sqlite]() {
        auto spans = sqlite.LoadAllSpans();
        perf::g_init_status.total.store(static_cast<int64_t>(spans.size()));
        LOG_INFO << "Rebuild: loading " << spans.size() << " historical spans";
        for (size_t i = 0; i < spans.size(); ++i) {
            perf::StatsEngine::Instance().Push(spans[i].service, spans[i].stage,
                                         spans[i].duration_ms);
            perf::g_init_status.progress.store(static_cast<int64_t>(i + 1));
        }
        perf::g_init_status.ready.store(true);
        LOG_INFO << "Rebuild: complete (" << spans.size() << " spans processed)";
    });
    rebuild_thread.detach();

    perf::StartPuller(discovery, &sqlite, FLAGS_retention_days);

    LOG_INFO << "Perf-collector stopped";
    return 0;
}
