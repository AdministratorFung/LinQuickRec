# Perf — 性能可观测性系统

## 模块简介

Perf 是 LinQuickRec 的实时性能监控系统，由两个独立 Pod 组成：

1. **perf-collector**：定时拉取各服务 span、增量计算统计指标、持久化到 SQLite，通过 ClusterIP 暴露 REST API；
2. **perf-webui**：基于 nginx 的静态前端，通过 NodePort 32000 对外提供 WebUI，API 请求反向代理到 collector。

Perf 通过 etcd 或 discovery_server 动态发现下游服务（proxy、feature、recall 等），每秒通过 BRPC 调用各服务的 `/debug/perf` RPC 拉取 span 数据。collector 宕机时业务服务不受影响（ring buffer 自旋），恢复后自动补拉数据。

### 可观测性

Perf collector 自身暴露可供拉取数据的 HTTP 端口，可通过 Prometheus/Grafana 监控。

### RESTful API

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/v1/health` | 健康检查，返回 `{"status":"ok"}` |
| `GET` | `/api/v1/stats/current?service=<name>&stage=<name>` | 实时统计：avg / p50 / p99 / min / max / stddev / count |
| `GET` | `/api/v1/trace/{trace_id}` | 按 trace_id 查询完整调用链树 |
| `POST` | `/api/v1/series/start?name=<name>` | 开始新请求系列 |
| `POST` | `/api/v1/series/stop` | 停止当前活跃系列 |
| `GET` | `/api/v1/series` | 列出所有系列（id / name / span_count / status） |
| `GET` | `/api/v1/outliers?service=<name>&stage=<name>` | 离群值检测（z-score） |
| `GET` | `/debug/perf` | 拉取原始 span 数据（供 collector puller 调用） |

```bash
# 健康检查
curl -s http://localhost:8080/api/v1/health
# → {"status":"ok"}
```

其余统计查询、调用链、系列管理等功能建议通过 WebUI 使用，见下方 [WebUI](#webui) 章节。

### WebUI

Perf 的前端和后端已拆分为两个独立 Pod：

| Pod | 镜像 | Service | 端口 | 说明 |
|-----|------|---------|------|------|
| perf-collector | `linquickrec/perf-collector` | perf-collector-service (ClusterIP) | 8080 | 数据采集 + REST API |
| perf-webui | `linquickrec/perf-webui` | perf-webui (NodePort) | 32000 | nginx 静态前端 + API 反向代理 |

浏览器访问 `http://<任一节点IP>:32000`，nginx 将 `/api/*` 请求转发到 collector。

#### Dashboard
- 下拉选择监控的 stage（proxy_e2e、recall_total 等）
- 6 个实时指标卡片：Count / Average / P50 / P99 / Min / Max
- 纯 Canvas 绘制的柱状图（无需 CDN 依赖）
- 每 3 秒自动刷新
- 右上角 🌙 按钮切换深色/浅色主题，偏好持久化到 localStorage

#### Series（请求系列）
- **+ New Series**：开始记录一个请求系列
- **Stop Active**：停止当前活跃系列
- 表格列出所有系列（ID / Name / Status / Span Count）
- 点击系列行查看详情（status / span_count）

#### Trace（链路追踪）
- 输入 trace_id → Search
- 瀑布图展示该请求跨所有服务的 Span 耗时分布
- 按服务类型着色（proxy=蓝、recall=绿、precalc=橙 等）
- 行尾 status 用彩色 Badge 标记（OK=绿、error=红）
- 底部 10ⁿ ms 参考条 + span 总数 / 总耗时摘要

## 目录结构

```
services/perf/
├── CMakeLists.txt
├── DESIGN.md
├── README.md
├── TODO.md
├── collector/
│   ├── CMakeLists.txt
│   ├── Dockerfile
│   ├── entrypoint.sh
│   └── src/
│       ├── main.cpp                  # BRPC server + puller startup
│       ├── puller.cpp                # Periodic BRPC puller via discovery
│       ├── stats_engine.cpp          # Welford incremental statistics
│       ├── sqlite_store.cpp          # SQLite batch persistence
│       ├── outlier_detector.cpp      # z-score outlier detection
│       ├── series_manager.cpp        # Series lifecycle API
│       └── api_handlers.cpp          # REST API handlers
├── webui/
│   ├── Dockerfile                     # nginx:alpine based image
│   ├── index.html                     # Dashboard + Series + Trace (Tabler-style SPA)
│   ├── nginx/
│   │   └── default.conf               # Reverse proxy /api/* → collector
│   └── js/
│       ├── api.js                     # API fetch wrappers
│       ├── dashboard.js               # 6 metric cards + canvas chart
│       ├── series.js                  # Series lifecycle management
│       ├── theme.js                   # Dark/light theme toggle
│       └── trace.js                   # Waterfall tree with color-coded spans
└── tests/
    └── integration_test.cpp          # Integration test with mock services

common/include/common/
├── perf_registry.h                   # PerfRingBuffer + PerfRingRegistry (declaration, Push inline)
└── perf_logger.h                     # perf::Log() (modified: calls Registry::Push)

common/src/perf/
└── perf_registry.cpp                 # Snapshot(), Init() implementation
```

## 业务流程

```
 Client Request
       │
       v
┌────────────────────────────────── proxy ──────────────────────────────────────┐
│                                                                               │
│  Feature -> (Recall + Precalc) -> RankMaster -> RankSub -> Response           │
│                                                                               │
│  Each stage: perf::Log() -> RingBuffer(CAS)                                   │
│                                                                               │
└─────────────────────────────────────┬─────────────────────────────────────────┘
                                      │  /debug/perf (BRPC pull, 1s)
                                      v
┌──────────────────────── perf-collector ────────────────────────────────────────┐
│                                                                                │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────┐    ┌──────────────────┐ │
│  │  Puller  │ -> │  StatsEngine  │ -> │  SqliteStore │ -> │  API Handlers    │ │
│  │ (1s loop)│    │   (Welford)   │    │  (WAL mode)  │    │  (REST + HTML)   │ │
│  └──────────┘    └───────┬───────┘    └──────────────┘    └────────┬─────────┘ │
│                          │                                          │          │
│                   ┌──────┴──────┐                          ┌───────┴──────┐    │
│                   │SeriesManager│                          │    WebUI     │    │
│                   │ (start/stop)│                          │  (Chart.js)  │    │
│                   └──────┬──────┘                          └──────────────┘    │
│                          │                                                     │
│                   ┌──────┴──────┐                                              │
│                   │  Outlier    │                                              │
│                   │  Detector   │                                              │
│                   │  (z-score)  │                                              │
│                   └─────────────┘                                              │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 编译命令

| 依赖 | 版本要求 | 备注 |
|------|----------|------|
| CMake | >= 3.14 | 编译工具链 |
| brpc | >= 1.4 | `linquickrec/base:latest` 基础镜像已内置 |
| protobuf | >= 3.0 | `linquickrec/base:latest` 基础镜像已内置 |
| abseil-cpp | latest | `linquickrec/base:latest` 基础镜像已内置 |
| sqlite3 | >= 3.25 | WAL mode and UPSERT support |

### 脚本构建

```bash
bash build.sh              # Release 构建
bash build.sh debug        # Debug 构建
```

### 手动构建

```bash
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make perf_collector perf_integration_test -j$(nproc)
```

### 编译产物

| 二进制 | 说明 |
|--------|------|
| `perf_collector` | perf-collector 服务端 (HTTP + puller + stats + SQLite) |
| `perf_integration_test` | 单进程集成测试 |

## 启动方式

### 启动命令

```bash
./build/bin/perf_collector \
    --server_port=8080 \
    --registry_backend=etcd \
    --etcd_endpoints=etcd-client:2379 \
    --retention_days=30
```

### 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| **服务发现** | | | |
| `--registry_backend` | string | "etcd" | 注册中心后端（etcd / discovery_server） |
| `--etcd_endpoints` | string | "etcd-client:2379" | etcd 端点地址 |
| `--discovery_addr` | string | "127.0.0.1:8100" | Discovery server 地址 |
| **采集** | | | |
| `--pull_interval_ms` | int32 | 1000 | 拉取间隔 (ms) |
| `--ring_buffer_size` | int32 | 50000 | RingBuffer 容量（条） |
| **存储** | | | |
| `--retention_days` | int32 | 30 | 数据留存天数 |
| `--sqlite_db_path` | string | "/var/lib/perf/perf.db" | SQLite 数据库路径 |
| **离群值** | | | |
| `--outlier_threshold` | double | 3.0 | z-score 阈值 |
| **其他** | | | |
| `--server_port` | int32 | 8080 | HTTP 服务监听端口 |
| `--server_num_threads` | int32 | 0 | bthread 线程数，0=BRPC 默认 |

## 容器搭建

Perf 拆分为两个独立镜像：collector（数据采集 + API）和 webui（nginx 静态前端）。

### 构建镜像

```bash
# collector
docker build -t linquickrec/perf-collector:latest \
  -f services/perf/collector/Dockerfile .

# webui
docker build -t linquickrec/perf-webui:latest \
  -f services/perf/webui/Dockerfile .

# 或通过 docker-compose
docker compose -f deploy/docker/docker-compose.yml build perf-collector perf-webui
```

### 运行容器

```bash
# 启动 collector（仅暴露 ClusterIP，不直接对外）
docker run -d --name perf-collector \
  -e REGISTRY_BACKEND=etcd \
  -e ETCD_ENDPOINTS=<etcd-ip>:2379 \
  -v perf-data:/var/lib/perf \
  linquickrec/perf-collector:latest

# 启动 webui（NodePort 32000）
docker run -d --name perf-webui \
  -p 32000:32000 \
  linquickrec/perf-webui:latest
```


## 测试方法

### 集成测试

集成测试为单进程测试，不依赖 etcd 或 K8s 集群。测试在一个进程内启动 mock `/debug/perf` HTTP server + 真实 `perf-collector`（Puller + StatsEngine + SqliteStore），注入已知分布的 span 数据并用 `assert()` 验证各 API 返回结果。

```bash
# 本地运行
./build/bin/perf_integration_test

# 通过 Docker 运行
docker run --rm linquickrec/perf-collector:latest test
```

覆盖 16 个测试用例：

| 类别 | 测试内容 |
|------|----------|
| PerfRingRegistry | 基本 push/take、溢出丢弃 |
| BRPC 注册 | PerfService + ApiHandlerService 注册与启停 |
| API 处理器 | `/health` 200、`/stats/current` 200/400/404、`/not_found` 404 |
| PerfService | `/debug/perf` 返回 spans JSON |
| OutlierDetector | z-score 正常/异常/边界判断 |
| SqliteStore | 批量写入、轨迹查询、过期清理、空 batch、无效路径 |
| 统计引擎 | 100 条 span 注入，验证 avg/p50/p99 |
| 系列管理 | start/stop、span 计数、列表查询 |
| SpanTree | 跨服务调用链树构建 |

### curl 测试

```bash
# 健康检查
curl -s http://127.0.0.1:32000/api/v1/health

# 查看所有已发现下游服务的阶段统计
for svc in proxy feature_service recall_service precalc_service rank_service rank_sub; do
  echo "=== $svc ==="
  curl -s "http://127.0.0.1:32000/api/v1/stats/current?service=$svc&stage=${svc}_e2e"
  echo
done

# 系列管理
curl -s -X POST "http://127.0.0.1:32000/api/v1/series/start?name=baseline"
sleep 5
curl -s -X POST "http://127.0.0.1:32000/api/v1/series/stop"
curl -s http://127.0.0.1:32000/api/v1/series

# 离群值检测
curl -s "http://127.0.0.1:32000/api/v1/outliers?service=proxy&stage=proxy_e2e"
```

## 端口对照表

| 端口 | 服务 | 协议 | 说明 |
|------|------|------|------|
| 8080 | perf-collector-service | HTTP | REST API（ClusterIP，内部访问） |
| 32000 | perf-webui | HTTP | nginx 静态 WebUI + API 反向代理（NodePort） |
