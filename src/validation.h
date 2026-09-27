#pragma once
#include "bitcoin_network.h"
// Strict, platform-independent PSBT v0 boundary. No Bitcoin secrets live here.
#include <algorithm>
#include <array>
#include <functional>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
namespace BitcoinPolicy {
using Bytes = std::vector<uint8_t>;
constexpr size_t MAX_PSBT = 32768;
constexpr uint64_t MAX_MONEY = 21000000ULL * 100000000;
inline void require(bool ok, const char *message) {
    if (!ok)
        throw std::runtime_error(message);
}
struct Reader {
    const Bytes &b;
    size_t p = 0;
    uint64_t number(size_t n) {
        require(n <= 8 && n <= b.size() - p, "Truncated number");
        uint64_t v = 0;
        for (size_t i = 0; i < n; i++)
            v |= uint64_t(b[p++]) << (8 * i);
        return v;
    }
    uint64_t compact() {
        auto n = number(1);
        if (n < 253)
            return n;
        auto v = number(n == 253 ? 2 : n == 254 ? 4 : 8);
        require(v >= (n == 253   ? 253ULL
                      : n == 254 ? 65536ULL
                                 : 4294967296ULL),
                "Noncanonical length");
        return v;
    }
    Bytes take(size_t n) {
        require(n <= b.size() - p, "Truncated data");
        Bytes v(b.begin() + p, b.begin() + p + n);
        p += n;
        return v;
    }
    Bytes variable(size_t max = MAX_PSBT) {
        auto n = compact();
        require(n <= max, "Field too large");
        return take(n);
    }
    void end() {
        require(p == b.size(), "Trailing data");
    }
};
inline void compact(Bytes &b, size_t n) {
    if (n < 253)
        b.push_back(n);
    else {
        b.push_back(253);
        b.push_back(n & 255);
        b.push_back(n >> 8);
    }
}
inline void field(Bytes &b, const Bytes &v) {
    compact(b, v.size());
    b.insert(b.end(), v.begin(), v.end());
}
using Map = std::map<Bytes, Bytes>;
inline Map readMap(Reader &r) {
    Map m;
    for (;;) {
        auto key = r.variable(128);
        if (key.empty())
            break;
        require(m.size() < 64, "Too many fields");
        auto value = r.variable();
        require(m.emplace(key, value).second, "Duplicate PSBT key");
    }
    return m;
}
inline const Bytes &get(const Map &m, uint8_t key) {
    auto it = m.find(Bytes{key});
    require(it != m.end(), "Missing PSBT field");
    return it->second;
}
struct Output {
    uint64_t amount;
    Bytes script;
    bool change = false;
};
struct Transaction {
    Bytes raw, txidPreimage;
    std::vector<Bytes> outpoints;
    std::vector<Output> outputs;
};
inline Transaction transaction(const Bytes &raw, bool unsignedTx) {
    Reader r{raw};
    Transaction tx;
    tx.raw = raw;
    tx.txidPreimage = r.take(4);
    require(!unsignedTx || tx.txidPreimage == Bytes({2, 0, 0, 0}),
            "Only transaction version 2 is supported");
    bool witness = r.p < raw.size() && raw[r.p] == 0;
    if (witness) {
        require(!unsignedTx, "Unsigned transaction contains witness");
        r.number(1);
        require(r.number(1) == 1, "Invalid witness flag");
    }
    size_t start = r.p;
    auto ni = r.compact();
    require(ni > 0 && ni <= 128, "Input count out of range");
    std::set<Bytes> seen;
    for (size_t i = 0; i < ni; i++) {
        auto op = r.take(36);
        require(seen.insert(op).second, "Duplicate input");
        tx.outpoints.push_back(op);
        auto script = r.variable();
        require(!unsignedTx || script.empty(), "Unsigned transaction has scriptSig");
        auto sequence = r.take(4);
        require(!unsignedTx || sequence == Bytes({255, 255, 255, 255}),
                "Only final input sequences are supported");
    }
    auto no = r.compact();
    require(no > 0 && no <= 128, "Output count out of range");
    uint64_t total = 0;
    for (size_t i = 0; i < no; i++) {
        auto amount = r.number(8);
        require(amount <= MAX_MONEY && total <= MAX_MONEY - amount, "Invalid output amount");
        total += amount;
        tx.outputs.push_back({amount, r.variable(10000), false});
    }
    tx.txidPreimage.insert(tx.txidPreimage.end(), raw.begin() + start, raw.begin() + r.p);
    if (witness) {
        bool any = false;
        for (size_t i = 0; i < ni; i++) {
            auto n = r.compact();
            require(n <= 128, "Witness count out of range");
            any |= n > 0;
            for (size_t j = 0; j < n; j++)
                r.variable();
        }
        require(any, "Empty witness serialization");
    }
    auto lock = r.take(4);
    require(!unsignedTx || lock == Bytes({0, 0, 0, 0}), "Timelocked transactions are unsupported");
    tx.txidPreimage.insert(tx.txidPreimage.end(), lock.begin(), lock.end());
    r.end();
    return tx;
}
struct Derived {
    Bytes pubkey, script;
};
using Derive = std::function<Derived(uint32_t, uint32_t)>;
using Hash = std::function<Bytes(const Bytes &)>;
struct Review {
    Transaction tx;
    std::vector<Map> inputs, outputs;
    Map global;
    uint64_t fee = 0;
};
inline Derived derivation(const Bytes &key, const Bytes &value, const Bytes &fingerprint,
                          const Derive &derive, uint32_t &branch) {
    require(key.size() == 34 && value.size() == 24, "Unsupported derivation");
    Reader r{value};
    require(r.take(4) == fingerprint, "Wrong wallet fingerprint");
    require(r.number(4) == 0x80000054 && r.number(4) == BitcoinNetwork::coinType && r.number(4) == 0x80000000,
            "Wrong account path");
    branch = r.number(4);
    auto index = r.number(4);
    require(branch <= 1 && index < 0x80000000, "Invalid child path");
    auto d = derive(branch, index);
    require(Bytes(key.begin() + 1, key.end()) == d.pubkey, "Public key mismatch");
    return d;
}
inline Review validate(const Bytes &raw, const Bytes &fingerprint, const Derive &derive,
                       const Hash &hash256) {
    require(raw.size() <= MAX_PSBT, "PSBT exceeds 32 KiB");
    Reader r{raw};
    require(r.take(5) == Bytes({112, 115, 98, 116, 255}), "Invalid PSBT magic");
    Review review;
    review.global = readMap(r);
    for (const auto &kv : review.global)
        require(kv.first == Bytes{0} ||
                    (kv.first == Bytes{251} && kv.second == Bytes({0, 0, 0, 0})),
                "Unsupported global field");
    review.tx = transaction(get(review.global, 0), true);
    uint64_t inTotal = 0, outTotal = 0;
    require(review.tx.outpoints.size() <= 32 && review.tx.outputs.size() <= 32,
            "Maximum 32 inputs and outputs");
    for (size_t i = 0; i < review.tx.outpoints.size(); i++) {
        auto m = readMap(r);
        size_t paths = 0;
        Derived d;
        uint32_t branch = 0;
        for (const auto &kv : m) {
            auto k = kv.first[0];
            require(k == 0 || k == 1 || k == 3 || k == 6, "Unsupported input field");
            if (k != 6)
                require(kv.first.size() == 1, "Invalid input key");
            if (k == 3)
                require(kv.second == Bytes({1, 0, 0, 0}), "Only SIGHASH_ALL is supported");
            if (k == 6) {
                paths++;
                d = derivation(kv.first, kv.second, fingerprint, derive, branch);
            }
        }
        require(paths == 1, "Exactly one owned key required");
        auto prev = transaction(get(m, 0), false);
        auto op = review.tx.outpoints[i];
        require(hash256(prev.txidPreimage) == Bytes(op.begin(), op.begin() + 32),
                "Previous transaction hash mismatch");
        Reader opr{op};
        opr.take(32);
        auto n = opr.number(4);
        require(n < prev.outputs.size(), "Invalid previous output");
        auto prevout = prev.outputs[n];
        require(prevout.script == d.script, "Input is not owned by this wallet");
        if (m.count(Bytes{1})) {
            Reader wr{get(m, 1)};
            auto a = wr.number(8);
            auto s = wr.variable();
            wr.end();
            require(a == prevout.amount && s == prevout.script, "False witness amount or script");
        }
        require(inTotal <= MAX_MONEY - prevout.amount, "Input amount overflow");
        inTotal += prevout.amount;
        review.inputs.push_back(m);
    }
    for (auto &out : review.tx.outputs) {
        auto m = readMap(r);
        require(m.size() <= 1, "Unsupported output metadata");
        for (auto &kv : m) {
            require(kv.first[0] == 2, "Unsupported output field");
            uint32_t branch;
            auto d = derivation(kv.first, kv.second, fingerprint, derive, branch);
            require(out.script == d.script, "False wallet output");
            out.change = branch == 1;
        }
        require(out.script.size() == 22 && out.script[0] == 0 && out.script[1] == 20 ||
                    out.script.size() == 34 && out.script[0] == 0 && out.script[1] == 32 ||
                    out.script.size() == 25 && out.script[0] == 118 && out.script[1] == 169 &&
                        out.script[2] == 20 && out.script[23] == 136 && out.script[24] == 172 ||
                    out.script.size() == 23 && out.script[0] == 169 && out.script[1] == 20 &&
                        out.script[22] == 135,
                "Unsupported recipient script");
        outTotal += out.amount;
        review.outputs.push_back(m);
    }
    r.end();
    require(inTotal >= outTotal, "Negative fee");
    review.fee = inTotal - outTotal;
    return review;
}
inline void writeMap(Bytes &raw, const Map &m) {
    for (auto &kv : m) {
        field(raw, kv.first);
        field(raw, kv.second);
    }
    raw.push_back(0);
}
inline Bytes serialize(const Review &r) {
    Bytes raw{112, 115, 98, 116, 255};
    writeMap(raw, r.global);
    for (auto &m : r.inputs)
        writeMap(raw, m);
    for (auto &m : r.outputs)
        writeMap(raw, m);
    return raw;
}
} // namespace BitcoinPolicy
