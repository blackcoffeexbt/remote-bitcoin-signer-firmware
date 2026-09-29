#include "../src/cst816_packet.h"
#include <cassert>
#include <cstring>

int main() {
    uint8_t p[13] = {};
    uint16_t x = 42, y = 43;
    auto point = [&](unsigned rawX, unsigned rawY, unsigned event = 2) {
        p[2] = 1;
        p[3] = (event << 6) | (rawX >> 8);
        p[4] = rawX;
        p[5] = rawY >> 8;
        p[6] = rawY;
        return CST816Packet::portraitPoint(p, sizeof(p), x, y);
    };
    assert(point(0, 0, 0) && x == 239 && y == 0);
    assert(point(535, 239) && x == 0 && y == 535);
    assert(point(268, 120) && x == 119 && y == 268);
    assert(!point(600, 120)); // Capacitive home key must never hit an approval control.
    assert(!point(120, 600)); // Reject alternative firmware's home-key coordinates too.
    assert(!point(536, 0));
    assert(!point(0, 240));
    assert(!point(20, 30, 1)); // Lift is not another press at stale coordinates.
    assert(!point(20, 30, 3));
    assert(point(10, 20));
    const auto lastX = x, lastY = y;
    p[2] = 0;
    assert(!CST816Packet::portraitPoint(p, sizeof(p), x, y));
    p[2] = 2;
    assert(!CST816Packet::portraitPoint(p, sizeof(p), x, y));
    p[2] = 1;
    assert(!CST816Packet::portraitPoint(p, 6, x, y));
    memset(p, 0xff, sizeof(p)); // CST816T may return all FF with autosleep disabled.
    assert(!CST816Packet::portraitPoint(p, sizeof(p), x, y));
    assert(x == lastX && y == lastY);

    CST816Contact contact;
    memset(p, 0, sizeof(p));
    assert(point(268, 120, 0));
    assert(contact.update(p, sizeof(p), 100));
    assert(contact.x() == 119 && contact.y() == 268);
    assert(contact.update(nullptr, 0, 120)); // No instant release on a missed read.
    assert(!contact.update(nullptr, 0, 250)); // Failed controller cannot hold forever.
    assert(point(20, 30, 0));
    assert(contact.update(p, sizeof(p), 300));
    p[2] = 0;
    p[3] = 0x40;
    p[4] = p[5] = p[6] = 0;
    assert(contact.update(p, sizeof(p), 310));
    assert(contact.x() == 209 && contact.y() == 20); // Lift keeps the real position.
    assert(!contact.update(p, sizeof(p), 331));
    assert(point(20, 30));
    assert(!contact.update(p, sizeof(p), 340)); // Ignore a stale tail after lift.
    assert(contact.update(p, sizeof(p), 420)); // Accept a fresh held contact.
    assert(!point(600, 120));
    assert(contact.update(p, sizeof(p), 430));
    assert(!contact.update(p, sizeof(p), 501));
    assert(contact.x() == 209 && contact.y() == 20);
}
