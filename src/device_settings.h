#pragma once
#include "approval_policy.h"
#include "wallet.h"
#include <ArduinoJson.h>

namespace DeviceSettings {
inline bool hasPin() {
    Preferences p;
    p.begin("btc-signer", true);
    const bool exists = p.getBytesLength("settings-pin") > 0;
    p.end();
    return exists;
}
inline void setPin(const String &pin) {
    Wallet::require(!hasPin(), "Settings PIN already configured");
    auto blob = Wallet::seal("bitcoin-signer-settings-v1", pin);
    Preferences p;
    p.begin("btc-signer", false);
    const auto written = p.putBytes("settings-pin", blob.data(), blob.size());
    p.end();
    Wallet::require(written == blob.size(), "Cannot save settings PIN");
}
inline void verifyPinBlob(const Wallet::Bytes &blob, const String &pin) {
    String clear = Wallet::unseal(blob, pin);
    const bool valid = clear == "bitcoin-signer-settings-v1";
    Wallet::wipe(clear);
    Wallet::require(valid, "Wrong settings PIN");
}
inline void verifyPin(const String &pin) {
    Preferences p;
    p.begin("btc-signer", true);
    const auto size = p.getBytesLength("settings-pin");
    Wallet::Bytes blob(size <= 512 ? size : 0);
    if (blob.size())
        p.getBytes("settings-pin", blob.data(), blob.size());
    p.end();
    verifyPinBlob(blob, pin);
}
inline ApprovalPolicy::State loadPolicy() {
    Preferences p;
    p.begin("btc-signer", true);
    const String text = p.getString("auto-policy", "");
    p.end();
    ApprovalPolicy::State state;
    if (!text.length())
        return state; // Disabled on first installation.
    DynamicJsonDocument d(512);
    if (deserializeJson(d, text) || d["version"] != 1 || !d["under"].is<uint64_t>() ||
        !d["daily"].is<uint64_t>() || !d["spent"].is<uint64_t>() || !d["day"].is<int64_t>()) {
        state.valid = false;
        return state;
    }
    state.under = d["under"].as<uint64_t>();
    state.daily = d["daily"].as<uint64_t>();
    state.spent = d["spent"].as<uint64_t>();
    state.day = d["day"].as<int64_t>();
    state.valid = state.under <= ApprovalPolicy::maxSats &&
                  state.daily <= ApprovalPolicy::maxSats &&
                  state.spent <= ApprovalPolicy::maxSats && state.day >= 0;
    return state;
}
inline String policyJson(const ApprovalPolicy::State &state) {
    DynamicJsonDocument d(512);
    d["version"] = 1;
    d["under"] = state.under;
    d["daily"] = state.daily;
    d["spent"] = state.spent;
    d["day"] = state.day;
    String text;
    serializeJson(d, text);
    return text;
}
inline void savePolicy(const ApprovalPolicy::State &state) {
    Wallet::require(state.valid, "Auto signing settings are damaged");
    const String text = policyJson(state);
    Preferences p;
    p.begin("btc-signer", false);
    const auto written = p.putString("auto-policy", text);
    p.end();
    Wallet::require(written == text.length(), "Cannot save daily allowance; signing stopped");
}
} // namespace DeviceSettings
