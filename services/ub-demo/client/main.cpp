#include <brpc/channel.h>
#include <brpc/controller.h>
#include <gflags/gflags.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <vector>

#include "echo.pb.h"

#ifdef BRPC_WITH_URMA
#include "brpc/ubsocket_initializer.h"
#endif

DEFINE_string(server, "127.0.0.1:8080", "Server address (host:port)");
DEFINE_int32(count, 1, "Number of echo requests");
DEFINE_int32(timeout_ms, 3000, "RPC timeout in ms");
DEFINE_string(protocol, "http", "Protocol: http or baidu_std");
DEFINE_bool(ubsocket_use_ub, false, "Enable UBSocket/URMA transport");
DEFINE_string(message, "hello", "Echo message to send");

int main(int argc, char* argv[]) {
    gflags::ParseCommandLineFlags(&argc, &argv, true);

#ifdef BRPC_WITH_URMA
    if (FLAGS_ubsocket_use_ub) {
        printf("[client] Initializing UBSocket/URMA...\n");
        if (brpc::InitializeUBSocket() == 0) {
            printf("[client] UBSocket/URMA initialized successfully\n");
        } else {
            fprintf(stderr, "[client] UBSocket init failed, will use TCP\n");
        }
    }
#else
    if (FLAGS_ubsocket_use_ub) {
        fprintf(stderr,
                "[client] BRPC_WITH_URMA not compiled in. "
                "Build with -DUBSOCKET_USE_UB=ON\n");
    }
#endif

    brpc::Channel channel;
    brpc::ChannelOptions opts;
    opts.protocol = FLAGS_protocol.c_str();
    opts.timeout_ms = FLAGS_timeout_ms;

    if (channel.Init(FLAGS_server.c_str(), &opts) != 0) {
        fprintf(stderr, "Failed to init channel to %s\n",
                FLAGS_server.c_str());
        return 1;
    }

    std::vector<double> latencies;
    latencies.reserve(FLAGS_count);

    for (int i = 0; i < FLAGS_count; ++i) {
        ub_demo::EchoRequest req;
        ub_demo::EchoResponse resp;
        brpc::Controller cntl;
        ub_demo::EchoService_Stub stub(&channel);

        req.set_message(FLAGS_message + " #" + std::to_string(i + 1));

        auto start = std::chrono::steady_clock::now();
        stub.Echo(&cntl, &req, &resp, nullptr);
        auto end = std::chrono::steady_clock::now();

        double ms = std::chrono::duration<double, std::milli>(end - start)
                        .count();
        latencies.push_back(ms);

        if (cntl.Failed()) {
            printf("  [%d] ERROR: %s (%.2f ms)\n",
                   i + 1, cntl.ErrorText().c_str(), ms);
        } else {
            printf("  [%d] echo: %s -> %s (%.2f ms)\n",
                   i + 1, req.message().c_str(),
                   resp.message().c_str(), ms);
        }
    }

    std::sort(latencies.begin(), latencies.end());
    size_t n = latencies.size();
    double sum = 0;
    for (double v : latencies) sum += v;

    printf("\n--- Summary (%zu requests) ---\n", n);
    printf("  avg  = %.2f ms\n", sum / n);
    printf("  min  = %.2f ms\n", latencies[0]);
    printf("  p50  = %.2f ms\n", latencies[n * 50 / 100]);
    printf("  p99  = %.2f ms\n", latencies[n * 99 / 100]);
    printf("  max  = %.2f ms\n", latencies[n - 1]);

    return 0;
}
