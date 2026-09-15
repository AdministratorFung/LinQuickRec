# LinQuickRec — 搜推广时延模拟系统

C++17 微服务系统，基于 BRPC + Protobuf，模拟推荐系统完整调用链路（特征 → 召回 → 预计算 → 排序），测量平均时延和 P99 时延。

## 编译与运行

```bash
./build.sh              # Release 构建
./build.sh debug        # Debug 构建
./build.sh clean        # 清理后构建
```

产物在 `build/bin/`。Docker 环境下通过基础镜像 `linquickrec/base:latest` 编译，已内置 brpc/protobuf/abseil/gflags/leveldb。

**注意：当前环境无法本地编译，不要用编译来验证修改。**

## 架构要点

- **8 个微服务**：Proxy (:8080) → Feature (:8001) → Recall (:8002)/Precalc (:8003) 并行 → RankMaster (:8004) → RankSub (:8005)，Discovery (:8100) 提供服务发现
- **服务发现**：每个容器启动时 sidecar 进程注册到 Discovery，Proxy 动态发现下游实例（round-robin，失败重试+熔断）
- **外部依赖**：Recall 依赖 vLLM (Qwen3-0.6B :8000)，Precalc 和 RankMaster 依赖 KVWorker（元戎 SDK :31501/:31502）
- **公共库 `common/`**：`common::error::Status` 错误码（`0xMMTTCCCC`）、`common::logger`（Singleton+Sink）、`common::ThreadPool`（全局单例）

## CMakeLists.txt 规范

BRPC/absl 通过 `/usr/local` 直接引用，**禁止** `find_package(brpc)` 和 `find_package(absl)`。

- `BRPC_LIBRARIES` 必须包含 `leveldb`（brpc tracing 依赖）
- `ABSL_LIBS` 必须包含全部 11 项（含 `absl_spinlock_wait`、`absl_log_internal_nullguard`）
- 每个链接 brpc + proto + absl 的 target 都必须链接 `${ABSL_LIBS}`
- 详细模板见 `.agents/skills/brpc-cmake/SKILL.md`

## Git Commit 规范

Conventional Commits 格式：`<type>: <subject>`，subject 不超过 50 字符，小写开头，不以句号结尾。

允许的类型：`feat` `fix` `build` `chore` `docs` `refactor` `delete`

AI 辅助的 commit 必须在末尾加 `AI-assisted: opencode` 脚注。详见 `.agents/skills/git-commit/SKILL.md`。

## 服务 README 规范

每个服务 README 必须包含 6 个章节（中文）：模块简介、目录结构、业务流程、编译命令、启动方式、容器搭建。Proxy 的 README 是参考实现。详见 `.agents/skills/service-readme/SKILL.md`。

## 常用文件路径

| 用途 | 路径 |
|------|------|
| 全量配置参考 | `docs/CONFIG.md` |
| 系统设计文档 | `docs/DESIGN.md` |
| API 文档 | `docs/API.md` |
| 端口分配 | `docs/ports.md` |
| Proto 定义 | `proto/*.proto` |
| 公共库 | `common/` |
| 各服务 | `services/<name>/` |
| Docker 部署 | `deploy/docker/` |
| K8s 部署 | `deploy/k8s/` |

## Web-UI 开发工作流（强制）

**触发条件**：使用 `git diff --name-only HEAD` 检测到修改了以下目录中的文件：
- `services/perf/webui/`
- `deploy/docker/perf-webui/`
- `deploy/docker/perf-collector-mock/`

**不满足触发条件时**：跳过此流程，直接 `git commit`。

**满足触发条件时**：必须执行以下流程，最多重试 **3 次**。

### 流程

```
1. 部署 → 2. 测试 → 3a. 通过 → commit + push
                   → 3b. 失败 → 分析 → 修复 → 回到 1（最多 3 次）
                   → 3c. 超过 3 次 → 停止，总结问题，报告用户
```

### 详细步骤

**1. 部署**：将修改的文件传输到 `lighthouse@114.132.51.227`：
```bash
tar -czf - <changed-files> | ssh lighthouse@114.132.51.227 'cd /home/lighthouse/LinQuickRec && tar -xzf -'
ssh lighthouse@114.132.51.227 'cd /home/lighthouse/LinQuickRec && docker compose -f deploy/docker/docker-compose.mock.yml up -d --build'
```

**2. 测试**：在服务器 Docker 中运行 Playwright 测试：
```bash
bash scripts/run-tests.sh
```

**3a. 通过**：所有 12 个测试通过后：
- `git add` + `git commit`（Conventional Commits 格式 + `AI-assisted: opencode` 脚注）
- `git push origin dev`

**3b. 失败**（第 1-3 次）：分析 Playwright 输出（失败的测试名、错误信息、截图名称），修复代码，回到步骤 1。

**3c. 超过 3 次失败**：停止修改。收集以下信息并报告用户：
- 每次失败的测试名称和错误信息
- 尝试的修复内容
- 建议用户手动介入

### 设计理由

- 测试在服务器 Docker 容器中运行，访问 `localhost:32000`，无代理/VPN/SSL 问题。
- 本地 PC 无需 Node.js/Playwright/Chromium——只需 SSH 和 Git。
- 只有通过测试的代码才能提交，保证 `origin/dev` 始终可用。
