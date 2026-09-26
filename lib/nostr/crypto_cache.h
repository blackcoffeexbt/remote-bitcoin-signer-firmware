#pragma once
#include <Arduino.h>
#include <Bitcoin.h>

namespace nostr {
namespace crypto {
// The signer crypto worker exclusively owns this cache. Returned key pointers
// remain valid only until another cache operation; do not retain or share them.
PrivateKey* signingKey(const String& privateKeyHex);
bool sharedSecret(const String& privateKeyHex, const String& peerXHex, uint8_t out[32]);
void clearCaches();
void expireCaches();
void wipe(void* data, size_t size);
}
}
