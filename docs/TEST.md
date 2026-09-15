# LinQuickRec 服务测试文档

## 0. 测试架构概述

### 0.1 测试类型

| 类型 | 说明 | 执行方式 | 位置 |
|------|------|---------|------|
| 单元测试 | 公共库纯逻辑（错误码/日志/PerfRingBuffer/线程池）、RankSub 纯函数 | 编译运行独立可执行文件 | `common/tests/`、`services/rank_sub/tests/test_rank_sub.cpp` |
| 集成测试 | 单进程内启动 Mock Server，通过 BRPC RPC 模拟完整调用链 | 编译运行独立可执行文件 | `services/*/tests/integration_test.cpp` |
| E2E 测试 | WebUI 端到端（Playwright），在服务器 Docker 中运行 | `bash scripts/run-tests.sh` | `services/perf/webui/tests/` |
| 压测工具 | 代理并发压测，输出 Min/Avg/P95/P99/Max | `scripts/send-proxy-request.sh` | `scripts/` |
| Discovery 集成 | 依赖运行中的 Discovery 服务器，验证注册/心跳/清理 | 编译运行独立可执行文件 | `services/discovery/examples/tests/` |

### 0.2 测试文件清单

| 文件 | 行数 | 类型 |
|------|------|------|
| `common/tests/test_error.cpp` | 127 | 单元测试 |
| `common/tests/test_logger.cpp` | 65 | 单元测试 |
| `common/tests/test_perf_registry.cpp` | 123 | 单元测试 |
| `common/tests/test_thread_pool.cpp` | 86 | 单元测试 |
| `services/feature/tests/integration_test.cpp` | 226 | 集成测试 |
| `services/recall/tests/recall_integration_test.cpp` | 329 | 集成测试 |
| `services/precalc-and-rank-master/tests/precalc_integration_test.cpp` | 260 | 集成测试 |
| `services/precalc-and-rank-master/tests/integration_test.cpp` | 265 | 集成测试 |
| `services/rank_sub/tests/test_rank_sub.cpp` | 184 | 单元测试 |
| `services/rank_sub/tests/integration_test.cpp` | 190 | 集成测试 |
| `services/proxy/tests/integration_test.cpp` | 576 | 集成测试 |
| `services/perf/collector/tests/integration_test.cpp` | 794 | 集成测试 |
| `services/discovery/examples/tests/test_register.cpp` | 118 | 集成测试（依赖服务器） |
| `services/discovery/examples/tests/test_heartbeat_cycle.cpp` | 176 | 集成测试（依赖服务器） |
| `services/discovery/examples/tests/test_discover.cpp` | 63 | 集成测试（依赖服务器） |
| `services/perf/webui/tests/perf-webui.spec.js` | 162 | E2E 测试 |

### 0.3 测试执行命令

```bash
# C++ 单元/集成测试（需在基础镜像 linquickrec/base:latest 中编译运行）
cd build && ./bin/feature_integration_test
cd build && ./bin/recall_integration_test
cd build && ./bin/precalc_integration_test
cd build && ./bin/rank_master_integration_test
cd build && ./bin/rank_sub_unit_test
cd build && ./bin/rank_sub_integration_test
cd build && ./bin/proxy_integration_test
cd build && ./bin/perf_integration_test
cd build && ./bin/test_error && ./bin/test_logger && ./bin/test_perf_registry && ./bin/test_thread_pool

# WebUI E2E（服务器 Docker 中运行）
bash scripts/run-tests.sh

# 代理压测
scripts/send-proxy-request.sh -c 10 -n 1000
```

---

## 1. Feature 服务

**测试文件：** `services/feature/tests/integration_test.cpp`

**测试的功能：**

| 场景 | 输入 | 预期结果 | 实际结果 | 通过 |
|------|------|---------|---------|------|
| happy path | user_id=42, sku_ids=[1001,1002] | error_code=0, user_logs=10, sku_feats=2 | error_code=0, user_logs=10, sku_feats=2 | :white_check_mark: |
| user_id is zero | user_id=0 | error_code=EMPTY_USER_ID, user_logs=0 | error_code=FEATURE::INVALID_INPUT[1], user_logs=0 | :white_check_mark: |
| sku_ids is empty | user_id=42, sku_ids=[] | error_code=EMPTY_SKU_IDS, sku_feats=0 | error_code=FEATURE::INVALID_INPUT[2], sku_feats=0 | :white_check_mark: |
| user_id zero and sku_ids empty | user_id=0, sku_ids=[] | user: EMPTY_USER_ID, sku: EMPTY_SKU_IDS | user: INVALID_INPUT[1], sku: INVALID_INPUT[2] | :white_check_mark: |
| single sku | user_id=42, sku_ids=[999999] | error_code=0, user_logs=10, sku_feats=1 | error_code=0, user_logs=10, sku_feats=1 | :white_check_mark: |
| sku_id is zero | user_id=42, sku_ids=[0] | error_code=0, user_logs=10, sku_feats=1 | error_code=0, user_logs=10, sku_feats=1 | :white_check_mark: |
| large sku_id | user_id=42, sku_ids=[UINT64_MAX] | error_code=0, user_logs=10, sku_feats=1 | error_code=0, user_logs=10, sku_feats=1 | :white_check_mark: |
| many sku_ids | user_id=42, sku_ids=[1000..10000] x10 | error_code=0, user_logs=10, sku_feats=10 | error_code=0, user_logs=10, sku_feats=10 | :white_check_mark: |
| concurrent happy path | user_id=42, sku_ids=[1001,1002], 10线程 | user: 0, sku: 0 | user: 0, sku: 0, 10/10次全部通过 | :white_check_mark: |
| concurrent empty user_id | user_id=0, sku_ids=[1001,1002], 10线程 | user: EMPTY_USER_ID, sku: 0 | user: INVALID_INPUT[1], sku: 0, 10/10次全部通过 | :white_check_mark: |
| concurrent empty sku_ids | user_id=42, sku_ids=[], 10线程 | user: 0, sku: EMPTY_SKU_IDS | user: 0, sku: INVALID_INPUT[2], 10/10次全部通过 | :white_check_mark: |

**已有的测试覆盖：** 输入验证（user_id和sku_ids非空）、正常数据返回、边界值（单条/零值/UINT64_MAX/大量）。

**待补充的异常测试：**
- 服务内部错误（如 `get_user_logs` / `get_sku_features` 返回异常）
- user_id 存在但无用户特征数据的情况（需改造服务实现）
- feature_type 为其他类型（KuaiRec 等）时的处理
- FLAGS_feature_sleep_time_ms 边界（极大值、负数）
- FLAGS_feature_payload_size_kb 边界（极大值、负数）
- FLAGS_user_log_count 边界（0、极大值）
- FLAGS_user_log_vec_size 边界（0、极大值）
- FLAGS_sku_feat_length 边界（0、极大值）
- 并发请求（多线程同时调用 GetUserFeatures/GetSKUFeatures）
- GetUserFeatures 与 GetSKUFeatures 交叉调用时的线程安全
---

## 2. Recall 服务

**测试文件：** `services/recall/tests/recall_integration_test.cpp`
**辅助工具：** `services/recall/tests/recall_test_client.cpp`

**测试的功能：**

| 场景 | Mock vLLM 响应 | timeout | 实际 error_code | 实际耗时 |
|------|---------------|---------|----------------|---------|
| 正常路径 | 5个有效SKU | 3000ms | 0 (OK) | vllm_rpc≈1.3ms, recall_total≈1.5ms |
| vLLM不可达 | Connection refused | 3000ms | 0x01000002 (SERVICE_ERROR[2]) | vllm_rpc≈0.7ms |
| vLLM返回非法JSON | `{ this is not valid json` | 3000ms | 0x01000003 (SERVICE_ERROR[3]) | vllm_rpc≈0.9ms |
| vLLM返回空choices | `{"choices":[]}` | 3000ms | 0x01000004 (NO_CHOICES) → 0x01000003 | vllm_rpc≈0.6ms |
| vLLM返回不足5个SKU | 3个SKU | 3000ms | 0 (OK, 随机补足2个) | recall_total≈1ms |
| vLLM返回HTTP 504 | Gateway Timeout | 3000ms | 0x01000002 (SERVICE_ERROR[2]) | vllm_rpc≈1ms |
| vLLM返回纯文本 | Internal Server Error | 3000ms | 0x01000002 (SERVICE_ERROR[2]) | vllm_rpc≈0.6ms |
| SKU含非数字字符 | `123abc,456xyz,111111,222222,333333` | 3000ms | 0 (过滤后OK) | recall_total≈0.7ms |
| SKU不足6位 | `123,456789,234567,345678,456789` | 3000ms | 0 (过滤+补足OK) | recall_total≈1ms |
| SKU重复去重 | `111,222,333,111,222` | 3000ms | 0 (去重+补足OK) | recall_total≈0.7ms |
| 解析后SKU为0 | `aaa,bbb,ccc` | 3000ms | 0x01000007 (NO_SKU_RETURNED) | recall_total≈1ms |
| vLLM HTTP超时 | 响应延迟500ms | **100ms** | 0x01000002 (SERVICE_ERROR[2]) | vllm_rpc≈500ms |

**已有的测试覆盖：** vLLM HTTP 可用性、JSON解析、SKU数量不足时的随机填充、SKU去重、SKU格式异常过滤、HTTP错误码、非JSON响应、超时触发。

**待补充的异常测试：**
- FLAGS_enable_vllm=false 时的降级逻辑
- 重试逻辑（FLAGS_vllm_max_retry > 0）
- vLLM连接超时（FLAGS_vllm_connect_timeout_ms 触发）

---

## 3. Precalc 服务

**测试文件：** `services/precalc-and-rank-master/tests/precalc_integration_test.cpp`

**测试的功能：**

| 场景 | user_feat | trace_id | 实际 error_code | 实际耗时 |
|------|----------|---------|----------------|---------|
| 正常路径 | 非空 | trace_12345678abcd | 0, key=ace_12345678abcd | precalc_total≈0.164ms |
| user_feat为空 | "" | — | 0x01000001 (INVALID_INPUT[1]) | — |
| trace_id<16字符哈希回退 | 非空 | short_trace | 0, key=da90d5511426f728 | precalc_total≈0.129ms |
| KVClient.Init()失败 | 非空 | trace_init_fail_1234 | 0x01000002 (SERVICE_ERROR[2]) | — |
| KVClient.Create()失败 | 非空 | trace_create_fail_123 | 0x01000003 (SERVICE_ERROR[3]) | — |
| KVClient.Set()失败 | 非空 | trace_set_fail_12345 | 0x01000004 (SERVICE_ERROR[4]) | — |
| precalc_result_size_mb=0 | 非空 | trace_zero_size_12345 | 0 | precalc_total≈0.119ms |
| TTL=0 | 非空 | trace_ttl_zero_123456 | 0 | precalc_total≈0.131ms |
| precalc_sleep_time=10ms | 非空 | trace_sleep_1234567890 | 0 | precalc_total≈10.289ms |

**已有的测试覆盖：** 输入验证（user_feat非空）、KVWorker写入（Init/Create/Set三阶段）、payload返回、trace_id哈希回退、KVClient错误传播、边界值（size=0/TTL=0）、sleep模拟。

**待补充的异常测试：**
- precalc_result_size_mb 为负数
- 并发写入同一 user_feat_key（覆盖逻辑）
- Discovery服务不可用时的fallback

---

## 4. RankMaster 服务

**测试文件：** `services/precalc-and-rank-master/tests/integration_test.cpp`

**测试的功能：**

| 场景 | user_feat_key | sku_ids | 实际 error_code | 实际耗时 |
|------|--------------|---------|----------------|---------|
| 正常路径 | user_feat_key | [1001,1002] | 0, candidates=2 | rank_master_total≈3.200ms |
| user_feat_key为空 | "" | [1001,1002] | 0x01000001 (INVALID_INPUT[1]) | — |
| sku_ids为空 | user_feat_key | [] | 0x01000002 (INVALID_INPUT[2]) | — |
| RankSub Discover失败 | user_feat_key | [1001,1002] | 0x01000003 (SERVICE_ERROR[3]) | — |
| RankSub返回空结果 | user_feat_key | [1001,1002] | 0, candidates=0 | rank_master_total≈2.837ms |
| RankSub返回1000候选 | user_feat_key | [1个] | 0, candidates=1000 | rank_master_total≈2.868ms |
| KVClient.Get() key不存在 | nonexistent_key | [1001,1002] | 0, candidates=2 | rank_master_total≈2.680ms |

**已有的测试覆盖：** 输入验证（user_feat_key/sku_ids非空）、RankSub Discover失败、RankSub返回空/大量候选、KVClient.Get() key不存在、KVClient错误传播。

**待补充的异常测试：**
- KVClient.Get() 返回数据损坏
- 并发请求场景（多个用户同时请求）
- 服务发现刷新间隔内的缓存一致性

---

## 5. RankSub 服务

**测试文件：**
- `services/rank_sub/tests/test_rank_sub.cpp`（单元测试）
- `services/rank_sub/tests/integration_test.cpp`（集成测试）

**单元测试（test_rank_sub.cpp）覆盖的纯函数：**

| 函数 | 测试用例 |
|------|---------|
| parse_skus_from_string | 空字符串、正常3个SKU、尾部不足6位、短字符串(<6位)、500个SKU、**超大SKU ID(1e18)** |
| simulate_score | 确定性（同输入同输出）、[0,100)范围、SKU不同、user_feat不同、feat不同长度、SKU为0、**10MB user_feat**、**排序一致性** |

**集成测试（integration_test.cpp）覆盖的RPC：**

| 场景 | user_feat | sku_ids | 实际 error_code | 耗时 |
|------|----------|---------|-----------------|---------|
| 正常路径 | 非空 | [1001,1002] | 0 | rank_sub_total≈0.094ms |
| user_feat为空 | "" | [1001,1002] | 0x02000001 (INVALID_INPUT[1]) | — |
| sku_ids为空 | 非空 | [] | 0x02000002 (INVALID_INPUT[2]) | — |
| single sku | 非空 | [999999] | 0 | rank_sub_total≈0.063ms |
| sku_id is zero | 非空 | [0] | 0 | rank_sub_total≈0.060ms |
| large sku_id | 非空 | [UINT64_MAX] | 0 | rank_sub_total≈0.153ms |
| many sku_ids | 非空 | 10个 | 0 | rank_sub_total≈0.051ms |
| large user_feat (10MB) | 10MB | [1001,1002] | 0 | rank_sub_total≈5.758ms |
| 并发正常路径 | 非空 | [1001,1002] | 0 | 10线程全部ok |
| 并发空user_feat | "" | [1001,1002] | 0x02000001 | 10线程全部ok |
| 并发空sku_ids | 非空 | [] | 0x02000002 | 10线程全部ok |

**已有的测试覆盖：** SKU解析逻辑、分数计算逻辑、RPC输入验证、大量SKU、大user_feat、10线程并发、排序一致性。

**待补充的异常测试：**
- simulate_score 中模拟超时或异常退出

---

## 6. Proxy 服务

**测试文件：** `services/proxy/tests/integration_test.cpp`

**测试的功能：**

| 场景 | 故障服务 | 预期error_code | 预期候选数 | 验证 |
|------|---------|---------------|---------|------|
| 正常路径 | 无 | 0 | 3 | ✅ 已验证 |
| Feature故障 | MockFeatureServiceFailing | 0x01030001 | 0 | ✅ 已验证 |
| Recall故障 | MockRecallServiceFailing | 0x01030002 | 0 | ✅ 已验证 |
| Precalc故障 | MockPrecalcServiceFailing | 0x01030003 | 0 | ✅ 已验证 |
| Rank故障 | MockRankServiceFailing | 0x01030004 | 0 | ✅ 已验证 |
| Recall返回空SKUs | MockRecallServiceEmpty | 0x01030004 | 0 | ✅ 已验证 |
| Feature返回空payload | MockFeatureServiceEmptyPayload | 0 | 3 | ✅ 已验证 |
| Rank返回空候选 | MockRankServiceEmpty | 0x01030004 | 0 | ✅ 已验证 |
| Precalc返回大payload(5MB) | MockPrecalcServiceLargePayload | 0 | 3 | ✅ 已验证 |
| 多服务同时故障 | MockMultiServiceFailing | 0x01030001 | 0 | ✅ 已验证 |
| 5线程并发请求 | 无 | 0 | 3（每个请求） | ✅ 已验证 |

**已有的测试覆盖：** 完整pipeline链路、下游服务任意一环失败时的错误传播、空边界场景（空SKU/空payload/空候选）、大payload处理、多服务同时故障、并发请求。**全部 11 个场景已 Docker 验证通过，无日志双打。**

**待补充的异常测试：**
- 下游服务超时（而非立即失败）— 需要修改 proxy_server.cpp 的 timeout 逻辑
- Discovery服务不可用时Proxy启动失败 — 需要 proxy_server.cpp 改动
- Retry场景（下游单次失败后重试成功）— 属于 service_discovery 实现
- 熔断场景（下游持续失败触发熔断）— 属于 service_discovery 实现

---

## 7. Discovery 服务

**测试文件：**
- `services/discovery/examples/tests/test_register.cpp`
- `services/discovery/examples/tests/test_heartbeat_cycle.cpp`
- `services/discovery/examples/tests/test_discover.cpp`

**注意：** 以下测试依赖运行的Discovery服务器，非单进程in-process测试。

**test_register.cpp — 测试功能：**

| 步骤 | 操作 | 验证点 |
|------|------|-------|
| 1 | Register | success=true, instance_id非空 |
| 2 | Deregister | success=true |
| 3 | Discover验证清理 | 实例数量为0 |

**test_heartbeat_cycle.cpp — 测试功能：**

| 步骤 | 操作 | 验证点 |
|------|------|-------|
| 1 | Register | 获取instance_id |
| 2 | Heartbeat | success=true |
| 3 | Discover(UP) | 1个实例, status=UP |
| 4 | 停止Heartbeat | 等待~6s后status=DOWN |
| 5 | 等待清理 | 等待~9s后实例数量=0 |

**test_discover.cpp — 测试功能：**
- 根据命令行传入service_type查询服务实例，打印所有实例信息。

**已有测试覆盖：** 注册/注销、Heartbeat保活、TTL过期清理、实例状态转换。

**待补充的异常测试：**
- 重复注册同一实例（幂等性）
- 使用已注销的instance_id继续Heartbeat
- 注册时port冲突（同一host:port重复注册）
- 长时间不Heartbeat后恢复Heartbeat（能否重新UP）
- Discover不存在的service_type
- 并发注册/注销同一服务
- Discovery服务器重启后的数据恢复

---

## 8. Perf Collector 服务

**测试文件：** `services/perf/collector/tests/integration_test.cpp`（794 行，24 个测试函数）

**测试的功能（按执行顺序）：**

| # | 测试函数 | 组件 | 测试内容 | 断言条件 | 预期输出 |
|---|---------|------|---------|---------|---------|
| 1 | `test_perf_registry_basic` | PerfRingRegistry | 单条 Push + TakeAll + 清空后为空 | `spans.size()==1`, `duration_ms==123.4`, `service==proxy`, `snap2.empty()` | `[PASS] perf_registry_basic: push=1 take=0` |
| 2 | `test_perf_registry_overflow` | PerfRingRegistry | 溢出覆盖：200 Push → 最多 100 条 + dropped ≥ 100 | `dropped>=100`, `spans.size()<=100` | `[PASS] perf_registry_overflow: spans=100 dropped=100` |
| 3 | `test_brpc_services_registered` | BRPC Service | PerfService + ApiHandlerService 注册启动 | `server.AddService==0`, `server.Start==0` | `[PASS] brpc_services_registered` |
| 4 | `test_perf_service_dump` | PerfService | `/debug/perf` 返回 spans JSON | status=200, body 含 `proxy_e2e` 和 `spans` | `[PASS] perf_service_dump` |
| 5 | `test_api_handler_health` | ApiHandler | `/api/v1/health` 返回 200 OK | status=200, body 含 `ok` | `[PASS] api_handler_health: 200 OK` |
| 6 | `test_api_handler_stats` | ApiHandler | `/stats/current` 的 200/400/404 三种响应 | 缺参数回 400, 合法查询回 200, 不存在回 404 | `[PASS] api_handler_stats: 200/400/404 correct` |
| 7 | `test_api_handler_not_found` | ApiHandler | 不存在端点返回 404 | status=404 | `[PASS] api_handler_not_found: 404` |
| 8 | `test_outlier_basic` | OutlierDetector | z-score 阈值判定：z=0 非离群, z=2 非离群, z=4 离群 | `IsOutlier` 返回值正确 | `[PASS] outlier_basic: thresholds correct` |
| 9 | `test_outlier_edge` | OutlierDetector | stddev=0→安全、threshold=0→恒离群、超大 threshold→安全 | 边界条件正确处理 | `[PASS] outlier_edge: stddev=0, threshold=0 handled` |
| 10 | `test_sqlite_empty_flush` | SqliteStore | 空批次 Flush 不 crash | 无异常 | `[PASS] sqlite_empty_flush: no crash on empty batch` |
| 11 | `test_sqlite_bad_path` | SqliteStore | 无效路径 Open 失败 | `!store.Open(...)` | `[PASS] sqlite_bad_path: returns false` |
| 12 | `test_sqlite_cleanup` | SqliteStore | Cleanup 保留新数据、删除旧数据 | old 查询为空, new 查询非空 | `[PASS] sqlite_cleanup: old=0 new=10` |
| 13 | `test_stats_basic` | StatsEngine | 100 值统计：Count/Min/Max/Avg/P50/P99 | Count=100, Min=1, Max=100, Avg∈[50,51], P50∈[45,55], P99∈[95,100] | `[PASS] stats_basic: count=100 avg=50.50 p50=50 p99=99` |
| 14 | `test_sqlite_store` | SqliteStore | 写入 + QueryTrace | results.size()==1, duration_ms==50.0 | `[PASS] sqlite_store: 1 results for trace5` |
| 15 | `test_series_manager` | SeriesManager | 创建 + 停止 + 列表验证 | id==1, ActiveSeriesId==0, list.size()==1, name=="baseline" | `[PASS] series_manager: id=1 count=2` |
| 16 | `test_span_tree` | SpanTree | 跨服务 8 span 建树，验证跨服务链接 | 树结构正确, cross-service linked | `[PASS] span_tree` |
| 17 | `test_stats_concurrent` | StatsEngine | 4 线程 × 10000 并发 Push | Count==40000 | `[PASS] stats_concurrent: count=40000` |
| 18 | `test_stats_large_data` | StatsEngine | 1M 值 Push：验证 P99 精度 | Count=1M, Min=0, Max=999999, Avg∈[499k,501k], P99∈[990k,1000k] | `[PASS] stats_large_data: 1M values` |
| 19 | `test_sqlite_corruption` | SqliteStore | 损坏文件 Open 失败 | `!store.Open(...)` | `[PASS] sqlite_corruption: invalid file` |
| 20 | `test_sqlite_full_disk` | SqliteStore | 无效路径返回 false（模拟磁盘满场景） | `!store.Open("/proc/...")` | `[PASS] sqlite_fulldisk` |
| 21 | `test_series_manager_idempotent_stop` | SeriesManager | 连续两次 Stop 安全（幂等性） | ActiveSeriesId==0 两次 | `[PASS] series_manager_idempotent: double-stop safe` |
| 22 | `test_series_manager_many` | SeriesManager | 100 个 series 累积 | list.size() 增加至少 100 | `[PASS] series_manager_many: 100 new series` |
| 23 | `test_span_tree_no_root` | SpanTree | 缺少根 span 时生成 synthetic root | 根 stage=="proxy_total", children 包含 feature_rpc+recall_rpc | `[PASS] span_tree_no_root: synthetic root created` |
| 24 | `test_span_tree_circular` | SpanTree | 循环 template 不 crash | 正常返回树结构 | `[PASS] span_tree_circular: no crash with circular template` |

**已有的测试覆盖：** 统计计算、持久化存储、时间线管理、Span树结构、并发push、空/损坏输入容错、BRPC service 注册（曾 segfault 路径）、API handler HTTP 响应码。**全部 24 个场景已 Docker 验证通过。**

**待补充的异常测试：**
- SqliteStore: 磁盘空间不足的真实写入失败（当前用无效路径模拟）

---

## 9. 公共库单元测试

**测试文件：** `common/tests/`（4 个可执行文件，共 401 行）

### 9.1 test_error.cpp — 错误码体系

| # | 测试块 | 验证点 | 预期输出 |
|---|--------|-------|---------|
| 1 | OK status | `IsOk()==true`, `Code()==SUCCESS`, `ToString()=="OK"`, `GetModule()==COMMON` | `[PASS] OK status` |
| 2 | Error status | `IsError()==true`, `Code()==INVALID_ARGUMENT`, `Message()` 匹配 | `[PASS] Error status: ...` |
| 3 | 便捷错误函数 | InvalidArgument/Resource/NotFound/Timeout/Network/Internal 六种 `GetType()` 正确 | `[PASS] All convenience error functions` |
| 4 | 模块/类型提取 | `MakeErrorCode` + `GetModuleFromCode`/`GetTypeFromCode`/`GetSpecificCodeFromCode` | `[PASS] Module/Type/SpecificCode extraction` |
| 5 | 模块码转字符串 | `ModuleToString(PRECALC)=="PRECALC"` | `[PASS] ModuleCode: PRECALC` |
| 6 | 错误类型转字符串 | `ErrorTypeToString(CONFIG_ERROR)=="CONFIG_ERROR"` | `[PASS] ErrorTypeToString` |
| 7 | 比较运算符 | `a==b`, `a!=c`, `a==SUCCESS` | `[PASS] Comparison operators` |
| 8 | Bool 转换 | `ok==true`, `err==false` | `[PASS] Bool conversion` |
| 9 | 错误码转字符串 | `ErrorCodeToString(PERMISSION_DENIED)` 非空 | `[PASS] ErrorCodeToString: ...` |
| 10 | 拷贝/赋值 | `copied==original`, `assigned==original` | `[PASS] Copy and assignment` |

### 9.2 test_logger.cpp — 日志系统

| # | 测试块 | 验证点 |
|---|--------|-------|
| 1 | 错误码集成 | OK/Error status 输出 |
| 2 | 流式日志 | LOG_INFO/LOG_WARN/LOG_ERROR 输出 |
| 3 | 条件日志 | LOG_IF(DEBUG, false) 不输出, LOG_IF(DEBUG, true) 输出 |
| 4 | trace_id 获取器 | `SetTraceIdGetter` 后日志自动附加 trace_id |
| 5 | 文件日志 | FileSink 写入 `test_log.log`, 配置 max_file_size/max_files |

### 9.3 test_perf_registry.cpp — PerfRingBuffer

| # | 测试函数 | 测试内容 | 断言条件 |
|---|---------|---------|---------|
| 1 | `test_push_and_snapshot` | 50 Push + TakeAll + 二次 TakeAll 为空 | `spans.size()==50`, `dropped==0`, `snap2.size()==0` |
| 2 | `test_overflow` | 150 Push（容量 100）溢出 | `spans.size()==100`, `dropped>=50` |
| 3 | `test_registry_singleton` | 单例 Init + Push + TakeAll + 重复 Init no-op | `Initialized()`, `spans.size()==10` |
| 4 | `test_push_before_init_is_noop` | Init 前 Push 安全 | 不 crash, Init 后正常 |

### 9.4 test_thread_pool.cpp — 线程池

| # | 测试块 | 测试内容 | 断言条件 |
|---|--------|---------|---------|
| 1 | 创建线程池 | 4 线程池 size 检查 | `pool.size()==4`, `pending_tasks()==0` |
| 2 | 提交任务取结果 | 2 线程池 a+b | `result==7` |
| 3 | 100 并发任务 | 4 线程池原子计数 | `counter==100` |
| 4 | 带返回值任务 | 10 任务平方和 | `sum==285` |
| 5 | 待处理任务计数 | 1 线程池阻塞任务 | `pending_tasks()>=1` |
| 6 | 析构前任务完成 | 任务在池销毁前完成 | `future.get()==42` |

---

## 10. Playwright WebUI E2E 测试

**测试文件：** `services/perf/webui/tests/perf-webui.spec.js`（12 个用例）

**执行方式：** `bash scripts/run-tests.sh` — 上传测试文件到服务器 `lighthouse@114.132.51.227`，Docker 构建 Playwright 镜像，访问 `localhost:32000` 运行。

| # | 用例 | 验证点 |
|---|------|-------|
| T01 | tab persistence | 切换到 Test 标签 → 刷新页面 → Test 面板仍可见（localStorage 持久化） |
| T02 | series detail view hides list | Series 列表 → 点击行 → 显示详情（Back to List 可见） |
| T03 | series reactivate button | 有 active 系列时先 Stop → 打开详情 → 激活按钮可见 |
| T04 | trace Back button position | Trace 列表 → 点击行 → 瀑布图详情 → Back 按钮可见 |
| T05 | trace sequential number | Trace 列表首行序号为 `#1` |
| T06 | pagination all shown when <= 10 | 系列 ≤ 10 条时无 Load More 分页按钮 |
| T07 | pagination Load More and page nav | Trace 列表 Load More → Per page 可见 |
| T08 | trace search with Enter key | 输入 trace_id → Enter → 瀑布图 + "Trace ID:" 可见 |
| T09 | trace search back restores pagination | 搜索 → Back → 分页恢复可见 |
| T10 | Test panel send request | single 模式发送请求 → Total/Success/Fail 统计可见 |
| T11 | Perf tree folded by default | Perf 树根节点展开、非叶子节点折叠 |
| T12 | Metrics component layout | Test 结果 Metrics 组件两行布局 + 图表可见 |

---

## 测试覆盖率总览

| 服务 | 已覆盖场景 | 待补充场景数 |
|------|-----------|------------|
| 公共库（common） | 30 (单元测试) | 0 |
| Feature | 11 | 7+ |
| Recall | 12 | 3+ |
| Precalc | 9 | 3 |
| RankMaster | 7 | 3 |
| RankSub | 18 (单元11+集成7) | 2 |
| Proxy | 11 | 4 |
| Discovery | 9 (跨3个测试文件) | 6+ |
| PerfCollector | 24 | 1 |
| WebUI (Playwright) | 12 | 0 |
| **合计** | **143** | **29+** |
