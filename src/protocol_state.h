#pragma once
#include <cstdint>
#include <deque>
#include <string>
namespace BitcoinProtocol {
// A bounded replay window never evicts an unexpired request to make room.
class ReplayWindow {
    struct Entry {
        std::string key;
        int64_t until;
    };
    std::deque<Entry> entries;

  public:
    enum Result { Fresh, Duplicate, Full };
    Result accept(const std::string &peer, const std::string &id, int64_t now) {
        while (!entries.empty() && entries.front().until <= now)
            entries.pop_front();
        auto key = peer + ":" + id;
        for (auto &e : entries)
            if (e.key == key)
                return Duplicate;
        if (entries.size() >= 64)
            return Full;
        entries.push_back({key, now + 180});
        return Fresh;
    }
    void clear() {
        entries.clear();
    }
};
inline bool fresh(int64_t created, int64_t expires, int64_t now) {
    return now >= 1700000000 && created <= now + 30 && created >= now - 180 && expires > now &&
           expires <= now + 180;
}
inline bool signingSession(const std::string &requested, const std::string &current) {
    return !current.empty() && requested == current;
}
inline bool pinRequest(bool awaitingPin, const std::string &peer, const std::string &owner,
                       const std::string &id, const std::string &pendingId, const std::string &hash,
                       const std::string &pendingHash, const std::string &requestedSession,
                       const std::string &session, int64_t now, int64_t expiry) {
    return awaitingPin && !pendingId.empty() && peer == owner && id == pendingId &&
           hash == pendingHash && signingSession(requestedSession, session) && now < expiry;
}
inline bool retryWifi(bool portalActive, bool configured, bool connected, uint32_t now,
                      uint32_t lastAttempt) {
    return !portalActive && configured && !connected && uint32_t(now - lastAttempt) >= 15000;
}
} // namespace BitcoinProtocol
