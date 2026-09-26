#pragma once
#include <cstdint>

class TouchContact {
    bool pressed = false;
    bool releasing = false;
    bool positionValid = false;
    uint32_t releaseStarted = 0;
    uint32_t lastRead = 0;

  public:
    static constexpr uint32_t releaseDelayMs = 90;
    static constexpr uint32_t readTimeoutMs = 150;

    // True only for an accepted coordinate-bearing packet, not a held/debounced state.
    bool hasPosition() const {
        return positionValid;
    }

    bool update(bool valid, unsigned fingers, unsigned event, uint32_t now) {
        positionValid = false;
        if (!valid) {
            if (uint32_t(now - lastRead) >= readTimeoutMs) {
                pressed = false;
                releasing = false;
            }
            return pressed;
        }
        lastRead = now;
        // AXS15231B: press=0, lift=1, contact=2, no event=3.
        const bool contact = fingers == 1 && (event == 0 || event == 2);
        if (contact) {
            // Contact packets left over after a lift must not start a second tap.
            if (!pressed && event != 0)
                return false;
            pressed = true;
            releasing = false;
            positionValid = true;
        } else if (pressed) {
            if (!releasing) {
                releasing = true;
                releaseStarted = now;
            } else if (uint32_t(now - releaseStarted) >= releaseDelayMs) {
                pressed = false;
                releasing = false;
            }
        }
        return pressed;
    }
};
