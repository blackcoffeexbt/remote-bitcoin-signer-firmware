#include "../src/pin_attempts.h"
#include <cassert>
#include <iostream>

int main() {
    unsigned count = 0, persisted = 0;
    bool wiped = false;
    auto save = [&](unsigned n) { persisted = n; };
    auto wipe = [&] { wiped = true; };
    for (unsigned attempt = 1; attempt <= 16; ++attempt) {
        bool checked = false;
        try {
            PinAttempts::verify(count, save, [&] {
                checked = true;
                assert(persisted == attempt); // Durable before any PIN work.
                throw std::runtime_error("wrong");
            }, wipe, "Wallet PIN");
            assert(false);
        } catch (const std::runtime_error &ex) {
            assert(std::string(ex.what()).find(std::to_string(16 - attempt) +
                   " attempts remaining") != std::string::npos);
        }
        assert(checked && count == attempt && wiped == (attempt == 16));
        count = persisted; // Reboot cannot replenish attempts.
    }
    bool checked = false;
    try {
        PinAttempts::verify(count, save, [&] { checked = true; }, wipe, "Wallet PIN");
        assert(false);
    } catch (...) {}
    assert(!checked && wiped);

    count = persisted = 15;
    wiped = false;
    PinAttempts::verify(count, save, [] {}, wipe, "Settings PIN");
    assert(count == 0 && persisted == 0 && !wiped); // Correct final attempt is allowed.
    count = persisted = 4;
    checked = false;
    try {
        PinAttempts::verify(count, [](unsigned) { throw std::runtime_error("save failed"); },
                            [&] { checked = true; }, wipe, "Wallet PIN");
        assert(false);
    } catch (...) {}
    assert(!checked && count == 4 && !wiped);

    // Reset failure must leave the reserved attempt charged.
    try {
        PinAttempts::verify(count, [&](unsigned n) {
            if (!n) throw std::runtime_error("reset failed");
            persisted = n;
        }, [] {}, wipe, "Wallet PIN");
        assert(false);
    } catch (...) {}
    assert(count == 5 && persisted == 5);
    unsigned other = 9;
    PinAttempts::verify(count, save, [] {}, wipe, "Wallet PIN");
    assert(other == 9 && count == 0);
    assert(PinAttempts::cooldownMs(0) == 0);
    assert(PinAttempts::cooldownMs(1) == 2000);
    assert(PinAttempts::cooldownMs(10) == 1024000);
    assert(PinAttempts::cooldownMs(16) == 1024000);
    std::cout << "PASS: PIN boundaries, persistence, reset, storage failure and cooldown\n";
}
