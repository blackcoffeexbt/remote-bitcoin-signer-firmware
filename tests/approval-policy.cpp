#include "../src/approval_policy.h"
#include <cassert>
#include <iostream>
#include <vector>
using namespace ApprovalPolicy;
int main() {
    const int64_t day = 20000, now = day * 86400 + 400;
    State p{10000, 25000, 0, day, true};
    assert(p.allows(9999, now));
    assert(!p.allows(10000, now)); // Strictly under the per-transaction amount.
    p = p.reserve(9000, now);
    assert(p.spent == 9000);
    auto reboot = p; // Persisted day/spending loaded after restart.
    assert(reboot.spent == 9000 && reboot.allows(9000, now));
    p = p.reserve(9000, now);
    assert(p.allows(7000, now)); // Daily allowance may be used exactly.
    assert(!p.allows(7001, now));
    p = p.reserve(12000, now); // Manual approvals count too.
    assert(p.spent == 30000 && !p.allows(1, now));
    p.under = 15000; // Changing the limit must not refund usage.
    assert(!p.allows(1, now));
    assert(p.allows(9999, (day + 1) * 86400));
    assert(p.reserve(42, (day + 1) * 86400).spent == 42);
    assert(!p.allows(1, (day - 1) * 86400));
    assert(!p.allows(1, 0));
    p.valid = false;
    assert(!p.allows(1, now));
    p = State{};
    assert(!p.allows(1, now));
    p.under = 10000;
    assert(!p.allows(1, now));
    p.daily = 10000;
    p.under = 0;
    assert(!p.allows(1, now));
    p = State{maxSats, maxSats, maxSats - 1, day, true};
    p = p.reserve(100, now);
    assert(p.spent == maxSats && !p.allows(1, now));
    struct Output {
        uint64_t amount;
        bool change;
    };
    assert(debit(100, std::vector<Output>{{1000, false}, {5000, true}, {2000, false}}) == 3100);
    bool overflow = false;
    try {
        debit(1, std::vector<Output>{{maxSats, false}});
    } catch (...) {
        overflow = true;
    }
    assert(overflow);
    State ledger{1000, 2000, 100, day, true}, persisted;
    bool signedTransaction = false;
    try {
        commitReservation(ledger, 200, now,
                          [](const State &) { throw std::runtime_error("Storage failed"); });
        signedTransaction = true;
    } catch (...) {
    }
    assert(!signedTransaction && ledger.spent == 100);
    commitReservation(ledger, 200, now, [&](const State &next) { persisted = next; });
    assert(ledger.spent == 300 && persisted.spent == 300);
    // After a crash following the save, reload the reservation without a refund.
    ledger = persisted;
    assert(ledger.spent == 300);
    assert(sats("0") == 0 && sats("000123") == 123);
    assert(sats("2100000000000000") == maxSats);
    for (const auto &value : {"", "-1", "1.5", "1e3", " 1", "1 ", "2100000000000001",
                              "999999999999999999999999999999999"}) {
        bool rejected = false;
        try {
            sats(value);
        } catch (...) {
            rejected = true;
        }
        assert(rejected);
    }
    std::cout << "PASS: approval boundaries, daily reservations, reboot, UTC rollover, rollback, "
                 "disabled and malformed limits\n";
}
