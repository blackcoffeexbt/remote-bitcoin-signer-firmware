#include "../src/protocol_state.h"
#include <cassert>
#include <iostream>
int main() {
    using namespace BitcoinProtocol;
    ReplayWindow w;
    const int64_t now = 1800000000;
    assert(w.accept("client-a", "id", now) == ReplayWindow::Fresh);
    assert(w.accept("client-a", "id", now) == ReplayWindow::Duplicate);
    assert(w.accept("client-b", "id", now) == ReplayWindow::Fresh);
    for (int i = 0; i < 62; i++)
        assert(w.accept("client-a", std::to_string(i), now) == ReplayWindow::Fresh);
    assert(w.accept("client-a", "overflow", now) == ReplayWindow::Full);
    assert(w.accept("client-a", "id", now) == ReplayWindow::Duplicate);
    assert(w.accept("client-a", "overflow", now + 181) == ReplayWindow::Fresh);
    assert(fresh(now, now + 150, now));
    assert(!fresh(now, now, now));
    assert(!fresh(now, now + 181, now));
    assert(!fresh(now + 31, now + 100, now));
    assert(!fresh(now - 181, now + 100, now));
    assert(signingSession("session-1", "session-1"));
    assert(!signingSession("session-1", "session-2"));
    assert(!signingSession("", ""));
    std::cout << "Replay, capacity, expiry, clock skew and restart checks passed\n";
}
