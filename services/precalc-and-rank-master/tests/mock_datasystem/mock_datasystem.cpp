#include "mock_datasystem.h"

namespace datasystem {

Status KVClient::Init() {
    if (kv_error_mode_ == KVErrorMode::INIT_FAILED) {
        return Status::Error("mock Init failed");
    }
    return Status::Ok();
}

Status KVClient::Get(const std::string& key, Optional<Buffer>& buffer) {
    auto it = mock_data_.find(key);
    if (it != mock_data_.end()) {
        Buffer buf(it->second.size());
        buf.SetData(it->second);
        buffer.SetValue(buf);
        return Status::Ok();
    }
    return Status::Error("Key not found");
}

Status KVClient::Create(const std::string& key, size_t size, const SetParam& param,
                       std::shared_ptr<Buffer>& buffer) {
    if (kv_error_mode_ == KVErrorMode::CREATE_FAILED) {
        return Status::Error("mock Create failed");
    }
    (void)key;
    (void)param;
    buffer = std::make_shared<Buffer>(size);
    return Status::Ok();
}

Status KVClient::Set(const std::shared_ptr<Buffer>& buffer) {
    if (kv_error_mode_ == KVErrorMode::SET_FAILED) {
        return Status::Error("mock Set failed");
    }
    if (buffer) {
        buffer->TransferOwnership();
    }
    return Status::Ok();
}

}
