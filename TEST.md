# LinQuickRec 服务测试文档

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

| 场景 | Mock vLLM 响应 | 实际 error_code | 实际耗时 |
|------|---------------|----------------|---------|
| 正常路径 | 5个有效SKU | 0 (OK) | vllm_rpc≈1ms, recall_total≈1.2ms |
| vLLM不可达 | Connection refused | 0x01000002 (SERVICE_ERROR[2]) | vllm_rpc≈0.6ms |
| vLLM返回非法JSON | `{ this is not valid json` | 0x01000003 (SERVICE_ERROR[3]) | vllm_rpc≈0.6ms |
| vLLM返回空choices | `{"choices":[]}` | 0x01000003 (SERVICE_ERROR[3]) | vllm_rpc≈0.9ms |
| vLLM返回不足5个SKU | 3个SKU（需要报错） | 0 (OK, 随机补足2个) | vllm_rpc≈0.4ms, recall_total≈0.5ms |

**已有的测试覆盖：** vLLM HTTP 可用性、JSON解析、SKU数量不足时的随机填充、SKU去重。

**待补充的异常测试：**
- vLLM返回超时（HTTP 504）
- vLLM返回非JSON格式（如纯文本）
- vLLM返回的SKU格式异常（包含非数字字符、长度不足6位）
- vLLM返回重复SKU（去重逻辑验证）
- FLAGS_enable_vllm=false 时的降级逻辑
- HTTP请求超时场景（FLAGS_vllm_timeout_ms 触发）
- 重试逻辑（FLAGS_vllm_max_retry > 0）

---

## 3. Precalc 服务

**测试文件：** `services/precalc-and-rank-master/tests/precalc_integration_test.cpp`

**测试的功能：**

| 场景 | user_feat | trace_id | 实际 error_code | 实际耗时 |
|------|----------|---------|----------------|---------|
| 正常路径 | 非空 | trace_12345678abcd | 0 | precalc_total≈0.15ms |
| user_feat为空 | "" | trace_87654321dcba | 0x01000001 (INVALID_INPUT[1]) | — |
| trace_id<16字符哈希回退 | 非空 | short_trace | 0, key=da90d5511426f728 | precalc_total≈0.14ms |
| KVClient.Init()失败 | 非空 | trace_init_fail_1234 | 0x01000002 (SERVICE_ERROR[2]) | — |
| KVClient.Create()失败 | 非空 | trace_create_fail_123 | 0x01000003 (SERVICE_ERROR[3]) | — |
| KVClient.Set()失败 | 非空 | trace_set_fail_12345 | 0x01000004 (SERVICE_ERROR[4]) | — |
| precalc_result_size_mb=0 | 非空 | trace_zero_size_12345 | 0, payload=0字节 | precalc_total≈0.11ms |
| TTL=0 | 非空 | trace_ttl_zero_123456 | 0 | precalc_total≈0.15ms |
| precalc_sleep_time=10ms | 非空 | trace_sleep_1234567890 | 0 | precalc_total≈10.81ms |

**已有的测试覆盖：** 输入验证（user_feat非空）、KVWorker写入（Init/Create/Set三阶段）、payload返回、trace_id哈希回退、KVClient错误传播、边界值（size=0/TTL=0）、sleep模拟。

**待补充的异常测试：**
- precalc_result_size_mb 为负数
- 并发写入同一 user_feat_key（覆盖逻辑）
- Discovery服务不可用时的fallback

---

## 4. RankMaster 服务

**测试文件：** `services/precalc-and-rank-master/tests/integration_test.cpp`

**测试的功能：**

| 场景 | user_feat_key | sku_ids | 预期结果 |
|------|--------------|---------|---------|
| 正常路径 | 非空 | [1001,1002] | error_code=0, 返回2个排序后SKU |
| user_feat_key为空 | "" | [1001,1002] | error_code=EMPTY_USER_FEAT_KEY |
| sku_ids为空 | 非空 | [] | error_code=EMPTY_SKUS |

**已有的测试覆盖：** 输入验证、RankSub下游调用。

**待补充的异常测试：**
- RankSub服务不可用（Discover失败、超时）
- RankSub返回空结果
- RankSub返回大量候选（性能/边界）
- KVClient.Get() key不存在
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
| parse_skus_from_string | 空字符串、正常3个SKU、尾部不足6位、短字符串(<6位)、500个SKU |
| simulate_score | 确定性（同输入同输出）、[0,100)范围、SKU不同、user_feat不同、feat不同长度、SKU为0 |

**集成测试（integration_test.cpp）覆盖的RPC：**

| 场景 | user_feat | sku_ids | 预期结果 |
|------|----------|---------|---------|
| 正常路径 | 非空 | [1001,1002] | error_code=0, 返回2个SKU+分数 |
| user_feat为空 | "" | [1001,1002] | error_code=EMPTY_USER_FEAT |
| sku_ids为空 | 非空 | [] | error_code=EMPTY_SKUS |

**已有测试覆盖：** SKU解析逻辑、分数计算逻辑、RPC输入验证。

**待补充的异常测试：**
- 大量 sku_ids（如 10000个）的处理能力和性能
- sku_id 超大值（如超出uint64范围）
- user_feat 超大（如 10MB）
- simulate_score 中模拟超时或异常退出
- 分数排序一致性（相同输入排序结果一致）

---

## 6. Proxy 服务

**测试文件：** `services/proxy/tests/integration_test.cpp`

**测试的功能：**

| 场景 | 故障服务 | 预期error_code |
|------|---------|---------------|
| 正常路径 | 无 | 0, 返回9个候选（3轮pipeline各3个） |
| Feature故障 | MockFeatureServiceFailing | 0x01030001 |
| Recall故障 | MockRecallServiceFailing | 0x01030002 |
| Precalc故障 | MockPrecalcServiceFailing | 0x01030003 |
| Rank故障 | MockRankServiceFailing | 0x01030004 |

**已有的测试覆盖：** 完整pipeline链路、下游服务任意一环失败时的错误传播。

**待补充的异常测试：**
- 多个下游服务同时故障
- 下游服务超时（而非立即失败）
- Discovery服务不可用时Proxy启动失败
- Retry场景（下游单次失败后重试成功）
- 熔断场景（下游持续失败触发熔断）
- 用户特征为空时的降级行为
- Recall返回候选不足（如0个）时的处理
- Precalc返回的payload大小异常
- Rank排序后候选为空
- 并发请求（多线程同时调用Recommend）

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

**测试文件：** `services/perf/collector/tests/integration_test.cpp`

**测试的功能：**

| 组件 | 测试内容 |
|------|---------|
| StatsEngine | 100个值(1-100)统计: Count/Min/Max/Avg/P50/P99 |
| SqliteStore | 批量写入Span、查询指定trace、Cleanup(0) |
| SeriesManager | 创建series、递增span_count、停止series |
| SpanTree | 跨服务8个span建树、验证父子关系 |

**已有测试覆盖：** 统计计算、持久化存储、时间线管理、Span树结构。

**待补充的异常测试：**
- StatsEngine: 大量数据（100万+）的P99计算性能和精度
- StatsEngine: 并发push（多线程同时写入）
- SqliteStore: 数据库文件损坏的容错
- SqliteStore: 磁盘空间不足的写入失败
- SeriesManager: series数量超过内存限制
- SeriesManager: stop后再次stop的幂等性
- SpanTree: 缺少根span的异常输入
- SpanTree: 循环依赖的span关系（span A是span B的父亲，span B也是span A的父亲）

---

## 测试覆盖率总览

| 服务 | 已覆盖场景 | 待补充场景数 |
|------|-----------|------------|
| Feature | 11 | 7+ |
| Recall | 5 | 7+ |
| Precalc | 9 | 0 |
| RankMaster | 3 | 6+ |
| RankSub | 14 (单元11+集成3) | 4+ |
| Proxy | 5 | 9+ |
| Discovery | 9 (跨3个测试文件) | 6+ |
| PerfCollector | 4 | 7+ |
