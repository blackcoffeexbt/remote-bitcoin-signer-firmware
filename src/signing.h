#pragma once
#include "bitcoin_network.h"
#include "validation.h"
#include <Bitcoin.h>
#include <Hash.h>
namespace BitcoinSigning {
using namespace BitcoinPolicy;
inline HDPrivateKey accountKey(const HDPrivateKey &root) {
    auto account = root.derive(BitcoinNetwork::derivePath);
    // The descriptor carries the script policy; export standard BIP32 xpub/tpub.
    account.type = P2PKH;
    return account;
}
inline Bytes hash256(const Bytes &b) {
    Bytes h(32);
    sha256(b.data(), b.size(), h.data());
    sha256(h.data(), 32, h.data());
    return h;
}
inline Derived derive(const HDPrivateKey &account, uint32_t branch, uint32_t index) {
    auto key = account.child(branch).child(index);
    Bytes pub(33);
    key.publicKey().serialize(pub.data(), 33);
    Bytes sh(20);
    hash160(pub.data(), pub.size(), sh.data());
    Bytes script{0, 20};
    script.insert(script.end(), sh.begin(), sh.end());
    return {pub, script};
}
// Caller must supply the review returned by validate(), never host-provided metadata.
inline Bytes sign(Review review, const HDPrivateKey &account) {
    Tx tx;
    require(tx.parse(review.tx.raw.data(), review.tx.raw.size()) == review.tx.raw.size() &&
                bool(tx),
            "Transaction parsing failed");
    for (size_t i = 0; i < review.inputs.size(); i++) {
        auto &m = review.inputs[i];
        Bytes pub;
        uint32_t branch = 0, index = 0;
        for (auto &kv : m)
            if (kv.first[0] == 6) {
                pub = Bytes(kv.first.begin() + 1, kv.first.end());
                Reader r{kv.second};
                r.take(16);
                branch = r.number(4);
                index = r.number(4);
            }
        auto prev = transaction(get(m, 0), false);
        Reader opr{review.tx.outpoints[i]};
        opr.take(32);
        auto amount = prev.outputs[opr.number(4)].amount;
        auto key = account.child(branch).child(index);
        uint8_t h[32];
        tx.sigHashSegwit(h, i, Script(key.publicKey(), P2PKH), amount, SIGHASH_ALL);
        auto signature = key.sign(h);
        require(key.publicKey().verify(signature, h), "Signature verification failed");
        Bytes sig(signature.length());
        signature.serialize(sig.data(), sig.size());
        sig.push_back(1);
        Bytes k{2};
        k.insert(k.end(), pub.begin(), pub.end());
        m[k] = sig;
    }
    return serialize(review);
}
} // namespace BitcoinSigning
