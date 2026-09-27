#include "../src/display_preferences.h"
#include <cassert>
#include <initializer_list>

int main() {
    using namespace DisplayPreferences;
    State s;
    assert(valid(s) && s.brightness == 100 && s.timeoutSeconds == 30);
    assert(!s.dark && !s.timeoutDisabled);
    assert(!expired(s, 29999, 0));
    assert(expired(s, 30000, 0));
    for (auto seconds : timeouts) {
        s.timeoutSeconds = seconds;
        const uint32_t start = UINT32_MAX - 100;
        assert(!expired(s, start + seconds * 1000U - 1, start));
        assert(expired(s, start + seconds * 1000U, start));
        assert(!expired(s, start + 4999, start, true));
        assert(expired(s, start + 5000, start, true));
        s.timeoutDisabled = true;
        assert(!expired(s, start + 600000, start));
        assert(!expired(s, start + 600000, start, true));
        s.timeoutDisabled = false;
    }
    for (uint8_t brightness : {0, 9, 101, 255}) {
        s.brightness = brightness;
        assert(!valid(s));
    }
    for (uint8_t brightness : {10, 50, 100}) {
        s.brightness = brightness;
        assert(valid(s));
    }
    for (uint16_t timeout : {0, 1, 29, 301, 65535}) {
        s.timeoutSeconds = timeout;
        assert(!valid(s));
    }
}
