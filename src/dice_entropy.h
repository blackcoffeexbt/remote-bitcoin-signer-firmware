#pragma once
#include <Hash.h>
#include <stddef.h>
#include <stdint.h>

// Local-only deterministic entropy. Never persist or log rolls.
namespace DiceEntropy {
constexpr size_t minimum = 50, maximum = 256;
inline void wipe(void *data, size_t size) {
    auto p = static_cast<volatile uint8_t *>(data);
    while (size--)
        *p++ = 0;
}
inline bool valid(const char *rolls, size_t count) {
    if (!rolls || count < minimum || count > maximum)
        return false;
    for (size_t i = 0; i < count; ++i)
        if (rolls[i] < '1' || rolls[i] > '6')
            return false;
    return true;
}
class Rolls {
    char data_[maximum + 1] = {};
    size_t count_ = 0;
  public:
    ~Rolls() { clear(); }
    const char *data() const { return data_; }
    size_t size() const { return count_; }
    bool add(char face) {
        if (face < '1' || face > '6' || count_ == maximum)
            return false;
        data_[count_++] = face;
        return true;
    }
    void undo() {
        if (count_)
            data_[--count_] = 0;
    }
    void clear() {
        wipe(data_, sizeof(data_));
        count_ = 0;
    }
};
// SHA-256 of the exact ASCII digits (no separators or newline), truncated to
// the first 16 bytes for a 12-word BIP39 phrase. No device randomness is mixed in.
inline bool derive(uint8_t entropy[16], const char *rolls, size_t count) {
    if (!valid(rolls, count))
        return false;
    uint8_t digest[32];
    SHA256_CTX ctx;
    sha256_Init(&ctx);
    sha256_Update(&ctx, reinterpret_cast<const uint8_t *>(rolls), count);
    sha256_Final(&ctx, digest);
    wipe(&ctx, sizeof(ctx));
    memcpy(entropy, digest, 16);
    wipe(digest, sizeof(digest));
    return true;
}
} // namespace DiceEntropy
