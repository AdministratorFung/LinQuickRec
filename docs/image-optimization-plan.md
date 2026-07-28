# 容器镜像精简实施方案

> **状态：规划中（暂存），尚未实施。**
> 本文是对 `docs/image-size-optimization.md` 中方案 1/2/3 的具体落地方案，经多轮讨论后定稿。
> 待确认后按第 10 节顺序执行。

---

## 1. 目标与约束

### 目标
最终服务镜像尽可能精简。

### 约束
- 基础镜像手动构建（后期可用 Dockerfile）
- 服务镜像通过 `docker compose` 构建
- 两组镜像构建都需要 cmake（基础镜像编译三方库；服务镜像编译 C++ 服务）
- 编译必须成功，二进制和依赖库必须存在
- 单一基础镜像版本管理：`base-build` + `base-runtime` 两个 tag，由同源 Dockerfile 产出
- 每服务仅收集必要的 .so（ldd 精确收集，不整目录拷贝）
- 当前环境无法本地编译（见 AGENTS.md），实际构建/验证需在有 Docker 的机器上做

---

## 2. 总体架构

### 2.1 三类专业镜像

| 镜像 | 角色 | 体积量级 | 用途 |
|------|------|---------|------|
| `linquickrec/base-build:latest` | 编译环境（fat） | 多 GB | 所有服务 Dockerfile 的 **builder 阶段** |
| `linquickrec/base-runtime:latest` | 运行时底座（lean） | 数百 MB | 所有服务 **Stage 2 底座**（含 etcd，严格统一） |
| `linquickrec/waiter:latest` | init 探活（tiny） | ~15 MB | 8 个 Deployment 的 `wait-for-etcd` init 容器 |

### 2.2 职责切分原则（关键）

- **base-runtime 只放 ldd 抓不到的运行时**：python3 解释器 + stdlib、datasystem python 包 + .so、glibc。**不含** brpc/protobuf/absl/gflags/leveldb/openssl 链 .so（这些裁剪掉，由每服务 ldd 精确收集）。
- **base-build 保留全部**：cmake + gcc + 全部 dev 头文件 + .a + .so 符号链接 + protoc + python3-devel + datasystem SDK（头文件 + lib）。
- **版本管理闭环**：`base-build` 与 `base-runtime` 由同一 `deploy/docker/base/Dockerfile` 的 `base-builder` 阶段产出，必然同版本；bump base → 两个 tag 同步更新 → 重建服务即可。
- **waiter 独立**：init 容器对体积最敏感（每次 pod 创建都拉），与 brpc/python/datasystem 零交集，故不套 base-runtime，单独建微型镜像。不与服务层"统一 base-runtime"冲突——init 不属于服务运行链路。

---

## 3. base Dockerfile（单文件双 target）

文件：`deploy/docker/base/Dockerfile`

```dockerfile
# === Stage: base-builder === 编译三方库 + 装 datasystem SDK
FROM openeuler/openeuler:24.03-sp3-lts AS base-builder
RUN yum install -y cmake gcc-c++ make python3-devel python3-pip ... && yum clean all
# 源码编译 openssl/protobuf/abseil/gflags/leveldb/brpc → make install /usr/local
# pip install datasystem wheel（头文件 + lib 落 site-packages/yr/datasystem）

# === Target: base-build === 原样保留（编译环境）
FROM base-builder AS base-build
# (no-op)

# === Target: base-runtime === 裁剪（运行时底座）
FROM base-builder AS base-runtime
RUN rm -rf /usr/local/include \
           /usr/share/cmake* /usr/bin/cmake /usr/bin/ctest /usr/bin/cpack \
           /usr/bin/gcc /usr/bin/g++ /usr/bin/cc /usr/bin/c++ \
           /usr/bin/make /usr/bin/ld /usr/bin/as /usr/bin/ar \
           /usr/local/bin/protoc* \
    && rm -f /usr/local/lib64/*.a /usr/local/lib/*.a \
             /usr/local/lib64/*.so* /usr/local/lib/*.so* \
    && yum clean all && rm -rf /var/cache/yum /root/.cache
# 保留: python3 + datasystem(site-packages) + glibc
```

### 构建命令

```bash
docker build --target base-build    -t linquickrec/base-build:latest    -f deploy/docker/base/Dockerfile .
docker build --target base-runtime  -t linquickrec/base-runtime:latest  -f deploy/docker/base/Dockerfile .
```

### 裁剪注意事项

- `rm /usr/local/lib64/*.so*` 会剥掉 brpc 链 .so（每服务 ldd 重新精确收集），但**裁剪前必须确认 datasystem .so 不在 `/usr/local/lib64`**（应在 `site-packages/yr/datasystem/lib`）。若 datasystem 在 `/usr/local/lib64` 也装了副本，需在 rm 中排除 `*datasystem*`/`*ubsocket*`：
  ```bash
  # 实施时先查：find /usr/local/lib64 -name "*datasystem*" -o -name "*ubsocket*"
  # 若有，改 rm 为: rm -f /usr/local/lib64/libbrpc* /usr/local/lib64/libprotobuf* ...
  ```

---

## 4. collect_so.sh（精确 .so 收集器）

文件：`deploy/docker/_common/collect_so.sh`

```bash
#!/bin/bash
# 用法: collect_so.sh <staging_dir> [bin...]
# 只拷 ldd 解析到、且路径以 /usr/local/ 开头的 .so（手动编译那批），
# 跳过 glibc/系统库（底座已有）和 datasystem（base-runtime 已有）。
set -euo pipefail
STAGING="$1"; shift
BINS=("$@")
[ ${#BINS[@]} -eq 0 ] && BINS=("$STAGING"/bin/*)
mkdir -p "$STAGING/lib"

SO_LIST=$(for f in "${BINS[@]}"; do ldd "$f" 2>/dev/null; done \
  | awk '/=> \// {print $3} /^[[:space:]]*\// {print $1}' \
  | grep '^/usr/local/' | grep -v 'ld-linux' | sort -u)

for so in $SO_LIST; do cp -aL "$so" "$STAGING/lib/" 2>/dev/null || true; done

# 断言: 把 staging/lib 加到搜索路径后重跑 ldd，不得有 not found
MISSING=0
for f in "${BINS[@]}"; do
  if LD_LIBRARY_PATH="$STAGING/lib:${LD_LIBRARY_PATH:-}" ldd "$f" 2>/dev/null \
       | grep -qi 'not found'; then
    echo "[collect_so] MISSING for $f" >&2
    LD_LIBRARY_PATH="$STAGING/lib" ldd "$f" >&2
    MISSING=1
  fi
done
[ $MISSING -eq 0 ] || { echo "[collect_so] incomplete" >&2; exit 1; }
echo "[collect_so] collected $(ls "$STAGING/lib" | wc -l) libs"
```

### 4.1 工作原理

- `ldd` 全部二进制 → 解析 `=> /path` 与裸 `/path` 行
- 只保留 `/usr/local/` 开头路径（手动编译装进去的，openEuler 底座没有）
- 跳过 glibc/系统库（`/lib64`、`/usr/lib64`，底座已有）和 `ld-linux` 解释器
- 跳过 datasystem .so（在 `site-packages/yr/datasystem/lib`，不在 `/usr/local`，base-runtime 已有）
- `cp -aL` 解引用符号链接，落地文件名为 soname，正好匹配二进制 NEEDED 条目
- 收集后断言：用 staging lib 重跑 `ldd`，不得出现 `not found`

### 4.2 边界情况处理

| 情况 | 处理 |
|------|------|
| dlopen 依赖 | brpc/protobuf/absl 无 dlopen，ldd 闭包完整；datasystem 可能 dlopen 兄弟 .so（如 libubsocket）→ 这类留 base-runtime（datasystem 服务专用），不靠 ldd |
| libpython3.11.so | 若 datasystem .so 链接了 libpython（在 `/usr/lib64`，被 `/usr/local` 过滤跳过）→ 由 base-runtime 的 python3 提供。这也是 datasystem 服务必须用 base-runtime 而非裸 openeuler 的原因 |
| strip | 只 strip 二进制，不 strip .so（避免误删 dlopen 需要的符号） |
| glibc | ldd 会列 libc/libpthread/libdl/libm 等，全在 `/lib64` → 被过滤跳过，由底座提供（同 openEuler 版本，兼容） |
| protoc/cmake | 仅 base-build 有，runtime 阶段从不出现 |

---

## 5. 服务 Dockerfile 模板

### 5.1 通用 C++ 服务（proxy/feature/discovery/perf-collector）

以 proxy 为例：

```dockerfile
FROM linquickrec/base-build:latest AS builder
COPY proto/ common/ services/proxy/ services/discovery/ /app/
RUN cd /app/build && cmake ../services/proxy -DCMAKE_BUILD_TYPE=Release && make -j$(nproc)
RUN cd /tmp/dbuild && cmake /app/services/discovery ... && make discovery_client
RUN mkdir -p /staging/bin && cp -a /app/build/bin/* /app/discovery_client /staging/bin/ \
 && strip /staging/bin/*
COPY deploy/docker/_common/collect_so.sh /tmp/
RUN bash /tmp/collect_so.sh /staging          # ldd 只收 /usr/local 下的 brpc 链

FROM linquickrec/base-runtime:latest           # ← 统一底座
COPY --from=builder /staging/bin/ /app/bin/
COPY --from=builder /staging/lib/ /usr/local/lib64/
COPY deploy/docker/proxy/entrypoint.sh /app/
ENV LD_LIBRARY_PATH=/usr/local/lib64
ENTRYPOINT ["/app/entrypoint.sh"]
```

> proxy 当前是 `Debug`（`deploy/docker/proxy/Dockerfile:18`），统一改 `Release` + strip。

### 5.2 datasystem 服务（precalc-and-rank-master/rank-sub/recall-novllm）

builder 阶段与 5.1 一致（ldd 只收 `/usr/local` 下 brpc 链，datasystem .so 不在 `/usr/local`，不重复拷）。仅 runtime 阶段追加 env：

```dockerfile
FROM linquickrec/base-runtime:latest           # 底座已带 python3 + datasystem
COPY --from=builder /staging/bin/ /app/bin/
COPY --from=builder /staging/lib/ /usr/local/lib64/
COPY deploy/docker/xxx/entrypoint.sh /app/
ENV YR_SDK_PATH=/usr/local/lib64/python3.11/site-packages/yr/datasystem
ENV LD_LIBRARY_PATH=/usr/local/lib64:${YR_SDK_PATH}/lib
ENTRYPOINT ["/app/entrypoint.sh"]
```

### 5.3 recall(vllm) 多阶段

```dockerfile
FROM linquickrec/base-build:latest AS builder
# ... 编译 recall_server + discovery_client, strip, collect_so
# torch/vllm 装在 runtime 阶段（base-runtime 的 python），不是 builder

FROM linquickrec/base-runtime:latest
RUN --mount=type=bind,source=share,target=/tmp/artifacts \
    pip3 install /tmp/artifacts/torch-*.whl /tmp/artifacts/vllm-*.whl ...
COPY --from=builder /staging/bin/ /app/bin/
COPY --from=builder /staging/lib/ /usr/local/lib64/
ENV YR_SDK_PATH=/usr/local/lib64/python3.11/site-packages/yr/datasystem
ENV LD_LIBRARY_PATH=/usr/local/lib64:${YR_SDK_PATH}/lib
ENTRYPOINT ["/app/entrypoint.sh"]
```

> torch/vllm 的 .so 在 `site-packages/torch/lib`（python import 时 dlopen），ldd 不抓但随包存在，无需额外处理。多阶段去掉编译器，比单阶段省 1-2 GB。

### 5.4 etcd（严格统一 base-runtime）

```dockerfile
FROM linquickrec/base-runtime:latest
COPY share/etcd-v3.5.12-linux-arm64.tar.gz /tmp/etcd.tar.gz
RUN tar -zxf /tmp/etcd.tar.gz -C /tmp/ && \
    cp /tmp/etcd-v3.5.12-linux-arm64/etcd /usr/local/bin/etcd && \
    cp /tmp/etcd-v3.5.12-linux-arm64/etcdctl /usr/local/bin/etcdctl && \
    rm -rf /tmp/etcd.tar.gz /tmp/etcd-v3.5.12-linux-arm64
COPY deploy/docker/etcd/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 2379 2380
ENTRYPOINT ["/entrypoint.sh"]
```

> etcd 是静态链接 Go 二进制，不需要 brpc/python/datasystem 中任何一个。用 base-runtime 是为版本管理统一而付出的 ~100-200MB 冗余代价（已确认接受）。

### 5.5 kv-worker

builder 阶段编译 `discovery_client`（仅 kv-worker 需要 discovery_client，无 brpc 服务二进制）。runtime 阶段 `FROM base-runtime`（dscli worker 由 base-runtime 的 datasystem 包提供）+ COPY discovery_client + ldd 收集其 .so。

---

## 6. waiter 镜像（init 探活）

文件：`deploy/docker/waiter/Dockerfile`

```dockerfile
FROM alpine:3.20
RUN apk add --no-cache curl
CMD ["sh", "-c", "echo waiter ready"]
```

- ~15 MB，支持 aarch64。
- 保留 `curl` → 8 个 k8s yaml 的 init 脚本**不用改**，只换 image。

### 6.1 集成点

- `deploy/docker/docker-compose.yml`：加 `waiter` 构建服务
- `scripts/build-images.sh`：`build_services` 列表 + case 分支加 `waiter`
- `scripts/push-to-registry.sh`：`build_services()` 加 `waiter:${PREFIX}/waiter:latest`，可用镜像字符串补 `waiter`
- 8 个 k8s yaml 的 `initContainers.wait-for-etcd.image`：`linquickrec/base:latest` → `linquickrec/waiter:latest`
  - `deploy/k8s/base/proxy.yaml:20`
  - `deploy/k8s/base/feature.yaml:20`
  - `deploy/k8s/base/kv-worker.yaml:23`
  - `deploy/k8s/base/rank-sub.yaml:23`
  - `deploy/k8s/base/precalc-and-rank-master.yaml:21`
  - `deploy/k8s/components/recall-novllm/deployment.yaml:21`
  - `deploy/k8s/components/recall-vllm/deployment.yaml:20`
  - `deploy/k8s/components/discovery/deployment.yaml:20`
- README 同步：`deploy/docker/README.md` 目录结构 + `deploy/k8s/README.md`（如记了 init 镜像）

> 这块与 base-build/runtime 分离相互独立，可作为**首个快速收益**先落地，不影响后续 base 拆分。

---

## 7. 各服务操作总表

| 服务 | builder 底座 | Stage 2 底座 | ldd 收集范围 | 额外 |
|------|------------|------------|------------|------|
| proxy | base-build | base-runtime | brpc 链 | Debug→Release + strip |
| feature | base-build | base-runtime | brpc 链 | |
| discovery | base-build | base-runtime | brpc 链 | |
| perf-collector | base-build | base-runtime | brpc 链 + sqlite | yum sqlite-devel 在 builder |
| etcd | — | base-runtime | 无 | 仅解压 etcd 二进制 |
| precalc-and-rank-master | base-build | base-runtime | brpc 链 | + YR env；datasystem 已在底座 |
| rank-sub | base-build | base-runtime | brpc 链 | + YR env |
| recall(novllm) | base-build | base-runtime | brpc 链 | + YR env |
| recall(vllm) | base-build | base-runtime | brpc 链 | + pip torch/vllm |
| kv-worker | base-build | base-runtime | discovery_client 的 .so | dscli 在底座 |

---

## 8. 集成点汇总

落地时需同步修改：

| 文件 | 改动 |
|------|------|
| `deploy/docker/base/Dockerfile` | 新建（双 target） |
| `deploy/docker/_common/collect_so.sh` | 新建 |
| `deploy/docker/waiter/Dockerfile` | 新建 |
| 各服务 `deploy/docker/*/Dockerfile` | 改多阶段（builder FROM base-build，runtime FROM base-runtime + collect_so） |
| `deploy/docker/docker-compose.yml` | 加 `waiter` 服务 |
| `scripts/build-images.sh` | build_services + case 加 `waiter` |
| `scripts/push-to-registry.sh` | build_services() + 镜像字符串加 `waiter` |
| 8 个 k8s yaml | init image → `linquickrec/waiter:latest` |
| `deploy/docker/README.md` | 目录结构 + 基础镜像说明（base-build/runtime/waiter） |
| `deploy/k8s/README.md` | init 镜像说明（若涉及） |
| `docs/image-size-optimization.md` | 链接本文为已定稿实施方案 |
| `README.md` | 基础镜像章节更新（base-build/runtime/waiter） |

---

## 9. 风险与待验证

| 风险 | 验证方式 |
|------|---------|
| datasystem .so 实际位置 | 裁剪前 `find /usr/local/lib64 -name "*datasystem*" -o -name "*ubsocket*"`，确认是否需排除 |
| libpython 链接情况 | `ldd` precalc/rank-sub 二进制，看是否依赖 libpython3.11.so（决定 datasystem 服务能否脱离 python 运行时） |
| alpine aarch64 可用性 | 构建 waiter 镜像确认 aarch64 产物存在（项目为 arm64） |
| curl 命令兼容 | waiter 的 alpine curl 与现有 init 脚本 `curl -fsS` 行为一致 |
| dlopen 依赖遗漏 | collect_so 断言（重跑 ldd 无 not found）+ 服务 `test` 命令集成测试 |
| 静态/动态链接 | 现有 CMakeLists 按名链接默认走 .so；若某 target 改静态链接则 runtime 不需该 .so 但 builder 需 .a（base-build 保留 .a 即可） |

---

## 10. 实施顺序

1. **waiter 镜像**（独立快赢）→ 替换 8 处 init 的 base:latest
2. **base Dockerfile**（双 target）→ 构建 base-build / base-runtime
3. **collect_so.sh**
4. **etcd + proxy** 验证（最小验证：无 brpc / ldd 收集 + Release+strip）
5. 推广 **feature / discovery / perf-collector**（纯 C++）
6. **precalc-and-rank-master / rank-sub / recall-novllm**（切 base-runtime，验证 datasystem 运行时 + `import yr.datasystem`）
7. **recall-vllm**（pip torch/vllm 多阶段）
8. **kv-worker**（base-runtime，验证 dscli）
9. README + 文档同步（按 readme-sync skill）

---

## 11. 验证方法

1. 每个非例外服务：`docker run --rm linquickrec/<svc>:latest test` → 期望 `=== All ... Tests Passed ===`
2. `docker run --rm --entrypoint sh <img> -c 'ldd /app/bin/* | grep -i not'` → 无输出
3. `docker images` 对比改造前后体积（纯 C++ 服务从数 GB 降到百 MB 级）
4. base-runtime 服务额外验证 `python3 -c "import yr.datasystem"` 可导入
5. waiter 镜像：`docker run --rm linquickrec/waiter:latest sh -c 'curl -fsS http://<etcd>/health && echo ok'`

---

## 12. 决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| base 镜像拆分 | 拆 `base-build` + `base-runtime` | 编译工具与运行产物物理分离，服务镜像不含 cmake |
| base 产出方式 | 单 Dockerfile 双 target | 同源保证两 tag 版本一致，维护一份 |
| runtime 底座策略 | 单一 `base-runtime`（不分层） | 版本管理简单；纯 C++ 服务多带 python+datasystem 为可接受代价 |
| Stage 2 底座统一范围 | 全部服务（含 etcd）用 base-runtime | 严格统一版本管理，接受 etcd ~100-200MB 冗余 |
| .so 收集策略 | 每服务 ldd 精确收集（只收 `/usr/local/`） | 最精简，每服务只带自己需要的 brpc 子集 |
| recall(vllm) | 多阶段 FROM base-runtime + pip | 去掉编译器省 1-2 GB，torch/vllm 仍大但比单阶段小 |
| datasystem 服务底座 | 默认 base-runtime | datasystem .so 可能依赖 libpython，base-runtime 已备 python3 |
| init 容器镜像 | 自建 `linquickrec/waiter:latest`（alpine+curl） | init 每次拉取，体积最敏感；自包含不依赖外部拉取，纳入版本管理 |
| init 探活命令 | 保留 curl | 脚本不动，仅换 image，降低改动面 |
