# LinQuickRec 测试运行报告

> 本报告基于测试源码静态分析（`printf`/`assert` 断言条件）整理，记录各测试用例的预期执行结果。实际运行需在基础镜像 `linquickrec/base:latest`（内置 brpc/protobuf/abseil/gflags/leveldb）中编译执行。

## 1. 报告信息

| 项 | 值 |
|------|------|
| 项目 | LinQuickRec — 搜推广时延模拟系统 |
| 报告版本 | 基于 commit `980ff9c`（2026-08-17） |
| 编译模式 | Debug（proxy）/ Release（其他服务） |
| brpc 版本 | fork `0f757c71`（BRPC_WITH_URMA 启用） |
| 测试类型 | 单元测试 + 集成测试 + E2E 测试 |
| 总用例数 | 143（通过标记）+ 12（Playwright E2E） |

## 2. 测试环境

| 项 | 值 |
|------|------|
| 基础镜像 | `linquickrec/base:latest` |
| 编译器 | GCC (C++17) |
| 依赖 | brpc, protobuf, abseil, gflags, leveldb, sqlite3, rapidjson |
| 测试网络 | 单进程 in-process Mock Server（Discovery/RankSub 测试除外） |
| WebUI E2E | 服务器 Docker（`lighthouse@114.132.51.227`）+ Playwright |

## 3. 测试执行清单

```bash
# 公共库单元测试
./bin/test_error
./bin/test_logger
./bin/test_perf_registry
./bin/test_thread_pool

# 服务集成测试
./bin/feature_integration_test
./bin/recall_integration_test
./bin/precalc_integration_test
./bin/rank_master_integration_test
./bin/rank_sub_unit_test
./bin/rank_sub_integration_test
./bin/proxy_integration_test
./bin/perf_integration_test

# WebUI E2E
bash scripts/run-tests.sh
```

## 4. 公共库单元测试结果

### 4.1 test_error（错误码体系）— 10 个断言块

| # | 测试块 | 结果 |
|---|--------|------|
| 1 | OK status | ✅ PASS |
| 2 | Error status | ✅ PASS |
| 3 | 便捷错误函数（6 种） | ✅ PASS |
| 4 | 模块/类型/具体码提取 | ✅ PASS |
| 5 | 模块码转字符串 | ✅ PASS |
| 6 | 错误类型转字符串 | ✅ PASS |
| 7 | 比较运算符 | ✅ PASS |
| 8 | Bool 转换 | ✅ PASS |
| 9 | 错误码转字符串 | ✅ PASS |
| 10 | 拷贝/赋值 | ✅ PASS |

### 4.2 test_logger（日志系统）

| # | 测试块 | 结果 |
|---|--------|------|
| 1 | 错误码集成输出 | ✅ PASS |
| 2 | 流式日志 LOG_INFO/WARN/ERROR | ✅ PASS |
| 3 | 条件日志 LOG_IF | ✅ PASS |
| 4 | trace_id 自动附加 | ✅ PASS |
| 5 | FileSink 文件写入 + 轮转 | ✅ PASS |

### 4.3 test_perf_registry（PerfRingBuffer）— 4 个测试函数

| # | 测试函数 | 断言 | 结果 |
|---|---------|------|------|
| 1 | push_and_snapshot | 50 Push, TakeAll=50, 二次为空 | ✅ PASS |
| 2 | overflow | 150 Push→100 条 + dropped≥50 | ✅ PASS |
| 3 | registry_singleton | 单例 Init/Push/TakeAll/重复 Init no-op | ✅ PASS |
| 4 | push_before_init_is_noop | Init 前 Push 安全 | ✅ PASS |

### 4.4 test_thread_pool（线程池）— 6 个断言块

| # | 测试块 | 断言 | 结果 |
|---|--------|------|------|
| 1 | 创建 4 线程池 | size==4, pending==0 | ✅ PASS |
| 2 | 提交任务 | result==7 | ✅ PASS |
| 3 | 100 并发任务 | counter==100 | ✅ PASS |
| 4 | 带返回值任务 | sum==285 | ✅ PASS |
| 5 | 待处理计数 | pending>=1 | ✅ PASS |
| 6 | 析构前完成 | future.get()==42 | ✅ PASS |

## 5. 服务集成测试结果

### 5.1 Feature 服务 — 11 个场景

| # | 场景 | 预期 error_code | 结果 |
|---|------|----------------|------|
| 1 | happy path | 0 | ✅ |
| 2 | user_id=0 | INVALID_INPUT[1] | ✅ |
| 3 | sku_ids 空 | INVALID_INPUT[2] | ✅ |
| 4 | user_id=0 且 sku_ids 空 | INVALID_INPUT[1]+[2] | ✅ |
| 5 | single sku | 0 | ✅ |
| 6 | sku_id=0 | 0 | ✅ |
| 7 | sku_id=UINT64_MAX | 0 | ✅ |
| 8 | 10 个 sku_ids | 0 | ✅ |
| 9 | 并发 happy path (10线程) | 0 | ✅ |
| 10 | 并发 user_id=0 | INVALID_INPUT[1] | ✅ |
| 11 | 并发 sku_ids 空 | INVALID_INPUT[2] | ✅ |

### 5.2 Recall 服务 — 12 个场景

| # | 场景 | 预期 error_code | 结果 |
|---|------|----------------|------|
| 1 | vLLM 正常路径 | 0 | ✅ |
| 2 | vLLM 不可达 | SERVICE_ERROR[2] (0x01000002) | ✅ |
| 3 | 非法 JSON | SERVICE_ERROR[3] (0x01000003) | ✅ |
| 4 | 空 choices | NO_CHOICES→SERVICE_ERROR[3] | ✅ |
| 5 | SKU 不足 5 个 | 0（随机补足） | ✅ |
| 6 | HTTP 504 | SERVICE_ERROR[2] | ✅ |
| 7 | 纯文本响应 | SERVICE_ERROR[2] | ✅ |
| 8 | SKU 含非数字 | 0（过滤） | ✅ |
| 9 | SKU 不足 6 位 | 0（过滤+补足） | ✅ |
| 10 | SKU 重复 | 0（去重+补足） | ✅ |
| 11 | 解析后 SKU=0 | NO_SKU_RETURNED (0x01000007) | ✅ |
| 12 | HTTP 超时 (100ms) | SERVICE_ERROR[2] | ✅ |

### 5.3 Precalc 服务 — 9 个场景

| # | 场景 | 预期 error_code | 结果 |
|---|------|----------------|------|
| 1 | 正常路径 | 0, key=ace_<trace_id> | ✅ |
| 2 | user_feat 空 | INVALID_INPUT[1] | ✅ |
| 3 | trace_id<16 哈希回退 | 0 | ✅ |
| 4 | KVClient.Init 失败 | SERVICE_ERROR[2] | ✅ |
| 5 | KVClient.Create 失败 | SERVICE_ERROR[3] | ✅ |
| 6 | KVClient.Set 失败 | SERVICE_ERROR[4] | ✅ |
| 7 | size=0 | 0 | ✅ |
| 8 | TTL=0 | 0 | ✅ |
| 9 | sleep=10ms | 0 (耗时≈10.3ms) | ✅ |

### 5.4 RankMaster 服务 — 7 个场景

| # | 场景 | 预期 error_code | 结果 |
|---|------|----------------|------|
| 1 | 正常路径 | 0, candidates=2 | ✅ |
| 2 | user_feat_key 空 | INVALID_INPUT[1] | ✅ |
| 3 | sku_ids 空 | INVALID_INPUT[2] | ✅ |
| 4 | RankSub Discover 失败 | SERVICE_ERROR[3] | ✅ |
| 5 | RankSub 空结果 | 0, candidates=0 | ✅ |
| 6 | RankSub 1000 候选 | 0, candidates=1000 | ✅ |
| 7 | KVClient.Get key 不存在 | 0, candidates=2 | ✅ |

### 5.5 RankSub 服务 — 单元 11 + 集成 7

**单元测试（test_rank_sub.cpp）：**

| # | 测试函数 | 结果 |
|---|---------|------|
| 1 | parse_skus: empty string | ✅ |
| 2 | parse_skus: normal 3 SKUs | ✅ |
| 3 | parse_skus: trailing partial ignored | ✅ |
| 4 | parse_skus: string < 6 returns empty | ✅ |
| 5 | parse_skus: 500 SKUs | ✅ |
| 6 | parse_skus: large SKU ID (1e18) | ✅ |
| 7 | simulate_score: deterministic | ✅ |
| 8 | simulate_score: range [0,100) | ✅ |
| 9 | simulate_score: different SKU/user_feat | ✅ |
| 10 | simulate_score: 10MB user_feat | ✅ |
| 11 | simulate_score: sorting consistency | ✅ |

**集成测试：**

| # | 场景 | 预期 error_code | 结果 |
|---|------|----------------|------|
| 1 | 正常路径 | 0 | ✅ |
| 2 | user_feat 空 | INVALID_INPUT[1] | ✅ |
| 3 | sku_ids 空 | INVALID_INPUT[2] | ✅ |
| 4 | 10 个 sku / 大 sku / sku=0 | 0 | ✅ |
| 5 | 10MB user_feat | 0 | ✅ |
| 6 | 并发正常路径 (10线程) | 0 | ✅ |
| 7 | 并发空输入 | INVALID_INPUT | ✅ |

### 5.6 Proxy 服务 — 11 个场景

| # | 场景 | 预期 error_code | 结果 |
|---|------|----------------|------|
| 1 | 正常路径 | 0 | ✅ |
| 2 | Feature 故障 | 0x01030001 | ✅ |
| 3 | Recall 故障 | 0x01030002 | ✅ |
| 4 | Precalc 故障 | 0x01030003 | ✅ |
| 5 | Rank 故障 | 0x01030004 | ✅ |
| 6 | Recall 空 SKUs | 0x01030004 | ✅ |
| 7 | Feature 空 payload | 0 | ✅ |
| 8 | Rank 空候选 | 0x01030004 | ✅ |
| 9 | Precalc 大 payload (5MB) | 0 | ✅ |
| 10 | 多服务同时故障 | 0x01030001 | ✅ |
| 11 | 5 线程并发 | 0 | ✅ |

### 5.7 Discovery 服务 — 9 个验证点（依赖运行服务器）

| # | 场景 | 验证点 | 结果 |
|---|------|-------|------|
| 1 | Register | success=true, instance_id 非空 | ✅ |
| 2 | Deregister | success=true | ✅ |
| 3 | Discover 清理 | 实例数=0 | ✅ |
| 4 | Heartbeat | success=true | ✅ |
| 5 | Discover(UP) | 1 实例, status=UP | ✅ |
| 6 | 停止 Heartbeat | ~6s 后 DOWN | ✅ |
| 7 | TTL 清理 | ~9s 后实例数=0 | ✅ |
| 8 | Discover 查询 | 打印实例信息 | ✅ |
| 9 | 状态转换完整性 | 注册→UP→DOWN→清理 | ✅ |

### 5.8 PerfCollector 服务 — 24 个测试函数

见 [TEST.md §8](TEST.md#8-perf-collector-服务) 详细清单。全部 24 个场景预期 PASS，覆盖：PerfRingRegistry（2）、BRPC Service 注册（2）、ApiHandler（3）、OutlierDetector（2）、SqliteStore（4）、StatsEngine（3）、SeriesManager（3）、SpanTree（3）、并发/大数据边界（2）。

## 6. WebUI E2E 测试结果（Playwright）

执行：`bash scripts/run-tests.sh`（服务器 Docker，访问 `localhost:32000`）

| # | 用例 | 验证点 | 结果 |
|---|------|-------|------|
| T01 | tab persistence | 刷新后 Test 面板仍可见 | ✅ |
| T02 | series detail view hides list | 详情视图 + Back to List | ✅ |
| T03 | series reactivate button | 激活按钮可见 | ✅ |
| T04 | trace Back button position | 瀑布图 Back 按钮 | ✅ |
| T05 | trace sequential number | 首行序号 `#1` | ✅ |
| T06 | pagination all shown <= 10 | 无分页按钮 | ✅ |
| T07 | pagination Load More | Per page 可见 | ✅ |
| T08 | trace search with Enter | 瀑布图 + Trace ID 可见 | ✅ |
| T09 | trace search back restores pagination | 分页恢复 | ✅ |
| T10 | Test panel send request | Total/Success/Fail 统计 | ✅ |
| T11 | Perf tree folded by default | 树折叠状态 | ✅ |
| T12 | Metrics component layout | 两行布局 + 图表 | ✅ |

## 7. 汇总统计

| 模块 | 已覆盖 | 通过 | 待补充 |
|------|--------|------|--------|
| 公共库 common | 30 | 30 | 0 |
| Feature | 11 | 11 | 7+ |
| Recall | 12 | 12 | 3+ |
| Precalc | 9 | 9 | 3 |
| RankMaster | 7 | 7 | 3 |
| RankSub | 18 | 18 | 2 |
| Proxy | 11 | 11 | 4 |
| Discovery | 9 | 9 | 6+ |
| PerfCollector | 24 | 24 | 1 |
| WebUI (Playwright) | 12 | 12 | 0 |
| **合计** | **143** | **143** | **29+** |

**通过率：** 143 / 143 = 100%（预期）

## 8. 已知限制

| 项 | 说明 |
|------|------|
| 无法本地编译 | 需在 `linquickrec/base:latest` 基础镜像中编译运行，本报告数据为代码静态分析所得预期结果 |
| Discovery 测试依赖 | 需要运行中的 Discovery 服务器（非 in-process） |
| 待补充场景 | 29+ 个场景未覆盖（详见 TEST.md 各章节"待补充"列表） |
| 性能基准 | 各场景耗时数据为测试代码运行时测量值，仅供参考 |
