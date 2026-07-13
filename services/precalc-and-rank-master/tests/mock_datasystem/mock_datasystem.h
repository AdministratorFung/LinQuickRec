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

class KVClient {
public:
    KVClient(const ConnectOptions& opts) {}

    Status Init() {
        return Status::Ok();
    }

    Status Get(const std::string& key, Optional<Buffer>& buffer) {
        auto it = mock_data_.find(key);
        if (it != mock_data_.end()) {
            Buffer buf;
            buf.SetData(it->second);
            buffer.SetValue(buf);
            return Status::Ok();
        }
        return Status::Error("Key not found");
    }

    static std::unordered_map<std::string, std::string> mock_data_;
};

extern std::unordered_map<std::string, std::string> KVClient::mock_data_;

} // namespace datasystem

#endif
