#pragma once
#include <ArduinoJson.h>
#include <stdint.h>
namespace nostr {
// Linked values keep large content outside the small JSON document pool.
inline void canonicalEvent(JsonDocument& doc, const char* pubkey, uint32_t timestamp,
                           uint16_t kind, const char* tags, JsonString content) {
    doc.clear();
    JsonArray event = doc.to<JsonArray>();
    event.add(0); event.add(pubkey); event.add(timestamp); event.add(kind);
    event.add(serialized(tags)); event.add(content);
}
inline void responseFields(JsonDocument& doc, JsonString id, JsonString result) {
    doc.clear(); doc["id"] = id; doc["result"] = result;
}
#ifdef ARDUINO
inline String writeJson(const JsonDocument& doc) {
    String result;
    const size_t length = measureJson(doc);
    if (doc.overflowed() || !result.reserve(length)) return "";
    if (serializeJson(doc, result) != length) return "";
    return result;
}
inline String responseJson(const String& id, const String& result) {
    StaticJsonDocument<128> doc;
    responseFields(doc, JsonString(id.c_str(), id.length()), JsonString(result.c_str(), result.length()));
    return writeJson(doc);
}
#endif
}
