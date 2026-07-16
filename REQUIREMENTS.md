# LinQuickRec Requirements

## 需求总览

| # | 需求 | 优先级 | 状态 |
|---|------|--------|------|
| R01 | LinQuickRec 核心微服务系统（8 个服务）| P0 | ✅ 已完成 |
| R02 | etcd + sidecar 服务发现机制 | P0 | ✅ 已完成 |
| R03 | Perf 可观测性公共库（RingBuffer + perf::Log()）| P0 | ✅ 已完成 |
| R04 | Perf-collector — 数据拉取、持久化、HTTP 接口功能开发 | P0 | ✅ 已完成 |
| R05 | Perf-webui — SPA 框架 + Perf 标签页（调用树、比例条、详情面板、主题切换）| P1 | 🔧 开发中 |
| R06 | Test 标签页 — 单请求 / 顺序 / 并发压测 + 自动 Perf Series | P1 | 🔧 开发中 |
| R07 | Series 标签页 — active 互斥 + SQLite 持久化 | P1 | 🔧 开发中 |
| R08 | Trace 标签页 — 聚合列表分页 + 搜索 + 瀑布图详情 | P1 | 🔧 开发中 |
| R09 | Downloads 标签页 — 4 种导出格式 + 过滤器 | P2 | 🔧 开发中 |
| R10 | `deploy-to-k8s.sh` — 全量/单服务部署脚本 | P1 | ✅ 已完成 |
| R11 | `build-images.sh` — docker compose build 包装 | P1 | ✅ 已完成 |
| R12 | `push-to-registry.sh` — 镜像标签推送 | P1 | ✅ 已完成 |
| R13 | `send-proxy-request.sh` — 代理压测工具 | P2 | ✅ 已完成 |
| R14 | `watch.sh` — 部署后多阶段健康检查 | P1 | 🔧 调试中 |
| R15 | kube-prometheus-stack 集成（perf 指标暴露 + Grafana 大盘）| P2 | ⬜ 未开始 |

---

## 详细描述

### R01 — LinQuickRec 核心微服务系统

设计并开发 8 个 BRPC 微服务（Proxy 网关、Feature 特征 Mock、Recall 召回、Precalc 预计算、RankMaster 排序主控、RankSub 排序子节点、Discovery 服务发现、KVWorker 数据缓存），完整模拟推荐系统调用链路：特征 → 召回+预计算（并行）→ 排序。外部依赖：Recall 可选 vLLM（Qwen3-0.6B :8000），Precalc 和 RankMaster 依赖 KVWorker（元戎 SDK :31501/:31502）。

### R02 — etcd + sidecar 服务发现机制

每个业务服务容器通过 `discovery_client` sidecar 进程将本服务实例注册到 etcd，Proxy 通过 etcd 动态发现下游服务地址和端口，实现 round-robin 负载均衡、失败重试和熔断。etcd 基于 5 节点 StatefulSet 集群，数据存放在 `/var/lib/etcd`，通过 headless Service 实现 Pod 间 DNS 互发现。

### R03 — Perf 可观测性公共库

在 `common/` 中实现无锁 PerfRingBuffer，通过 CAS 原子操作零阻塞 Push/TakeAll，容量 50000 条，嵌入各业务服务通过 `perf::Log()` 在请求处理路径中记录 span（service/stage/duration_ms/trace_id/status）。各服务通过 PerfService 在 `/debug/perf` 端点暴露 span 快照 JSON 供 collector 拉取。

### R04 — Perf-collector 数据拉取、持久化、HTTP 接口

开发 Perf-collector BRPC 服务：通过 etcd 动态发现 6 个下游服务并每秒拉取 `/debug/perf` span。基于 Welford 增量算法实时计算 avg/p50/p99/min/max/stddev，Reservoir Sampling 维持分位数近似值。基于 WAL 模式 SQLite 批量持久化 span，支持按 trace_id 查询调用链并聚合 trace 列表。实现 8 个 RESTful API 端点（health / stats/current / stages / traces / series / outliers / download）供 WebUI 调用。Series 持久化到 SQLite 并绑定 span 的 series_id 列，启动时异步从历史 span 重建 StatsEngine 内存统计。WebUI 初始化时轮询 health 显示进度条。独立日志体系覆盖 puller 周期、API 请求追踪、SQLite 写入、StatsEngine 首次注册。架构拆分为 collector（ClusterIP 仅 REST API）和 webui（nginx NodePort 静态文件 + /api/ 反向代理）。

### R05 — Perf-webui SPA 框架 + Perf 标签页

基于 Tabler 设计语言的纯前端单页应用（无外部 CSS/JS 框架依赖）。5 个标签页导航 + 深色/浅色主题切换（localStorage 持久化 + 系统偏好检测）。Perf 标签页：固定 proxy_e2e 端到端时延的 6 个指标卡片 + 纯 Canvas 柱状图（max-width 800px，无 Chart.js CDN）。底部调用树展示所有 stage 层级关系，每个阶段显示子级时延占父级百分比的比例条（彩色，按服务区分），点击任意节点在右侧详情面板显示该阶段 mini 指标 + mini 柱状图。每 3 秒自动刷新 proxy_e2e 顶部数据。浏览器 Console 全模块日志。

### R06 — Test 标签页

Single / Sequential / Concurrent 三种压测模式。可配置 user_id（序列递增/随机）、payload 大小和单位（B/KB/MB）、请求数量。进度条实时显示进度，完成后展示每条 user_id/duration/status + 统计汇总（total/ok/errors/avg/p50/p99/min/max）。可选自动 Perf Series：发送前自动 start、完成后自动 stop，方便在 Perf 标签分析。nginx 新增 `/Proxy/` 反向代理转发到 proxy-service。

### R07 — Series 标签页

列表展示所有系列（ID/Name/Status/Span Count），+ New Series 创建、Stop Active 停止。同时最多一个 active 系列，已有 active 时新建按钮禁用并提示。点击行展开详情（status/span_count）。Series 记录持久化到 SQLite（series 表），span 通过 series_id 列关联；collector 重启后历史 series 从 SQLite 恢复。

### R08 — Trace 标签页

默认聚合列表分页展示所有 trace（trace_id/time/span count/duration），Load More 加载下 20 条。搜索框按 trace_id 精确搜索。点击任意行显示该 trace 瀑布图（按服务彩色圆点着色、层级缩进、duration 数值 + 横向条、status badge ok/error、底部 10ⁿ ms 参考标尺 + span 总数/总耗时）。

### R09 — Downloads 标签页

按 All / By Trace ID / By Series ID 过滤。支持 CSV、JSON Lines、Pretty JSON、Log Text 四种导出格式。可设导出条数上限（默认 10000，最大 100000）。后端 `GET /api/v1/download` 通过 Content-Disposition 头触发浏览器文件下载。

### R10 — deploy-to-k8s.sh

全量/单服务 start/stop/restart/delete 操作脚本。通过 kustomize overlay 动态生成部署清单，支持 `-r` 参数改写镜像 registry 地址。全量 restart 使用 `kubectl rollout restart` 保留 Deployment spec（不覆盖私仓镜像配置）。服务别名：etcd、feature、proxy、precalc、recall、rank-sub、perf-collector、perf-webui。

### R11 — build-images.sh

docker compose build 包装脚本，可从任意目录执行。支持 `--push <reg>` 自动构建后推送、`--clean` 清理本地镜像、`--vllm` 启用 vLLM 模式、`--no-cache` 强制重建。默认构建全部服务，可指定单服务。

### R12 — push-to-registry.sh

将本地 Docker 镜像标签化并推送到私有 registry。支持别名匹配（如 `perf-collector-service` → `perf-collector`），`--dry-run` 预览模式。可指定单镜像或全部。

### R13 — send-proxy-request.sh

代理压测工具，支持 K8s 模式（通过 kubectl proxy）和直连模式（--url）。可配并发度（-c）和请求量（-n），输出每条请求延迟 + Min/Avg/P95/P99/Max 汇总统计。

### R14 — watch.sh

部署后 6 阶段健康检查脚本：集群可达性 + 命名空间存在性 → Pod 快照 → etcd 健康检查（curl :32379 /health，错误时自动 kubectl describe + logs）→ Pod 就绪轮询 + 错误状态自动检测（CrashLoopBackOff/ImagePullBackOff/ErrImagePull）→ etcd 服务注册验证 → WebUI 可达性检查（curl :32000 /index.html）。超时可配（默认 600s），错误即时终止。

### R15 — kube-prometheus-stack 集成

未开始。目标：将 Perf-collector 的 StatsEngine 指标暴露为 Prometheus endpoint，通过 Grafana 大盘可视化。同时集成各业务服务的 BRPC bvar 指标。
