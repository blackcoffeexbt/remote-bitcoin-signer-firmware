#pragma once
#include <algorithm>
#include <stdexcept>
#include <string>

namespace PinAttempts {
constexpr unsigned limit = 16; // More than 15 incorrect entries.
inline unsigned remaining(unsigned count) {
    return count >= limit ? 0 : limit - count;
}
inline unsigned cooldownMs(unsigned count) {
    return count ? 1000U * (1U << std::min(count, 10U)) : 0;
}
// Reserve durably before checking the credential. Power loss during a check consumes
// an attempt; a failed save must prevent credential verification entirely.
template <typename Save, typename Verify, typename Wipe>
void verify(unsigned &count, Save save, Verify check, Wipe wipe, const char *name) {
    if (count >= limit) {
        wipe();
        throw std::runtime_error("0 attempts remaining. Device wipe required.");
    }
    save(count + 1);
    ++count;
    try {
        check();
    } catch (...) {
        if (count >= limit)
            wipe();
        throw std::runtime_error(std::string(name) + " incorrect or damaged credential. " +
                                 std::to_string(remaining(count)) +
                                 " attempts remaining before device wipe." +
                                 (count >= limit ? " Wiping device." : " Wait before retrying."));
    }
    save(0);
    count = 0;
}
} // namespace PinAttempts
