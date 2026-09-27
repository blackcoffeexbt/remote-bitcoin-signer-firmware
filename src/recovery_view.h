#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

namespace RecoveryView {
constexpr uint32_t durationMs = 60000;
inline bool expired(uint32_t now, uint32_t shownAt) {
    return uint32_t(now - shownAt) >= durationMs;
}
inline void clear(char *buffer, size_t capacity) {
    auto p = reinterpret_cast<volatile char *>(buffer);
    while (capacity--)
        *p++ = 0;
}
// Format directly into the owned display buffer; no intermediate word copies.
inline bool format(const char *phrase, size_t length, char *out, size_t capacity) {
    clear(out, capacity);
    size_t used = 0, start = 0;
    unsigned number = 1;
    while (start < length) {
        size_t end = start;
        while (end < length && phrase[end] != ' ')
            ++end;
        if (end == start || end - start > 8 || number > 24)
            break;
        int written = snprintf(out + used, capacity - used, "%u. %.*s\n",
                               number++, int(end - start), phrase + start);
        if (written < 0 || size_t(written) >= capacity - used)
            break;
        used += written;
        start = end + 1;
    }
    if (start >= length && (number == 13 || number == 25))
        return true;
    clear(out, capacity);
    return false;
}
} // namespace RecoveryView
