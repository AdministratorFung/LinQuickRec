#include "series_manager.h"

#include <algorithm>
#include <cmath>

#include "common/logger.h"
#include "sqlite_store.h"

namespace perf {

// ---- SeriesManager ----

SeriesManager& SeriesManager::Instance() {
    static SeriesManager instance;
    return instance;
}

void SeriesManager::Init(SqliteStore* sqlite) {
    sqlite_ = sqlite;
    std::vector<int64_t> ids;
    std::vector<std::string> names;
    std::vector<uint64_t> counts;
    int64_t max_id = 0;
    uint64_t active = 0;
    sqlite->LoadSeries(ids, names, counts, max_id, active);

    for (size_t i = 0; i < ids.size(); ++i) {
        Series s;
        s.id = ids[i];
        s.name = names[i];
        s.span_count = counts[i];
        s.active = (static_cast<uint64_t>(ids[i]) == active);
        series_.push_back(s);
    }
    active_id_.store(active, std::memory_order_release);
    LOG_INFO << "SeriesManager: loaded " << ids.size() << " series, active=" << active;
    if (active) sqlite_->SetFlushSeriesId(static_cast<int64_t>(active));
}

int64_t SeriesManager::Start(const std::string& name, int64_t ts_us) {
    if (!sqlite_) return 0;
    int64_t id = sqlite_->CreateSeries(name, ts_us);
    if (id == 0) return 0;

    std::lock_guard<std::mutex> lock(mutex_);
    Series s;
    s.id = id;
    s.name = name;
    s.start_ts_us = ts_us;
    s.active = true;
    series_.push_back(s);
    active_id_.store(static_cast<uint64_t>(id), std::memory_order_release);

    if (sqlite_) sqlite_->SetFlushSeriesId(id);
    LOG_INFO << "Series started: id=" << id << " name=" << name;
    return id;
}

void SeriesManager::Stop(int64_t ts_us) {
    uint64_t id = active_id_.load(std::memory_order_acquire);
    if (id == 0) return;

    if (sqlite_) sqlite_->UpdateSeriesStop(static_cast<int64_t>(id), ts_us);
    if (sqlite_) sqlite_->SetFlushSeriesId(0);

    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& s : series_) {
        if (static_cast<uint64_t>(s.id) == id && s.active) {
            s.active = false;
            s.stop_ts_us = ts_us;
            break;
        }
    }
    active_id_.store(0, std::memory_order_release);
    LOG_INFO << "Series stopped: id=" << id;
}

std::vector<Series> SeriesManager::List() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return series_;
}

void SeriesManager::IncrementSpanCount() {
    uint64_t id = active_id_.load(std::memory_order_acquire);
    if (id == 0) return;
    if (sqlite_) sqlite_->UpdateSeriesSpanCount(static_cast<int64_t>(id));
    std::lock_guard<std::mutex> lock(mutex_);
    for (auto& s : series_) {
        if (static_cast<uint64_t>(s.id) == id && s.active) {
            s.span_count++;
            return;
        }
    }
}

// ---- OutlierDetector ----

OutlierDetector& OutlierDetector::Instance() {
    static OutlierDetector instance;
    return instance;
}

bool OutlierDetector::IsOutlier(double value, double avg, double stddev,
                                 double threshold) const {
    if (stddev <= 0.0) return false;
    double z = std::abs(value - avg) / stddev;
    return z > threshold;
}

} // namespace perf
