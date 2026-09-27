#pragma once
#include <stdint.h>

namespace DisplayPreferences {
constexpr uint16_t timeouts[] = {15, 30, 60, 120, 300};
struct State {
    uint8_t brightness = 100;
    uint16_t timeoutSeconds = 30;
    bool timeoutDisabled = false;
    bool dark = false;
};
inline bool valid(const State &s) {
    if (s.brightness < 10 || s.brightness > 100) return false;
    for (auto seconds : timeouts)
        if (s.timeoutSeconds == seconds) return true;
    return false;
}
inline bool expired(const State &s, uint32_t now, uint32_t lastActivity,
                    bool signingWake = false) {
    const uint32_t duration = signingWake ? 5000U : uint32_t(s.timeoutSeconds) * 1000U;
    return !s.timeoutDisabled && uint32_t(now - lastActivity) >= duration;
}
} // namespace DisplayPreferences
