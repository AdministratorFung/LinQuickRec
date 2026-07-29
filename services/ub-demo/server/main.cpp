#include <brpc/server.h>
#include <gflags/gflags.h>

#include <chrono>

#include "echo.pb.h"

#ifdef BRPC_WITH_URMA
#include "brpc/ubsocket_initializer.h"
#endif

class EchoServiceImpl : public ub_demo::EchoService {
public:
    void Echo(google::protobuf::RpcController*,
              const ub_demo::EchoRequest* request,
              ub_demo::EchoResponse* response,
              google::protobuf::Closure* done) override {
        response->set_message(request->message());
        response->set_ts_us(
            std::chrono::duration_cast<std::chrono::microseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());
        done->Run();
    }
};

DEFINE_int32(port, 8080, "Server port");
DEFINE_bool(ubsocket_use_ub, false, "Enable UBSocket/URMA transport");

int main(int argc, char* argv[]) {
    gflags::ParseCommandLineFlags(&argc, &argv, true);

#ifdef BRPC_WITH_URMA
    if (FLAGS_ubsocket_use_ub) {
        printf("[server] Initializing UBSocket/URMA...\n");
        if (brpc::InitializeUBSocket() == 0) {
            printf("[server] UBSocket/URMA initialized successfully\n");
        } else {
            fprintf(stderr, "[server] UBSocket init failed, will use TCP\n");
        }
    }
#else
    if (FLAGS_ubsocket_use_ub) {
        fprintf(stderr,
                "[server] BRPC_WITH_URMA not compiled in. "
                "Build with -DUBSOCKET_USE_UB=ON\n");
    }
#endif

    EchoServiceImpl echo_svc;
    brpc::Server server;

    if (server.AddService(&echo_svc, brpc::SERVER_DOESNT_OWN_SERVICE,
                          "/EchoService/Echo => Echo") != 0) {
        fprintf(stderr, "Failed to add EchoService\n");
        return 1;
    }

    brpc::ServerOptions opts;
    if (server.Start(FLAGS_port, &opts) != 0) {
        fprintf(stderr, "Failed to start server on :%d\n", FLAGS_port);
        return 1;
    }

    printf("[server] Listening on :%d (URMA=%s)\n",
           FLAGS_port, FLAGS_ubsocket_use_ub ? "on" : "off");

    server.RunUntilAskedToQuit();
    return 0;
}
