#include "../src/recovery_view.h"
#include <cassert>
#include <cstring>
#include <string>

int main() {
    char display[512];
    for (unsigned count : {12U, 24U}) {
        std::string phrase, expected;
        for (unsigned i = 1; i <= count; ++i) {
            if (i > 1) phrase += ' ';
            phrase += "abandon"; // Public formatting fixture only; not a wallet.
            expected += std::to_string(i) + ". abandon\n";
        }
        assert(RecoveryView::format(phrase.data(), phrase.size(), display, sizeof(display)));
        assert(expected == display);
        RecoveryView::clear(display, sizeof(display));
        for (char c : display) assert(c == 0);
        char small[20];
        assert(!RecoveryView::format(phrase.data(), phrase.size(), small, sizeof(small)));
        for (char c : small) assert(c == 0);
    }
    for (const char *invalid : {"", "abandon", " abandon", "abandon  abandon"}) {
        memset(display, 'x', sizeof(display));
        assert(!RecoveryView::format(invalid, strlen(invalid), display, sizeof(display)));
        for (char c : display) assert(c == 0);
    }
    assert(!RecoveryView::expired(59999, 0));
    assert(RecoveryView::expired(60000, 0));
    assert(RecoveryView::expired(70000, 0));
    const uint32_t nearWrap = UINT32_MAX - 100;
    assert(!RecoveryView::expired(nearWrap + 59999, nearWrap));
    assert(RecoveryView::expired(nearWrap + 60000, nearWrap));
}
