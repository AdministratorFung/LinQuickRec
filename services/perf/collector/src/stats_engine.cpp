#include "stats_engine.h"

#include "common/logger.h"

namespace perf {

void WelfordRunningStats::Push(double value) {
    count_++;
    if (value < min_) min_ = value;
    if (value > max_) max_ = value;

    double delta = value - mean_;
    mean_ += delta / count_;
    double delta2 = value - mean_;
    M2_ += delta * delta2;
}

void WelfordRunningStats::Sample(double value) {
    count_sampled_++;
    if (reservoir_.size() < kReservoirMax) {
        reservoir_.push_back(value);
    } else {
        uint64_t r = rng_() % count_sampled_;
        if (r < kReservoirMax) {
            reservoir_[r] = value;
        }
    }
}

double WelfordRunningStats::Variance() const {
    return count_ > 1 ? M2_ / count_ : 0.0;
}

double WelfordRunningStats::P50() const { return Percentile(0.50); }
double WelfordRunningStats::P99() const { return Percentile(0.99); }

double WelfordRunningStats::Percentile(double p) const {
    if (reservoir_.empty()) return 0.0;
    auto sorted = reservoir_;
    std::sort(sorted.begin(), sorted.end());
    size_t idx = static_cast<size_t>(p * sorted.size());
    if (idx >= sorted.size()) idx = sorted.size() - 1;
    return sorted[idx];
}

StatsEngine& StatsEngine::Instance() {
    static StatsEngine instance;
    return instance;
}

void StatsEngine::Push(const std::string& service, const std::string& stage,
                       double duration_ms) {
    auto key = service + "|" + stage;
    bool is_new = stage_stats_.find(key) == stage_stats_.end();
    auto& st = stage_stats_[key];
    if (is_new) {
        LOG_INFO << "StatsEngine: new stage " << key;
    }
    st.all_time.Push(duration_ms);
    st.all_time.Sample(duration_ms);
    st.recent.Push(duration_ms);
    st.recent.Sample(duration_ms);
}

const WelfordRunningStats* StatsEngine::Get(
    const std::string& service, const std::string& stage) const {
    auto key = service + "|" + stage;
    auto it = stage_stats_.find(key);
    return it != stage_stats_.end() ? &it->second.all_time : nullptr;
}

void StatsEngine::ResetRecent() {
    for (auto& [_, s] : stage_stats_) {
        s.recent = WelfordRunningStats{};
    }
}

std::vector<StatsEngine::StageKey> StatsEngine::GetAllKeys() const {
    std::vector<StageKey> keys;
    for (const auto& kv : stage_stats_) {
        const auto& key = kv.first;
        size_t sep = key.find('|');
        if (sep == std::string::npos) continue;
        keys.push_back({
            key.substr(0, sep),
            key.substr(sep + 1),
            kv.second.all_time.Count()
        });
    }
    return keys;
}

void StatsEngine::RebuildFromSpans(const std::vector<common::perf::Span>& spans) {
    for (const auto& s : spans) {
        Push(s.service, s.stage, s.duration_ms);
    }
}

} // namespace perf
