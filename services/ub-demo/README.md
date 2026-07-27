# ub-demo — URMA/UBSocket 回显服务

## 模块简介

`ub-demo` 是一个极简的 brpc 客户端-服务端对，专为在华为鲲鹏平台（搭载 URMA 硬件）上验证 **UBSocket（用户总线 Socket）传输**而设计。它演示了如何使用编译了 `BRPC_WITH_URMA` 的 `libbrpc.a`，通过可选的 UB 传输来运行标准 brpc 服务。

**核心特性：**

- 在编译了 `BRPC_WITH_URMA` 的情况下，在服务端启动和 Channel 创建前调用 `brpc::InitializeUBSocket()`。所有 `--ubsocket_*` gflag 均可在此使用。
- `--ubsocket_auto_fallback_tcp=true`（默认）支持在没有 UB 硬件的情况下自动回退到 TCP——方案适用于任何环境。
- 使用 `#ifdef BRPC_WITH_URMA` 守卫的纯 C++ 代码，未定义时无缝编译为纯 TCP brpc。
- 客户端测量往返时延，并输出 avg/p50/p99/min/max 汇总信息。
- **使用 Bazel 构建** — 无需安装头文件或库到系统目录。

## 目录结构

```
services/ub-demo/
├── WORKSPACE                    # 声明 @brpc 为 local_repository
├── BUILD.bazel                  # 构建目标 (proto + server + client)
├── .bazelrc                     # URMA + ARM + C++17 flags
├── proto/
│   └── echo.proto               # EchoService: EchoRequest → EchoResponse
├── server/
│   └── main.cpp                 # 服务端：注册 EchoService，启动前调用 UBSocket.init
├── client/
│   └── main.cpp                 # 客户端：创建 Channel，发送回显请求，打印时延
├── Dockerfile                   # 运行时 image，复制预构建的二进制
├── deploy/
│   ├── docker-compose.yml       # 两容器测试（服务端 + 客户端）
│   └── k8s/
│       ├── server.yaml          # Deployment + ClusterIP Service
│       └── client.yaml          # Job（运行一次，查看日志）
└── README.md
```

## 业务流程

```
[Client] --(1) InitializeUBSocket() (optional)--> UBSocket lib
[Client] --(2) Create Channel to server:8080 ---> Network
[Client] --(3) EchoService.Echo(request) -------> [Server]
[Server] --(4) response->set_message(msg) ------> [Client]
[Client] --(5) Print latency, repeat N times ---> Summary
```

URMA 路径：
- 启动时调用 `brpc::InitializeUBSocket()`，将系统 socket 调用（`connect`、`accept`、`readv`、`writev`、`epoll_*`）替换为 UB socket 封装。
- brpc 的 `Socket`、`EventDispatcher` 和 `IOBuf` 层进行自适应——配置正确时，传输数据会经由 UB 硬件，而非内核 TCP 栈。
- 若 UB 初始化/连接失败，`--ubsocket_auto_fallback_tcp=true` 会静默回退到 TCP。

## 编译命令

**前置条件：**
- [Bazel](https://bazel.build/) (推荐 4.2.2+)
- 本地 clone 的 [brpc fork](https://atomgit.com/fanzhaonan/brpc)

```bash
cd services/ub-demo

# 构建 (用户指定 brpc 路径)
bazel build //:ub_demo_server //:ub_demo_client \
    --override_repository=brpc=/path/to/your/brpc-fork

# 产物
#   bazel-bin/ub_demo_server
#   bazel-bin/ub_demo_client
```

**`--override_repository`** 是关键的构建时参数——它告诉 Bazel 在哪里找到你本地 clone 的 brpc fork。无需修改任何文件。

Bazel 会自动：
1. 从 brpc fork 的 WORKSPACE 解析所有传递依赖 (protobuf, gflags, openssl, leveldb, abseil, ubsocket)
2. 从 brpc fork 的 BUILD.bazel 解析 include 路径
3. 将 `@brpc//:brpc` 链接为依赖，包含 `:butil`、`:bthread` 及所有传递依赖

**无需安装任何内容到 `/usr/local`。**

## 启动方式

### 服务端

```bash
# 启用 URMA（需要 UB 硬件，或回退到 TCP）：
bazel-bin/ub_demo_server --use_ub --port=8080

# 纯 TCP：
bazel-bin/ub_demo_server --port=8080

# 全部 ubsocket gflag（在编译 libbrpc.a 时启用 URMA 时可用）：
bazel-bin/ub_demo_server --use_ub --port=8080 \
    --ubsocket_trans_mode=ub \
    --ubsocket_dev_name=udma2 \
    --ubsocket_dev_ip=192.168.1.100 \
    --ubsocket_auto_fallback_tcp=true
```

### 客户端

```bash
# 启用 URMA：
bazel-bin/ub_demo_client --use_ub --server=127.0.0.1:8080 --count=10

# 纯 TCP：
bazel-bin/ub_demo_client --server=127.0.0.1:8080 --count=10

# 客户端 gflag：
bazel-bin/ub_demo_client \
    --use_ub \
    --server=127.0.0.1:8080 \
    --count=10 \
    --message="hello" \
    --protocol=http \
    --timeout_ms=3000
```

输出示例：
```
[client] UBSocket/URMA initialized successfully
  [1] echo: hello #1 -> hello #1 (0.45 ms)
  [2] echo: hello #2 -> hello #2 (0.32 ms)
  ...
--- Summary (10 requests) ---
  avg  = 0.38 ms
  min  = 0.28 ms
  p50  = 0.35 ms
  p99  = 0.52 ms
  max  = 0.52 ms
```

## 容器搭建

### Docker 镜像（本地 Bazel 构建 + Docker 运行时）

```bash
# 1. 先本地 Bazel 构建
bazel build //:ub_demo_server //:ub_demo_client \
    --override_repository=brpc=/path/to/brpc-fork

# 2. Docker 镜像（从 builds/Build 上下文复制二进制）
docker build -t linquickrec/ub-demo:latest \
    --build-arg BUILD_BIN_DIR=bazel-bin \
    -f Dockerfile .
```

Dockerfile 极其精简——仅从构建上下文复制预构建的二进制文件：
```dockerfile
FROM openeuler/openeuler:24.03-sp3-lts
ARG BUILD_BIN_DIR=bazel-bin
COPY ${BUILD_BIN_DIR}/ub_demo_server /app/ub_demo_server
COPY ${BUILD_BIN_DIR}/ub_demo_client /app/ub_demo_client
```

### Docker Compose（两容器）

```bash
# 先构建 Bazel 二进制：
bazel build //:ub_demo_server //:ub_demo_client \
    --override_repository=brpc=/path/to/brpc-fork

# 然后运行 compose：
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up

# 检查客户端输出：
docker compose -f deploy/docker-compose.yml logs client
```

### K8s

```bash
# 先构建并推送镜像：
docker build ... -t linquickrec/ub-demo:latest .
docker push linquickrec/ub-demo:latest

# 部署服务端：
kubectl apply -f deploy/k8s/server.yaml

# 运行客户端 Job：
kubectl apply -f deploy/k8s/client.yaml

# 查看客户端日志：
kubectl logs -n linquickrec job/ub-demo-client

# 清理：
kubectl delete -f deploy/k8s/client.yaml
kubectl delete -f deploy/k8s/server.yaml
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| **服务端** | | | |
| `--use_ub` | bool | false | 调用 brpc::InitializeUBSocket() |
| `--port` | int32 | 8080 | 服务端监听端口 |
| `--ubsocket_*` | 多个 | 见 brpc | 由 libbrpc.a 提供的 UBSocket gflags（约 50 个） |
| **客户端** | | | |
| `--use_ub` | bool | false | 调用 brpc::InitializeUBSocket() |
| `--server` | string | 127.0.0.1:8080 | 服务端地址（host:port） |
| `--count` | int32 | 1 | 待发送的回显请求数量 |
| `--timeout_ms` | int32 | 3000 | RPC 超时（毫秒） |
| `--protocol` | string | http | brpc 协议（http 或 baidu_std） |
| `--message` | string | hello | 待回显的负载消息 |

## 端口对照表

| 端口 | 服务 | 协议 | 说明 |
|------|------|------|------|
| 8080 | ub-demo-server | BRPC HTTP | 回显服务端口（ClusterIP） |
