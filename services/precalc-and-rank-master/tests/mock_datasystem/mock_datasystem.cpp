#include "mock_datasystem.h"

namespace datasystem {

Status KVClient::Init() {
    return Status::Ok();
}

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

}
