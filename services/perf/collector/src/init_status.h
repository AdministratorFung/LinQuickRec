#ifndef PERF_COLLECTOR_INIT_STATUS_H
#define PERF_COLLECTOR_INIT_STATUS_H

#include <atomic>
#include <cstdint>

namespace perf {

struct InitStatus {
    std::atomic<bool> ready{false};
    std::atomic<int64_t> progress{0};
    std::atomic<int64_t> total{0};
};

extern InitStatus g_init_status;

} // namespace perf

#endif // PERF_COLLECTOR_INIT_STATUS_H
