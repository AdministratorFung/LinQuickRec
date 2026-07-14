#ifndef PERF_COLLECTOR_SQLITE_STORE_H
#define PERF_COLLECTOR_SQLITE_STORE_H

#include "common/perf_registry.h"

#include <sqlite3.h>

#include <mutex>
#include <string>
#include <vector>

namespace perf {

class SqliteStore {
public:
    ~SqliteStore();

    // Returns true if database was opened successfully
    bool Open(const std::string& db_path);

    // Batch insert spans (caller must NOT call concurrently)
    void Flush(std::vector<common::perf::Span>& batch);

    // Clean up spans older than retention_seconds
    void Cleanup(int64_t retention_seconds);

    // Query spans by trace_id, ordered by ts_us
    std::vector<common::perf::Span> QueryTrace(const std::string& trace_id);

    struct TraceSummary {
        std::string trace_id;
        uint64_t ts_us;
        int span_count;
        float total_duration_ms;
    };

    // Aggregate trace summaries, ordered by earliest ts_us DESC
    std::vector<TraceSummary> QueryTraces(int limit, int offset);

    // --- Series persistence ---
    int64_t CreateSeries(const std::string& name, int64_t ts_us);
    void UpdateSeriesStop(int64_t id, int64_t ts_us);
    void UpdateSeriesSpanCount(int64_t id);
    void LoadSeries(std::vector<int64_t>& ids, std::vector<std::string>& names,
                    std::vector<uint64_t>& counts, int64_t& max_id, uint64_t& active_id);

    // --- StatsEngine rebuild ---
    std::vector<common::perf::Span> LoadAllSpans();

    // --- Flush with active series ---
    void SetFlushSeriesId(int64_t series_id);

private:
    void PrepareStatements();
    void FinalizeStatements();

    sqlite3* db_ = nullptr;
    sqlite3_stmt* stmt_insert_ = nullptr;
    int64_t flush_series_id_ = 0;

    std::mutex mutex_;  // protects db_ operations
};

} // namespace perf

#endif // PERF_COLLECTOR_SQLITE_STORE_H
