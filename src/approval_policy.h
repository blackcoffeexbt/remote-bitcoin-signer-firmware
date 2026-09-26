#pragma once
#include <cstdint>
#include <stdexcept>
#include <string>

namespace ApprovalPolicy {
constexpr uint64_t maxSats = 2100000000000000ULL;
inline uint64_t sats(const std::string &text) {
    if (text.empty())
        throw std::runtime_error("Enter a whole number of sats (0 disables auto approval)");
    uint64_t value = 0;
    for (char c : text) {
        if (c < '0' || c > '9' || value > (maxSats - unsigned(c - '0')) / 10)
            throw std::runtime_error("Invalid amount in sats");
        value = value * 10 + unsigned(c - '0');
    }
    return value;
}
template <typename Outputs> uint64_t debit(uint64_t fee, const Outputs &outputs) {
    if (fee > maxSats)
        throw std::runtime_error("Amount overflow");
    uint64_t amount = fee;
    for (const auto &output : outputs) {
        if (output.change)
            continue;
        if (output.amount > maxSats - amount)
            throw std::runtime_error("Amount overflow");
        amount += output.amount;
    }
    return amount;
}
struct State {
    uint64_t under = 0, daily = 0, spent = 0;
    int64_t day = 0;
    bool valid = true;

    bool clockValid(int64_t now) const {
        return now >= 1700000000 && now / 86400 >= day;
    }
    uint64_t used(int64_t now) const {
        return clockValid(now) && now / 86400 > day ? 0 : spent;
    }
    bool allows(uint64_t amount, int64_t now) const {
        const auto total = used(now);
        return valid && clockValid(now) && under > 0 && daily > 0 && amount < under &&
               total <= daily && amount <= daily - total;
    }
    State reserve(uint64_t amount, int64_t now) const {
        if (!valid || !clockValid(now) || amount > maxSats || spent > maxSats)
            throw std::runtime_error("Cannot record daily allowance; check device time/settings");
        State next = *this;
        next.day = now / 86400;
        const auto total = used(now);
        next.spent = amount > maxSats - total ? maxSats : total + amount;
        return next; // Caller must persist successfully BEFORE signing, including manual approvals.
    }
};
template <typename Save>
void commitReservation(State &state, uint64_t amount, int64_t now, Save save) {
    const auto next = state.reserve(amount, now);
    save(next); // Exceptions stop the caller before it can produce a signature.
    state = next;
}
} // namespace ApprovalPolicy
