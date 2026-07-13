#ifndef MOCK_DATASYSTEM_H
#define MOCK_DATASYSTEM_H

#include <memory>
#include <string>
#include <unordered_map>

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
    const void* ImmutableData() const { return data_.data(); }
    size_t GetSize() const { return data_.size(); }
    void SetData(const std::string& data) { data_ = data; }
    void* MutableData() { return data_.data(); }

private:
    std::string data_;
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

} // namespace datasystem

#endif
