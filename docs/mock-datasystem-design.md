# Precalc-and-Rank-Master 测试 Mock 方案

## 背景

`precalc-and-rank-master` 服务依赖外部 KV 存储服务（元戎 Datasystem SDK），其客户端 `KVClient` 通过共享内存与宿主机上的 KVWorker 通信。在集成测试环境中没有真实的 KVWorker 运行时，需要对 `KVClient` 进行 mock，使测试可以独立运行，不依赖外部服务。

## 遇到的问题

### 问题 1：头文件重定义冲突

**错误信息：**
```
error: redefinition of 'class datasystem::Status'
error: redefinition of 'class datasystem::Buffer'
error: multiple definition of 'enum class datasystem::ServiceAffinityPolicy'
```

**原因：** `tests/mock_datasystem/mock_datasystem.h` 定义了 `datasystem` 命名空间下的所有类型（`Status`、`Buffer`、`KVClient` 等），而 `server/include/rank_master_server.h` 通过 `${YR_INCLUDE_DIR}` 包含了真实的 YR SDK 头文件 `<datasystem/datasystem.h>`。测试文件 `integration_test.cpp` 同时包含了 `mock_datasystem.h` 和 `rank_master_server.h`，导致同一命名空间下的类型被定义了两次。

**解决：** 在 `tests/mock_datasystem/datasystem/` 下创建 shim 头文件：

- `tests/mock_datasystem/datasystem/datasystem.h` — 引用 mock 根头文件
- `tests/mock_datasystem/datasystem/kv_client.h` — 引用 mock 根头文件

通过 CMake 的 include path 优先级，让 `#include <datasystem/datasystem.h>` 命中 mock shim 而非真实 SDK 头文件。

### 问题 2：静态成员重复定义

**错误信息：**
```
error: redefinition of 'std::unordered_map<...> datasystem::KVClient::mock_data_'
```

**原因：** 头文件中 `static` 成员既是声明也是定义，`.cpp` 中又重复定义了一次。

**解决：** 将头文件中的 `static` 改为 `static inline`（C++17），消除重复定义。

### 问题 3：链接时符号未替换

**现象：** `kv_init` 阶段卡住约 50 秒后超时失败（KVClient 试图连接不存在的 KVWorker），mock 未生效。

**根因分析：**

即使编译阶段使用了 mock 头文件，运行时仍然调用了真实 `libdatasystem.so` 中的 `KVClient::Init()` 方法。原因有两个层面：

1. **`rank_master_server_lib` 编译时使用了真实 SDK：** 该静态库中的 `.o` 文件编译时通过 `${YR_INCLUDE_DIR}` 看到了真实的 `KVClient` 类型（含虚函数表、继承自 `KVClientBase`）。这个类型与 mock 的 `KVClient` 是完全不同的 C++ 类型。

2. **链接顺序无法覆盖：** 即使将 `mock_datasystem` 放在链接依赖的前面，由于 `rank_master_server_lib.a` 已经实例化了真实类型的虚表，链接器无法用 mock 的符号去替换一个不兼容的 vtable。

纯靠"链接时 mock 头文件 + 替换符号"的方式不可行，因为编译时生成的类型信息无法在链接时更改。

**解决：** 为测试单独编译一份 server 源码，使用 mock include path。

### 问题 4：编译顺序错误

**错误信息：**
```
CMake Error: set_target_properties Can not find target to add properties to: rank_master_integration_test
```

**原因：** `set_target_properties()` 放在了 `add_executable()` 之前执行。

## 最终方案

### 架构

```
integration_test.cpp
    │
    ├── #include "mock_datasystem.h"          (tests/mock_datasystem/)
    └── #include "rank_master_server.h"        (server/include/)
              └── #include <datasystem/datasystem.h>  ↓
                     └── tests/mock_datasystem/datasystem/datasystem.h (shim)
                                └── #include "../mock_datasystem.h"
                                        └── datasystem::KVClient (mock)
```

### CMake 结构

- **`precalc_and_rank_master`**（生产）：直接编译 server 源码，使用真实 `${YR_INCLUDE_DIR}`，链接 `${YR_DATASYSTEM_LIB}`
- **`rank_master_server_lib`**（生产）：server 源码静态库，供生产使用
- **`rank_master_test_lib`**（测试）：**重新编译** server 源码，使用 mock include path（不含 `${YR_INCLUDE_DIR}`），mock 库优先链接
- **`mock_datasystem`**（测试）：STATIC 库，提供 mock 类型定义和 `KVClient` 方法实现
- **`rank_master_integration_test`**：链接 `rank_master_test_lib` + `mock_datasystem`
- **`precalc_integration_test`**：链接 `rank_master_test_lib` + `mock_datasystem`

### 关键代码

**mock_datasystem.h — 类型声明：**
```cpp
class KVClient {
public:
    KVClient(const ConnectOptions& opts) {}
    Status Init();
    Status Get(const std::string& key, Optional<Buffer>& buffer);
    Status Create(const std::string& key, size_t size, const SetParam& param,
                  std::shared_ptr<Buffer>& buffer);
    Status Set(const std::shared_ptr<Buffer>& buffer) {
        (void)buffer;
        return Status::Ok();
    }
    static inline std::unordered_map<std::string, std::string> mock_data_;
};
```

**mock_datasystem.cpp — 方法实现：**
```cpp
Status KVClient::Init() { return Status::Ok(); }

Status KVClient::Get(const std::string& key, Optional<Buffer>& buffer) {
    auto it = mock_data_.find(key);
    if (it != mock_data_.end()) {
        Buffer buf;
        buf.SetData(it->second);
        buffer.SetValue(buf);
        return Status::Ok();
    }
    return Status::Error("Key not found");
}
```

**integration_test.cpp — 注入 mock 数据：**
```cpp
datasystem::KVClient::mock_data_["user_feat_key"] = "mock_user_feature_data";
```

### 文件清单

| 文件路径 | 作用 |
|---|---|
| `tests/mock_datasystem/mock_datasystem.h` | mock 类型定义（Status、Buffer、KVClient 等） |
| `tests/mock_datasystem/mock_datasystem.cpp` | KVClient 方法的 mock 实现 |
| `tests/mock_datasystem/datasystem/datasystem.h` | datasystem 头文件 shim |
| `tests/mock_datasystem/datasystem/kv_client.h` | kv_client 头文件 shim |
| `tests/mock_datasystem/CMakeLists.txt` | mock_datasystem STATIC 库构建配置 |
| `CMakeLists.txt` | 新增 `rank_master_test_lib`，测试链接 mock 库 |

## 验证结果

| 指标 | Mock 前 | Mock 后 |
|---|---|---|
| `kv_init` 时延 | ~50000ms（超时） | 0.001ms |
| `kv_get` 时延 | ~50000ms（超时） | 0.009ms |
| 集成测试 | 全部 PASS | 全部 PASS |

## 总结

本方案的核心思路是：**不再试图通过链接层替换已编译的类型符号，而是为测试重新编译一份使用 mock 类型的代码**。这是因为 C++ 的类型信息（虚表布局、模板实例化等）在编译时就已经确定，链接器无法修改两个不兼容类型之间的调用关系。通过静态库的直接对象文件替换和 include path 的巧妙设计，实现了生产代码和测试代码的完全解耦。
