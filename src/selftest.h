#pragma once
#include "nip44/nip44.h"
#include "wallet.h"
inline void firmwareSelfTest() {
    using namespace Wallet;
    Serial.println("SELFTEST: starting recovery vectors");
    // Public deterministic vectors only; no Preferences writes or network messages.
    uint8_t entropy[32] = {0};
    String words12 = mnemonicFromEntropy(entropy, 16), words24 = mnemonicFromEntropy(entropy, 32);
    require(checkMnemonic(words12) && checkMnemonic(words24), "Mnemonic vectors failed");
    Account a;
    a.open(words12);
    require(a.fingerprint() == "73c5da0a", "Recovery fingerprint failed");
    a.close();
    require(!a.ready(), "Wallet keys retained after close");
    bool locked = false;
    try {
        a.validate({});
    } catch (...) {
        locked = true;
    }
    require(locked, "Closed wallet accepted validation");
    Serial.println("SELFTEST: 12-word recovery and wallet cleanup passed");
    a.open(words24);
    a.close();
    Serial.println("SELFTEST: 24-word recovery passed; starting PIN derivation");
    uint8_t salt[16] = {0}, derived[32];
    keyForPin("12345678", salt, derived);
    require(toHex(derived, 32) ==
                "9935a90d9a2a3b15e0026efbd3fff3ec32d88a036579b46deea50cc6dd272a39",
            "PBKDF2 independent vector failed");
    nostr::crypto::wipe(derived, 32);
    Serial.println("SELFTEST: PIN derivation passed; sealing vault");
    String test = "public test fixture", pin = "12345678";
    auto blob = seal(test, pin);
    Serial.println("SELFTEST: opening vault");
    require(unseal(blob, pin) == test, "Vault roundtrip failed");
    Serial.println("SELFTEST: checking wrong PIN");
    bool wrong = false;
    try {
        unseal(blob, "87654321");
    } catch (...) {
        wrong = true;
    }
    require(wrong, "Vault accepted wrong PIN");
    Serial.println("SELFTEST: checking tamper rejection");
    blob.back() ^= 1;
    bool tamper = false;
    try {
        unseal(blob, pin);
    } catch (...) {
        tamper = true;
    }
    require(tamper, "Vault accepted tampering");
    Serial.println("SELFTEST: starting NIP44 roundtrip");
    // Real transport roundtrip uses fresh independent keys.
    String first = identity(), second = identity();
    uint8_t raw[32];
    fromHex(second, raw, 32);
    PrivateKey sk(raw);
    String secondPub = sk.publicKey().toString().substring(2);
    fromHex(first, raw, 32);
    PrivateKey fk(raw);
    String firstPub = fk.publicKey().toString().substring(2);
    nostr::crypto::wipe(raw, 32);
    auto encrypted = executeEncryptMessageNip44(test, first, secondPub);
    require(encrypted.length() && executeDecryptMessageNip44(encrypted, second, firstPub) == test,
            "NIP44 roundtrip failed");
    encrypted[encrypted.length() / 2] = encrypted[encrypted.length() / 2] == 'A' ? 'B' : 'A';
    require(executeDecryptMessageNip44(encrypted, second, firstPub).isEmpty(),
            "NIP44 accepted tampering");
    wipe(first);
    wipe(second);
    wipe(words12);
    wipe(words24);
    nostr::crypto::clearCaches();
    Serial.println("BITCOIN SELFTEST PASS: recovery, vault, wrong PIN, tamper, NIP44");
}
