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
    assert(pinRequest(true, "peer", "peer", "id", "id", "hash", "hash", "s", "s", now, now + 1));
    assert(!pinRequest(false, "peer", "peer", "id", "id", "hash", "hash", "s", "s", now, now + 1));
    assert(!pinRequest(true, "other", "peer", "id", "id", "hash", "hash", "s", "s", now, now + 1));
    assert(!pinRequest(true, "peer", "peer", "old", "id", "hash", "hash", "s", "s", now, now + 1));
    assert(!pinRequest(true, "peer", "peer", "id", "id", "other", "hash", "s", "s", now, now + 1));
    assert(!pinRequest(true, "peer", "peer", "id", "id", "hash", "hash", "old", "s", now, now + 1));
    assert(!pinRequest(true, "peer", "peer", "id", "id", "hash", "hash", "s", "s", now, now));
    assert(retryWifi(false, true, false, 15000, 0));
    assert(!retryWifi(false, true, false, 14999, 0));
    assert(!retryWifi(true, true, false, 15000, 0));
    assert(!retryWifi(false, false, false, 15000, 0));
    assert(!retryWifi(false, true, true, 15000, 0));
    assert(retryWifi(false, true, false, 10000, UINT32_MAX - 5000));
    std::cout << "Replay, capacity, expiry, clock skew and restart checks passed\n";
}
