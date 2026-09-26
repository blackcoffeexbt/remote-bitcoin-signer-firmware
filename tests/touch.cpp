#include "../src/touch_state.h"
#include <cassert>
#include <iostream>

// LVGL's click-triggered keyboard inserts a character on a pressed -> released edge.
struct Keypad {
    TouchContact touch;
    bool previous = false;
    unsigned characters = 0;
    bool sample(bool valid, unsigned fingers, unsigned event, uint32_t now) {
        const bool pressed = touch.update(valid, fingers, event, now);
        if (previous && !pressed)
            characters++;
        previous = pressed;
        return pressed;
    }
};
int main() {
    Keypad keypad;
    assert(!keypad.sample(false, 0, 0, 0));
    assert(keypad.sample(true, 1, 0, 10));
    // Reproduce a held finger with alternating empty, lift, and contact packets.
    // The previous implementation produced a character at every empty/lift packet.
    for (unsigned now = 40; now < 1000; now += 90) {
        assert(keypad.sample(true, 0, 0, now));
        assert(!keypad.touch.hasPosition());
        assert(keypad.sample(true, 1, 1, now + 30));
        assert(!keypad.touch.hasPosition());
        assert(keypad.sample(true, 1, 2, now + 60));
        assert(keypad.touch.hasPosition());
    }
    assert(keypad.characters == 0);
    assert(keypad.sample(true, 0, 0, 1060));
    assert(keypad.sample(true, 0, 0, 1120));
    assert(!keypad.sample(true, 0, 0, 1150));
    assert(keypad.characters == 1);
    // Stale contact after release cannot re-arm the keyboard.
    assert(!keypad.sample(true, 1, 2, 1180));
    assert(!keypad.touch.hasPosition());
    assert(!keypad.sample(true, 0, 0, 1210));
    assert(keypad.characters == 1);
    // An intentional second tap of the SAME digit must still work.
    assert(keypad.sample(true, 1, 0, 1240));
    assert(keypad.sample(true, 1, 1, 1270));
    assert(!keypad.sample(true, 0, 0, 1360));
    assert(keypad.characters == 2);
    // Read failures retain the point briefly but cannot leave a stuck key.
    assert(keypad.sample(true, 1, 0, 1400));
    assert(keypad.sample(false, 0, 0, 1430));
    assert(!keypad.touch.hasPosition());
    assert(!keypad.sample(false, 0, 0, 1550));
    assert(!keypad.sample(true, 1, 2, 1580));
    assert(keypad.characters == 3);
    // Debounce timing survives millis() wraparound.
    TouchContact wrap;
    assert(wrap.update(true, 1, 0, UINT32_MAX - 60));
    assert(wrap.update(true, 0, 0, UINT32_MAX - 30));
    assert(wrap.update(true, 0, 0, 10));
    assert(!wrap.update(true, 0, 0, 60));
    // Unsupported multi-touch does not start a press.
    assert(!wrap.update(true, 2, 0, 100));
    assert(!wrap.update(true, 1, 3, 130));
    std::cout << "PASS: one character per debounced tap; repeat taps, stale packets, errors, "
                 "wraparound\n";
}
