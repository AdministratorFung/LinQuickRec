#ifndef MOCK_DATASYSTEM_H
#define MOCK_DATASYSTEM_H

#include <memory>
#include <string>
#include <unordered_map>
#include <cstring>
#include <sys/mman.h>
#include <unistd.h>

namespace datasystem {

enum class ServiceAffinityPolicy {
    PREFERRED_SAME_NODE
};

class Status {
public:
    bool IsOk() const { return ok_; }
    std::string ToString() const { return message_; }
    static Status Ok() { return Status(true, ""); }
    static Status Error(const std::string& msg) { return Status(false, msg); }

private:
    bool ok_;
    std::string message_;
    Status(bool ok, const std::string& msg) : ok_(ok), message_(msg) {}
};

class ServiceDiscoveryOptions {
public:
    std::string etcdAddress;
    std::string hostIdEnvName;
    ServiceAffinityPolicy affinityPolicy;
};

class ServiceDiscovery {
public:
    ServiceDiscovery(const ServiceDiscoveryOptions& opts) {}
    Status Init() { return Status::Ok(); }
};

class Buffer {
public:
    Buffer() : data_(nullptr), size_(0), owns_memory_(false) {}
    explicit Buffer(size_t size) : data_(mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0)), size_(size), owns_memory_(true) {}
    Buffer(const Buffer& other) : data_(other.data_), size_(other.size_), owns_memory_(false) {
        if (other.owns_memory_) {
            data_ = mmap(nullptr, other.size_, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
            if (data_ != MAP_FAILED) {
                memcpy(data_, other.data_, other.size_);
                owns_memory_ = true;
            }
        }
    }
    Buffer& operator=(const Buffer& other) {
        if (this != &other) {
            if (owns_memory_ && data_ != MAP_FAILED) munmap(data_, size_);
            data_ = other.data_;
            size_ = other.size_;
            owns_memory_ = false;
            if (other.owns_memory_) {
                data_ = mmap(nullptr, other.size_, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
                if (data_ != MAP_FAILED) {
                    memcpy(data_, other.data_, other.size_);
                    owns_memory_ = true;
                }
            }
        }
        return *this;
    }
    ~Buffer() {
        if (owns_memory_ && data_ != nullptr && data_ != MAP_FAILED) {
            munmap(data_, size_);
        }
    }
    const void* ImmutableData() const { return data_; }
    size_t GetSize() const { return size_; }
    void SetData(const std::string& data) {
        if (size_ > 0 && data.size() > 0) {
            memcpy(data_, data.data(), std::min(size_, data.size()));
        }
    }
    void* MutableData() { return data_; }
    void TransferOwnership() { owns_memory_ = false; }

private:
    void* data_;
    size_t size_;
    bool owns_memory_;
};

template<typename T>
class Optional {
public:
    bool HasValue() const { return has_value_; }
    T* operator->() { return &value_; }
    void SetValue(const T& v) { value_ = v; has_value_ = true; }

private:
    bool has_value_ = false;
    T value_;
};

struct ConnectOptions {
    std::shared_ptr<ServiceDiscovery> serviceDiscovery;
};

enum class WriteMode { NONE_L2_CACHE };
enum class ExistenceOpt { NONE };
enum class CacheType { MEMORY };

struct SetParam {
    int ttlSecond = 5;
    WriteMode writeMode = WriteMode::NONE_L2_CACHE;
    ExistenceOpt existence = ExistenceOpt::NONE;
    CacheType cacheType = CacheType::MEMORY;
};

enum class KVErrorMode { NONE, INIT_FAILED, CREATE_FAILED, SET_FAILED };

class KVClient {
public:
    KVClient(const ConnectOptions& opts) {}

    Status Init();

    Status Get(const std::string& key, Optional<Buffer>& buffer);

    Status Create(const std::string& key, size_t size, const SetParam& param,
                  std::shared_ptr<Buffer>& buffer);

    Status Set(const std::shared_ptr<Buffer>& buffer);

    static inline std::unordered_map<std::string, std::string> mock_data_;
    static inline KVErrorMode kv_error_mode_ = KVErrorMode::NONE;
    static void SetKVErrorMode(KVErrorMode mode) { kv_error_mode_ = mode; }
};

} // namespace datasystem

#endif
