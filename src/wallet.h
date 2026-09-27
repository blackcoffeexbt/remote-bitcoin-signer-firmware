#pragma once
#include "bitcoin_network.h"
#include "crypto_cache.h"
#include "dice_entropy.h"
#include "signing.h"
#include "validation.h"
#include <Arduino.h>
#include <Bitcoin.h>
#include <Hash.h>
#include <PSBT.h>
#include <Preferences.h>
#include <esp_system.h>
#include <mbedtls/base64.h>
#include <mbedtls/gcm.h>
#include <mbedtls/pkcs5.h>
#include <memory>
#include <utility/trezor/bip39.h>
namespace Wallet {
using namespace BitcoinPolicy;
inline void wipe(String &s) {
    if (s.length())
        nostr::crypto::wipe(&s[0], s.length());
    s = "";
}
inline String hex(const Bytes &b) {
    return toHex(b.data(), b.size());
}
inline Bytes hash(const Bytes &b) {
    Bytes h(32);
    sha256(b.data(), b.size(), h.data());
    return h;
}
inline Bytes hash256(const Bytes &b) {
    return hash(hash(b));
}
inline String encode(const Bytes &b) {
    size_t n = 0;
    Bytes out((b.size() + 2) / 3 * 4 + 1);
    require(!mbedtls_base64_encode(out.data(), out.size(), &n, b.data(), b.size()),
            "Base64 failed");
    return String((char *)out.data(), n);
}
inline Bytes decode(const String &s) {
    require(s.length() <= 43692, "PSBT exceeds 32 KiB");
    Bytes b(s.length() / 4 * 3 + 3);
    size_t n = 0;
    require(!mbedtls_base64_decode(b.data(), b.size(), &n, (const uint8_t *)s.c_str(), s.length()),
            "Invalid base64");
    b.resize(n);
    require(encode(b) == s, "Noncanonical base64");
    return b;
}
inline bool pinValid(const String &pin) {
    if (pin.length() < 6 || pin.length() > 32)
        return false;
    for (char c : pin)
        if (c < '0' || c > '9')
            return false;
    return true;
}
inline void keyForPin(const String &pin, const uint8_t *salt, uint8_t *key) {
    require(pinValid(pin), "PIN must contain 6 to 32 digits");
    // PBKDF2-HMAC-SHA256, one 32-byte block. Yield between batches so the
    // ESP32 idle task/watchdog and Wi-Fi remain responsive during 210k rounds.
    mbedtls_md_context_t ctx;
    mbedtls_md_init(&ctx);
    int rc = mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
    uint8_t u[32] = {}, next[32] = {};
    const uint8_t block[4] = {0, 0, 0, 1};
    if (!rc)
        rc = mbedtls_md_hmac_starts(&ctx, (const unsigned char *)pin.c_str(), pin.length());
    if (!rc)
        rc = mbedtls_md_hmac_update(&ctx, salt, 16);
    if (!rc)
        rc = mbedtls_md_hmac_update(&ctx, block, 4);
    if (!rc)
        rc = mbedtls_md_hmac_finish(&ctx, u);
    memcpy(key, u, 32);
    for (unsigned round = 1; round < 210000 && !rc; round++) {
        rc = mbedtls_md_hmac_reset(&ctx);
        if (!rc)
            rc = mbedtls_md_hmac_update(&ctx, u, 32);
        if (!rc)
            rc = mbedtls_md_hmac_finish(&ctx, next);
        for (size_t i = 0; i < 32; i++) {
            key[i] ^= next[i];
            u[i] = next[i];
        }
        if (round % 512 == 0)
            delay(1);
    }
    mbedtls_md_free(&ctx);
    nostr::crypto::wipe(u, 32);
    nostr::crypto::wipe(next, 32);
    if (rc)
        nostr::crypto::wipe(key, 32);
    require(!rc, "PIN derivation failed");
}
inline bool exists() {
    Preferences p;
    p.begin("btc-signer", true);
    bool yes = p.getBytesLength("vault") > 0;
    p.end();
    return yes;
}
// The blob authenticates the format version as well as encrypting all secret material.
inline Bytes seal(const String &clear, const String &pin) {
    require(pinValid(pin), "PIN must contain 6 to 32 digits");
    Bytes blob(45 + clear.length());
    blob[0] = 1;
    esp_fill_random(blob.data() + 1, 28);
    uint8_t key[32];
    keyForPin(pin, blob.data() + 1, key);
    mbedtls_gcm_context ctx;
    mbedtls_gcm_init(&ctx);
    int rc = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key, 256);
    if (!rc)
        rc = mbedtls_gcm_crypt_and_tag(&ctx, MBEDTLS_GCM_ENCRYPT, clear.length(), blob.data() + 17,
                                       12, blob.data(), 1, (uint8_t *)clear.c_str(),
                                       blob.data() + 45, 16, blob.data() + 29);
    mbedtls_gcm_free(&ctx);
    nostr::crypto::wipe(key, 32);
    require(!rc, "Vault encryption failed");
    return blob;
}
inline String unseal(const Bytes &blob, const String &pin) {
    require(blob.size() >= 45 && blob.size() <= 512 && blob[0] == 1, "Invalid vault format");
    uint8_t key[32];
    keyForPin(pin, blob.data() + 1, key);
    Bytes plain(blob.size() - 45 + 1, 0);
    mbedtls_gcm_context ctx;
    mbedtls_gcm_init(&ctx);
    int rc = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key, 256);
    if (!rc)
        rc = mbedtls_gcm_auth_decrypt(&ctx, blob.size() - 45, blob.data() + 17, 12, blob.data(), 1,
                                      blob.data() + 29, 16, blob.data() + 45, plain.data());
    mbedtls_gcm_free(&ctx);
    nostr::crypto::wipe(key, 32);
    if (rc) {
        nostr::crypto::wipe(plain.data(), plain.size());
        throw std::runtime_error("Wrong PIN or damaged vault");
    }
    String clear((char *)plain.data());
    nostr::crypto::wipe(plain.data(), plain.size());
    return clear;
}
inline void store(const String &phrase, const String &pin, const String &transport) {
    String clear = phrase + "\n" + transport;
    Bytes blob;
    try {
        blob = seal(clear, pin);
    } catch (...) {
        wipe(clear);
        throw;
    }
    wipe(clear);
    Preferences p;
    p.begin("btc-signer", false);
    size_t n = p.putBytes("vault", blob.data(), blob.size());
    p.end();
    require(n == blob.size(), "Vault storage failed");
}
inline void unlock(const String &pin, String &phrase, String &transport) {
    Preferences p;
    p.begin("btc-signer", true);
    size_t n = p.getBytesLength("vault");
    if (n < 45 || n > 512) {
        p.end();
        throw std::runtime_error("Invalid vault");
    }
    Bytes blob(n);
    p.getBytes("vault", blob.data(), n);
    p.end();
    String clear = unseal(blob, pin);
    int split = clear.indexOf('\n');
    if (split <= 0) {
        wipe(clear);
        throw std::runtime_error("Invalid vault contents");
    }
    phrase = clear.substring(0, split);
    transport = clear.substring(split + 1);
    wipe(clear);
}
inline String generate(const char *rolls = nullptr, size_t count = 0) {
    require(!rolls || DiceEntropy::valid(rolls, count), "Enter 50-256 dice rolls (1-6)");
    uint8_t entropy[16];
    if (rolls)
        DiceEntropy::derive(entropy, rolls, count);
    else
        esp_fill_random(entropy, sizeof(entropy));
    String s = mnemonicFromEntropy(entropy, sizeof(entropy));
    nostr::crypto::wipe(entropy, sizeof(entropy));
    return s;
}
inline String identity() {
    uint8_t secret[32];
    String s;
    do {
        esp_fill_random(secret, 32);
        PrivateKey k(secret);
        if (k) {
            s = toHex(secret, 32);
            break;
        }
    } while (true);
    nostr::crypto::wipe(secret, 32);
    return s;
}
class Account {
    std::unique_ptr<HDPrivateKey> root, account;

  public:
    void open(const String &phrase) {
        int words = 1;
        for (char c : phrase)
            if (c == ' ')
                words++;
        require((words == 12 || words == 24) && mnemonic_check(phrase.c_str()),
                "Invalid 12 or 24 word recovery phrase");
        close();
        // Derive without String copies of the phrase or retained seed buffers.
        struct Material {
            uint8_t seed[64] = {}, master[64] = {};
            ~Material() {
                nostr::crypto::wipe(seed, sizeof(seed));
                nostr::crypto::wipe(master, sizeof(master));
            }
        } material;
        mbedtls_md_context_t ctx;
        mbedtls_md_init(&ctx);
        const auto md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA512);
        int rc = mbedtls_md_setup(&ctx, md, 1);
        if (!rc)
            rc = mbedtls_pkcs5_pbkdf2_hmac(
                &ctx, reinterpret_cast<const unsigned char *>(phrase.c_str()), phrase.length(),
                reinterpret_cast<const unsigned char *>("mnemonic"), 8, 2048, 64, material.seed);
        mbedtls_md_free(&ctx);
        if (!rc)
            rc = mbedtls_md_hmac(md, reinterpret_cast<const unsigned char *>("Bitcoin seed"), 12,
                                 material.seed, 64, material.master);
        require(!rc, "Wallet derivation failed");
        root.reset(
            new HDPrivateKey(material.master, material.master + 32, 0, nullptr, 0, (BITCOIN_TESTNET4 ? &Testnet : &Mainnet)));
        require(bool(*root), "Invalid seed");
        account.reset(new HDPrivateKey(BitcoinSigning::accountKey(*root)));
    }
    void close() {
        // uBitcoin destructors use memzero for private scalars and chain codes.
        account.reset();
        root.reset();
        nostr::crypto::clearCaches();
    }
    bool ready() const {
        return bool(root);
    }
    String fingerprint() {
        return root->fingerprint();
    }
    String xpub() {
        char out[120];
        account->xpub(out, sizeof(out));
        return String(out);
    }
    String descriptor() {
        String s = "wpkh([" + fingerprint() + BitcoinNetwork::origin + xpub() + "/<0;1>/*)";
        return s + "#" + descriptorChecksum(s);
    }
    Derived derive(uint32_t branch, uint32_t index) {
        return BitcoinSigning::derive(*account, branch, index);
    }
    Review validate(const Bytes &b) {
        require(ready(), "Device locked");
        Bytes fp(4);
        root->fingerprint(fp.data());
        return BitcoinPolicy::validate(
            b, fp, [this](uint32_t a, uint32_t i) { return derive(a, i); }, hash256);
    }
    String sign(const Bytes &b) {
        return encode(BitcoinSigning::sign(validate(b), *account));
    }
};
} // namespace Wallet
