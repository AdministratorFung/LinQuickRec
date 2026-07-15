#include "sqlite_store.h"

#include <chrono>
#include <cstdio>

#include "common/logger.h"

namespace perf {

SqliteStore::~SqliteStore() {
    FinalizeStatements();
    if (db_) {
        sqlite3_close(db_);
    }
}

bool SqliteStore::Open(const std::string& db_path) {
    int rc = sqlite3_open_v2(db_path.c_str(), &db_,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
        nullptr);
    if (rc != SQLITE_OK) {
        LOG_ERROR << "Failed to open SQLite: " << sqlite3_errmsg(db_);
        sqlite3_close(db_);
        db_ = nullptr;
        return false;
    }

    const char* pragmas[] = {
        "PRAGMA journal_mode=WAL",
        "PRAGMA synchronous=NORMAL",
        "PRAGMA cache_size=-64000",
        "PRAGMA temp_store=MEMORY",
        "PRAGMA mmap_size=268435456",
        "CREATE TABLE IF NOT EXISTS spans ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  ts_us INTEGER NOT NULL,"
        "  service TEXT NOT NULL,"
        "  stage TEXT NOT NULL,"
        "  metric TEXT NOT NULL,"
        "  trace_id TEXT NOT NULL,"
        "  duration_ms REAL NOT NULL,"
        "  status TEXT NOT NULL,"
        "  series_id INTEGER DEFAULT NULL,"
        "  is_outlier INTEGER DEFAULT 0"
        ")",
        "CREATE INDEX IF NOT EXISTS idx_spans_ts ON spans(ts_us)",
        "CREATE INDEX IF NOT EXISTS idx_spans_stage_ts ON spans(stage, ts_us)",
        "CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id)",
        "CREATE TABLE IF NOT EXISTS series ("
        "  id INTEGER PRIMARY KEY,"
        "  name TEXT NOT NULL,"
        "  start_ts_us INTEGER NOT NULL,"
        "  stop_ts_us INTEGER NOT NULL DEFAULT 0,"
        "  span_count INTEGER NOT NULL DEFAULT 0,"
        "  active INTEGER NOT NULL DEFAULT 0"
        ")",
        nullptr,
    };

    for (int i = 0; pragmas[i] != nullptr; ++i) {
        char* err = nullptr;
        rc = sqlite3_exec(db_, pragmas[i], nullptr, nullptr, &err);
        if (rc != SQLITE_OK) {
            LOG_ERROR << "SQLite error: " << (err ? err : "unknown");
            if (err) sqlite3_free(err);
            sqlite3_close(db_);
            db_ = nullptr;
            return false;
        }
    }

    PrepareStatements();
    LOG_INFO << "SQLite opened: " << db_path;
    return true;
}

void SqliteStore::PrepareStatements() {
    const char* sql =
        "INSERT INTO spans (ts_us, service, stage, metric, trace_id, "
        "duration_ms, status, series_id) VALUES (?,?,?,?,?,?,?,?)";
    int rc = sqlite3_prepare_v2(db_, sql, -1, &stmt_insert_, nullptr);
    if (rc != SQLITE_OK) {
        LOG_ERROR << "SQLite: prepare insert stmt failed: " << sqlite3_errmsg(db_);
    }
}

void SqliteStore::FinalizeStatements() {
    if (stmt_insert_) {
        sqlite3_finalize(stmt_insert_);
        stmt_insert_ = nullptr;
    }
}

void SqliteStore::Flush(std::vector<common::perf::Span>& batch) {
    if (batch.empty() || !stmt_insert_) return;

    LOG_INFO << "SQLite: flushing " << batch.size() << " spans";
    std::lock_guard<std::mutex> lock(mutex_);
    char* err = nullptr;
    int rc = sqlite3_exec(db_, "BEGIN TRANSACTION", nullptr, nullptr, &err);
    if (rc != SQLITE_OK) {
        LOG_ERROR << "SQLite: BEGIN TRANSACTION failed: " << (err ? err : "unknown");
        if (err) sqlite3_free(err);
        return;
    }

    for (auto& s : batch) {
        sqlite3_bind_int64(stmt_insert_, 1, static_cast<int64_t>(s.ts_us));
        sqlite3_bind_text(stmt_insert_, 2, s.service, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt_insert_, 3, s.stage, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt_insert_, 4, s.metric, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(stmt_insert_, 5, s.trace_id, -1, SQLITE_TRANSIENT);
        sqlite3_bind_double(stmt_insert_, 6, s.duration_ms);
        sqlite3_bind_text(stmt_insert_, 7, s.status, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt_insert_, 8, flush_series_id_);
        sqlite3_step(stmt_insert_);
        sqlite3_reset(stmt_insert_);
    }

    sqlite3_exec(db_, "COMMIT", nullptr, nullptr, nullptr);
    batch.clear();
}

std::vector<common::perf::Span> SqliteStore::QueryTrace(const std::string& trace_id) {
    std::vector<common::perf::Span> results;
    if (!db_) return results;

    std::lock_guard<std::mutex> lock(mutex_);

    const char* sql = "SELECT ts_us, service, stage, metric, trace_id, "
                      "duration_ms, status FROM spans "
                      "WHERE trace_id = ? ORDER BY ts_us";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        return results;
    }

    sqlite3_bind_text(stmt, 1, trace_id.c_str(), -1, SQLITE_TRANSIENT);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        common::perf::Span s;
        s.ts_us = static_cast<uint64_t>(sqlite3_column_int64(stmt, 0));
        s.SetService(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1)));
        s.SetStage(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2)));
        s.SetMetric(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3)));
        s.SetTraceId(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4)));
        s.duration_ms = static_cast<float>(sqlite3_column_double(stmt, 5));
        s.SetStatus(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 6)));
        results.push_back(s);
    }

    sqlite3_finalize(stmt);
    return results;
}

std::vector<SqliteStore::TraceSummary> SqliteStore::QueryTraces(int limit, int offset) {
    std::vector<TraceSummary> results;
    if (!db_) return results;

    std::lock_guard<std::mutex> lock(mutex_);

    const char* sql =
        "SELECT trace_id, MIN(ts_us), COUNT(*), SUM(duration_ms) "
        "FROM spans GROUP BY trace_id "
        "ORDER BY MIN(ts_us) DESC LIMIT ? OFFSET ?";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) {
        return results;
    }
    sqlite3_bind_int(stmt, 1, limit);
    sqlite3_bind_int(stmt, 2, offset);

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        TraceSummary ts;
        ts.trace_id = reinterpret_cast<const char*>(sqlite3_column_text(stmt, 0));
        ts.ts_us = static_cast<uint64_t>(sqlite3_column_int64(stmt, 1));
        ts.span_count = sqlite3_column_int(stmt, 2);
        ts.total_duration_ms = static_cast<float>(sqlite3_column_double(stmt, 3));
        results.push_back(ts);
    }
    sqlite3_finalize(stmt);
    return results;
}

void SqliteStore::Cleanup(int64_t retention_seconds) {
    if (retention_seconds <= 0) return;  // unlimited retention

    static int64_t last_cleanup_ts = 0;
    auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();

    if (now - last_cleanup_ts < 3600) return;  // once per hour
    last_cleanup_ts = now;

    std::lock_guard<std::mutex> lock(mutex_);
    int64_t cutoff = (now - retention_seconds) * 1000000;  // us
    char sql[256];
    std::snprintf(sql, sizeof(sql),
                  "DELETE FROM spans WHERE ts_us < %lld", (long long)cutoff);
    char* err = nullptr;
    int rc = sqlite3_exec(db_, sql, nullptr, nullptr, &err);
    if (rc == SQLITE_OK) {
        LOG_INFO << "Cleanup: removed spans older than " << retention_seconds << "s";
    } else if (err) {
        LOG_ERROR << "Cleanup error: " << err;
        sqlite3_free(err);
    }
}

void SqliteStore::SetFlushSeriesId(int64_t series_id) {
    flush_series_id_ = series_id;
}

int64_t SqliteStore::CreateSeries(const std::string& name, int64_t ts_us) {
    std::lock_guard<std::mutex> lock(mutex_);
    const char* sql = "INSERT INTO series (name, start_ts_us, active) VALUES (?,?,1)";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return 0;
    sqlite3_bind_text(stmt, 1, name.c_str(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 2, ts_us);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return sqlite3_last_insert_rowid(db_);
}

void SqliteStore::UpdateSeriesStop(int64_t id, int64_t ts_us) {
    std::lock_guard<std::mutex> lock(mutex_);
    const char* sql = "UPDATE series SET stop_ts_us=?, active=0 WHERE id=?";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return;
    sqlite3_bind_int64(stmt, 1, ts_us);
    sqlite3_bind_int64(stmt, 2, id);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

void SqliteStore::UpdateSeriesSpanCount(int64_t id) {
    std::lock_guard<std::mutex> lock(mutex_);
    const char* sql = "UPDATE series SET span_count = span_count + 1 WHERE id=? AND active=1";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return;
    sqlite3_bind_int64(stmt, 1, id);
    sqlite3_step(stmt);
    sqlite3_finalize(stmt);
}

void SqliteStore::LoadSeries(std::vector<int64_t>& ids, std::vector<std::string>& names,
                              std::vector<uint64_t>& counts, int64_t& max_id, uint64_t& active_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    max_id = 0;
    active_id = 0;
    const char* sql = "SELECT id, name, start_ts_us, stop_ts_us, span_count, active FROM series ORDER BY id";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        int64_t id = sqlite3_column_int64(stmt, 0);
        if (id > max_id) max_id = id;
        ids.push_back(id);
        names.push_back(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1)));
        counts.push_back(static_cast<uint64_t>(sqlite3_column_int64(stmt, 4)));
        if (sqlite3_column_int(stmt, 5)) active_id = static_cast<uint64_t>(id);
    }
    sqlite3_finalize(stmt);
}

std::vector<common::perf::Span> SqliteStore::LoadAllSpans() {
    std::vector<common::perf::Span> results;
    if (!db_) return results;
    std::lock_guard<std::mutex> lock(mutex_);
    const char* sql = "SELECT ts_us, service, stage, metric, trace_id, duration_ms, status "
                      "FROM spans ORDER BY ts_us";
    sqlite3_stmt* stmt = nullptr;
    if (sqlite3_prepare_v2(db_, sql, -1, &stmt, nullptr) != SQLITE_OK) return results;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        common::perf::Span s;
        s.ts_us = static_cast<uint64_t>(sqlite3_column_int64(stmt, 0));
        s.SetService(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 1)));
        s.SetStage(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 2)));
        s.SetMetric(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 3)));
        s.SetTraceId(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 4)));
        s.duration_ms = static_cast<float>(sqlite3_column_double(stmt, 5));
        s.SetStatus(reinterpret_cast<const char*>(sqlite3_column_text(stmt, 6)));
        results.push_back(s);
    }
    sqlite3_finalize(stmt);
    return results;
}

} // namespace perf
