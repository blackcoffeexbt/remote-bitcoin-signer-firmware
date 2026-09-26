#pragma once
#include <ArduinoJson.h>

namespace nostr {
namespace json {
// The envelope includes Base64 ciphertext and event metadata. Decrypted requests
// retain the existing 100,000-byte budget. JSON node storage is bounded separately.
constexpr size_t MAX_ENVELOPE_BYTES = 144 * 1024;
constexpr size_t MAX_ENVELOPE_CAPACITY = 192 * 1024;
constexpr size_t MAX_REQUEST_BYTES = 100000;
constexpr size_t MAX_REQUEST_CAPACITY = 128 * 1024;

namespace detail {
struct Input {
    const char* data;
    size_t length;
    size_t offset = 0;
    Input(const char* data, size_t length) : data(data), length(length) {}
    int read() { return offset < length ? static_cast<unsigned char>(data[offset++]) : -1; }
    size_t readBytes(char* out, size_t count) {
        if (count > length - offset) count = length - offset;
        memcpy(out, data + offset, count);
        offset += count;
        return count;
    }
    bool whitespaceRemaining() const {
        for (size_t i = offset; i < length; ++i)
            if (data[i] != ' ' && data[i] != '\t' && data[i] != '\r' && data[i] != '\n') return false;
        return true;
    }
};
}

// Read-only parsing allows a safe retry after NoMemory. A mutable input would
// have been modified by ArduinoJson's zero-copy parser on the first attempt.
inline DeserializationError parse(DynamicJsonDocument& doc, const char* input,
                                  size_t length, size_t maxBytes, size_t maxCapacity) {
    doc.clear();
    if (!input || !length) return DeserializationError::EmptyInput;
    if (length > maxBytes) return DeserializationError::InvalidInput;
    size_t desired = length < 1536 ? 2048 : length + 512;
    if (desired > maxCapacity) desired = maxCapacity;
    if (doc.capacity() < desired || doc.capacity() > maxCapacity)
        doc = DynamicJsonDocument(desired);
    for (;;) {
        if (!doc.capacity()) return DeserializationError::NoMemory;
        detail::Input reader(input, length);
        auto error = deserializeJson(doc, reader);
        // ArduinoJson stops at the closing bracket. A relay frame/request must
        // contain one complete JSON container, not a valid prefix plus junk.
        if (!error && (!(doc.is<JsonObject>() || doc.is<JsonArray>()) || !reader.whitespaceRemaining()))
            error = DeserializationError::InvalidInput;
        if (!error) return error;
        doc.clear(); // Never expose a partially parsed or previous request.
        if (error != DeserializationError::NoMemory || doc.capacity() >= maxCapacity)
            return error;
        size_t next = doc.capacity() * 2;
        if (next > maxCapacity) next = maxCapacity;
        doc = DynamicJsonDocument(next);
    }
}

inline bool isSigningEnvelope(JsonDocument& doc) {
    if (!doc.is<JsonArray>() || doc.size() != 3 ||
        !doc[0].is<const char*>() || doc[0].as<JsonString>().size() != 5 ||
        strcmp(doc[0].as<const char*>(), "EVENT") != 0 ||
        !doc[1].is<const char*>() || !doc[2].is<JsonObject>()) return false;
    JsonObject event = doc[2];
    if (!event["kind"].is<unsigned int>() || event["kind"].as<unsigned int>() != 24133 ||
        !event["pubkey"].is<const char*>() || !event["content"].is<const char*>()) return false;
    JsonString key = event["pubkey"].as<JsonString>();
    if (key.size() != 64) return false;
    for (size_t i = 0; i < key.size(); ++i) {
        char c = key.c_str()[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
    }
    JsonString content = event["content"].as<JsonString>();
    return content.size() && content.size() == strlen(content.c_str());
}
}
}
