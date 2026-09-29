#pragma once
#include <cstddef>
#include <cstdint>
#include "touch_state.h"

namespace CST816Packet {
// The 1.91-inch controller reports landscape coordinates; RM67162 rotation 0
// is portrait (LilyGO's rotation 1). Reject the off-panel capacitive home key.
inline bool portraitPoint(const uint8_t *packet, size_t length, uint16_t &x, uint16_t &y) {
    if (length != 13 || packet[2] != 1) return false;
    const unsigned event = packet[3] >> 6;
    if (event != 0 && event != 2) return false;
    const uint16_t rawX = ((packet[3] & 0x0f) << 8) | packet[4];
    const uint16_t rawY = ((packet[5] & 0x0f) << 8) | packet[6];
    if (rawX >= 536 || rawY >= 240) return false;
    x = 239 - rawY;
    y = rawX;
    return true;
}
}

// Reuse the signer's contact debounce so a transient I2C failure does not
// immediately release a held key or turn a held wake gesture into a new press.
class CST816Contact {
    TouchContact contact;
    uint16_t pointX = 0, pointY = 0;
  public:
    bool update(const uint8_t *packet, size_t length, uint32_t now) {
        if (!packet || length != 13 || packet[2] == 0xff)
            return contact.update(false, 0, 0, now);
        uint16_t x, y;
        const bool hasPoint = CST816Packet::portraitPoint(packet, length, x, y);
        const unsigned event = packet[3] >> 6;
        const bool pressed = contact.update(true, hasPoint ? 1 : 0, event, now);
        if (hasPoint && contact.hasPosition()) {
            pointX = x;
            pointY = y;
        }
        return pressed;
    }
    uint16_t x() const { return pointX; }
    uint16_t y() const { return pointY; }
};
