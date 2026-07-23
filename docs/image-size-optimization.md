# 容器镜像体积缩小方案

## 当前问题

基础镜像需要安装 brpc 全套编译依赖（protobuf, abseil-cpp, gflags, leveldb, openssl, zlib 等），
体积巨大，每次构建和传输耗时很长。

## 方案概览

| 方案 | 预估缩小 | 复杂度 | 适用场景 |
|------|---------|--------|---------|
| 1. 多阶段构建 | 50-70% | 低 | 所有服务 Dockerfile |
| 2. 剥离静态库/头文件分离 | 30-50% | 中 | 基础镜像 |
| 3. 运行时最小化镜像 | 70-90% | 高 | 生产部署 |
| 4. 共享基础镜像层 | 传输节省 | 低 | CI/CD 缓存 |
| 5. skinny 基础镜像 | 40-60% | 中 | 长期方案 |

---

## 方案 1：多阶段构建（推荐，立即实施）

将构建环境和运行环境分离。构建阶段使用完整的基础镜像，运行阶段
只复制需要的产物。

### 当前 Dockerfile（proxy 为例）
```dockerfile
FROM linquickrec/base:latest
# 复制源码 + 编译
COPY proto/ common/ services/proxy/ ... /app/
RUN cmake ../services/proxy && make proxy_server ...
# 镜像同时包含编译工具链和运行产物（几十 GB）
```

### 改进后
```dockerfile
# Stage 1: 编译
FROM linquickrec/base:latest AS builder
COPY proto/ common/ services/proxy/ ... /app/
WORKDIR /app/build
RUN cmake ../services/proxy -DCMAKE_BUILD_TYPE=Release && \
    make proxy_server proxy_test_client proxy_integration_test -j$(nproc)

# Stage 2: 运行
FROM openeuler/openeuler:24.03-sp3-lts
# 只复制运行时需要的文件
COPY --from=builder /app/build/bin/proxy_server /app/proxy_server
COPY --from=builder /app/build/bin/discovery_client /app/discovery_client
COPY --from=builder /usr/local/lib64/libbrpc.a /usr/local/lib64/
COPY --from=builder /usr/local/lib64/libprotobuf.so* /usr/local/lib64/
COPY --from=builder /usr/local/lib64/libgflags* /usr/local/lib64/
COPY --from=builder /usr/lib64/libubsocket.so* /usr/lib64/
# ... 其他运行时 .so
COPY --from=builder /app/entrypoint.sh /app/
ENV LD_LIBRARY_PATH=/usr/local/lib64:/usr/lib64
ENTRYPOINT ["/app/entrypoint.sh"]
```

### 效果
- 基础镜像（含 gcc/cmake/头文件/静态库）不会出现在最终镜像中
- 最终镜像只含二进制 + 运行时 .so，体积缩小 70-90%

---

## 方案 2：剥离构建依赖（基础镜像瘦身）

当前的 `linquickrec/base:latest` 同时包含编译时和运行时产物。
可以拆分为两个镜像：

### 2a. 编译镜像（`linquickrec/build:latest`）
```
包含：cmake, gcc-c++, make, 头文件, 静态库(.a)
用途：CI/CD 编译
```

### 2b. 运行镜像（`linquickrec/runtime:latest`）
```
包含：动态库(.so), 无编译工具
用途：生产部署
```

### 使用多阶段 + 两个镜像
```dockerfile
FROM linquickrec/build:latest AS builder
# 编译...

FROM linquickrec/runtime:latest
COPY --from=builder /app/build/bin/ /app/
```

---

## 方案 3：运行时最小化（最激进）

对于生产部署，逐一分析每个服务的依赖，只复制精确需要的文件。

### 步骤
1. 编译二进制（静态链接）
2. `ldd` 分析运行时需要的 .so
3. 只复制这些 .so 到最终镜像

```bash
# 分析运行时依赖
ldd /app/build/bin/proxy_server
# 输出：
#   libbrpc.so => /usr/local/lib64/libbrpc.so
#   libprotobuf.so.26 => /usr/local/lib64/libprotobuf.so.26
#   libubsocket.so => /usr/lib64/libubsocket.so
#   ...

# Dockerfile 中只复制这些
COPY --from=builder /usr/local/lib64/libbrpc.so       /usr/local/lib64/
COPY --from=builder /usr/local/lib64/libprotobuf.so.26 /usr/local/lib64/
COPY --from=builder /usr/lib64/libubsocket.so          /usr/lib64/
```

### 如果使用静态链接
```cmake
# 在 CMakeLists.txt 中添加静态链接选项
set(CMAKE_EXE_LINKER_FLAGS "-static")
```
则最终二进制不依赖任何 .so，可以放在 `FROM scratch` 中运行。

---

## 方案 4：清理不必要的文件

### dnf/yum 缓存
```dockerfile
RUN yum install -y ... && yum clean all && rm -rf /var/cache/yum
```

### 剥离调试符号
```dockerfile
RUN strip /app/build/bin/*  # 移除符号表
# 或编译时：
RUN cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-s" -DCMAKE_CXX_FLAGS="-s"
```

### 删除不需要的头文件
```dockerfile
# 基础镜像中只保留编译时需要的头文件
RUN rm -rf /usr/local/include/absl/   # 编译完成后不需要
RUN rm -rf /usr/local/include/google/ # 编译完成后不需要
```

### 删除 .a 静态库（如果使用动态链接）
```dockerfile
RUN rm -rf /usr/local/lib64/*.a
```

### 清理编译产物
```dockerfile
# 编译完成后
RUN rm -rf /app/build/CMakeFiles /app/build/*.o /app/build/*.a
```

---

## 方案 5：共享层 + 缓存优化

### 统一构建顺序
所有服务的 Dockerfile 按相同顺序执行相同的 COPY 指令，
Docker 会自动复用基础镜像层。

```dockerfile
# 所有 Dockerfile 共用的开头
FROM linquickrec/build:latest
WORKDIR /app
COPY proto/    /app/proto/
COPY common/   /app/common/
# ... 每个服务自己的 COPY ...
```

### 编译缓存
```dockerfile
# CMake 配置单独作为一个层（变更少，缓存命中率高）
RUN cmake ../services/proxy -DCMAKE_BUILD_TYPE=Release

# 编译单独作为一个层
RUN make -j$(nproc)
```

---

## 推荐实施顺序

### 第一阶段（立即，低风险）
1. 所有 Dockerfile 改为多阶段构建（方案 1）
2. 在编译层末尾添加 `yum clean all`
3. 添加 `strip` 去除符号

### 第二阶段（中期）
1. 构建 `linquickrec/build:latest` 和 `linquickrec/runtime:latest`
2. 将构建依赖和运行时依赖分开

### 第三阶段（长期）
1. 分析每个服务的运行时依赖（`ldd`）
2. 精确复制 .so，或使用静态链接
3. 尝试 `FROM scratch` 运行静态链接的二进制
