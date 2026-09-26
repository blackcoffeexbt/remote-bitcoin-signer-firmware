#include "crypto_cache.h"
#include <Hash.h>
#include <new>
#include <utility/trezor/ecdsa.h>
#include <utility/trezor/secp256k1.h>

namespace nostr {
namespace crypto {
namespace {
constexpr uint32_t CACHE_TTL_MS = 300000;
constexpr size_t KEY_COUNT = 4;
constexpr size_t SECRET_COUNT = 8;
struct KeyEntry {
    uint8_t identity[32] = {};
    PrivateKey* key = nullptr;
    uint32_t used = 0;
};
struct SecretEntry {
    uint8_t identity[32] = {};
    uint8_t peer[32] = {};
    uint8_t secret[32] = {};
    uint32_t used = 0;
    bool valid = false;
};
KeyEntry keys[KEY_COUNT];
SecretEntry secrets[SECRET_COUNT];
struct SecretBytes {
    uint8_t bytes[32] = {};
    ~SecretBytes() { wipe(bytes, sizeof(bytes)); }
};
bool decodeKey(const String& hex, uint8_t* out) {
    if (hex.length() != 64) return false;
    for (size_t i = 0; i < 64; ++i) {
        char c = hex[i];
        int n = c >= '0' && c <= '9' ? c - '0' :
                c >= 'a' && c <= 'f' ? c - 'a' + 10 :
                c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
        if (n < 0) return false;
        if (i % 2) out[i / 2] |= n;
        else out[i / 2] = n << 4;
    }
    return true;
}
bool validScalar(const uint8_t* key) {
    static const uint8_t order[32] = {
        0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xfe,
        0xba,0xae,0xdc,0xe6,0xaf,0x48,0xa0,0x3b,0xbf,0xd2,0x5e,0x8c,0xd0,0x36,0x41,0x41};
    uint8_t nonzero = 0;
    for (size_t i = 0; i < 32; ++i) nonzero |= key[i];
    return nonzero && memcmp(key, order, 32) < 0;
}
void clear(KeyEntry& entry) {
    delete entry.key; // uBitcoin's destructor wipes the scalar.
    entry.key = nullptr;
    wipe(entry.identity, sizeof(entry.identity));
    entry.used = 0;
}
void clear(SecretEntry& entry) { wipe(&entry, sizeof(entry)); }
PrivateKey* getKey(const uint8_t* raw, const uint8_t* identity) {
    const uint32_t now = millis();
    size_t victim = 0;
    for (size_t i = 0; i < KEY_COUNT; ++i) {
        if (keys[i].key && memcmp(keys[i].identity, identity, 32) == 0) {
            keys[i].used = now;
            return keys[i].key;
        }
    }
    for (size_t i = 0; i < KEY_COUNT; ++i) {
        if (!keys[i].key) { victim = i; break; }
        if (uint32_t(now - keys[i].used) > uint32_t(now - keys[victim].used)) victim = i;
    }
    clear(keys[victim]);
    keys[victim].key = new (std::nothrow) PrivateKey(raw);
    if (!keys[victim].key) return nullptr;
    memcpy(keys[victim].identity, identity, 32);
    keys[victim].used = now;
    return keys[victim].key;
}
}
void wipe(void* data, size_t size) {
    volatile uint8_t* p = static_cast<volatile uint8_t*>(data);
    while (size--) *p++ = 0;
}
void clearCaches() {
    for (auto& e : keys) clear(e);
    for (auto& e : secrets) clear(e);
}
void expireCaches() {
    const uint32_t now = millis();
    for (auto& e : keys) if (e.key && uint32_t(now - e.used) >= CACHE_TTL_MS) clear(e);
    for (auto& e : secrets) if (e.valid && uint32_t(now - e.used) >= CACHE_TTL_MS) clear(e);
}
PrivateKey* signingKey(const String& privateKeyHex) {
    expireCaches();
    SecretBytes raw, identity;
    if (!decodeKey(privateKeyHex, raw.bytes) || !validScalar(raw.bytes)) return nullptr;
    sha256(raw.bytes, 32, identity.bytes);
    return getKey(raw.bytes, identity.bytes);
}
bool sharedSecret(const String& privateKeyHex, const String& peerXHex, uint8_t out[32]) {
    wipe(out, 32);
    expireCaches();
    SecretBytes raw, identity;
    uint8_t peer[33] = {0x02}; // Nostr x-only keys select the even Y point.
    if (!decodeKey(privateKeyHex, raw.bytes) || !validScalar(raw.bytes) ||
        !decodeKey(peerXHex, peer + 1)) return false;
    sha256(raw.bytes, 32, identity.bytes);
    const uint32_t now = millis();
    for (auto& e : secrets) {
        if (e.valid && memcmp(e.identity, identity.bytes, 32) == 0 && memcmp(e.peer, peer + 1, 32) == 0) {
            memcpy(out, e.secret, 32);
            e.used = now;
            return true;
        }
    }
    uint8_t uncompressed[65];
    // Use the installed library's checked compressed-key decoder. Its higher
    // level parser ignores this return code and decompresses twice.
    if (ecdsa_uncompress_pubkey(&secp256k1, peer, uncompressed) != 1) return false;
    PublicKey publicKey(uncompressed + 1, false);
    PrivateKey* key = getKey(raw.bytes, identity.bytes);
    if (!key || key->ecdh(publicKey, out, false) != 1) { wipe(out, 32); return false; }
    size_t victim = 0;
    for (size_t i = 0; i < SECRET_COUNT; ++i) {
        if (!secrets[i].valid) { victim = i; break; }
        if (uint32_t(now - secrets[i].used) > uint32_t(now - secrets[victim].used)) victim = i;
    }
    clear(secrets[victim]);
    auto& e = secrets[victim];
    memcpy(e.identity, identity.bytes, 32);
    memcpy(e.peer, peer + 1, 32);
    memcpy(e.secret, out, 32);
    e.used = millis();
    e.valid = true;
    return true;
}
}
}
