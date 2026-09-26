#pragma once
#include <cstdint>

class TouchContact {
    bool pressed = false;
    bool releasing = false;
    bool positionValid = false;
    bool explicitLift = false;
    uint32_t releaseStarted = 0;
    uint32_t lastRead = 0, releasedAt = 0, lastContact = 0;

  public:
    static constexpr uint32_t releaseDelayMs = 70;
    static constexpr uint32_t liftDelayMs = 20;
    static constexpr uint32_t readTimeoutMs = 150;

    // True only for an accepted coordinate-bearing packet, not a held/debounced state.
    bool hasPosition() const {
        return positionValid;
    }

    bool update(bool valid, unsigned fingers, unsigned event, uint32_t now) {
        positionValid = false;
        if (!valid) {
            if (uint32_t(now - lastRead) >= readTimeoutMs) {
                if (pressed)
                    releasedAt = now;
                pressed = false;
                releasing = false;
            }
            return pressed;
        }
        lastRead = now;
        // AXS15231B: press=0, lift=1, contact=2, no event=3.
        const bool contact = fingers == 1 && (event == 0 || event == 2);
        if (contact) {
            // Ignore short stale tails, but accept a new contact after a quiet interval:
            // rendering can miss the controller's single initial press packet.
            const bool quiet = uint32_t(now - lastContact) >= releaseDelayMs;
            lastContact = now;
            if (!pressed && event != 0 && (!quiet || uint32_t(now - releasedAt) < releaseDelayMs))
                return false;
            pressed = true;
            releasing = false;
            positionValid = true;
        } else if (pressed) {
            const bool lift = event == 1;
            if (!releasing || (lift && !explicitLift)) {
                releasing = true;
                explicitLift = lift;
                releaseStarted = now;
            } else if (uint32_t(now - releaseStarted) >=
                       (explicitLift ? liftDelayMs : releaseDelayMs)) {
                pressed = false;
                releasing = false;
                releasedAt = now;
            }
        }
        return pressed;
    }
};
