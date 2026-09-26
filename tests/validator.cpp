#include "../src/signing.h"
#include <fstream>
#include <iostream>
#include <iterator>
using namespace BitcoinPolicy;
int main(int argc, char **argv) {
    if (argc == 2 && std::string(argv[1]) == "--recovery") {
        uint8_t entropy[32] = {0};
        for (size_t length : {size_t(16), size_t(32)}) {
            std::string phrase = mnemonicFromEntropy(entropy, length);
            require(checkMnemonic(phrase), "Recovery phrase checksum failed");
            HDPrivateKey root(phrase, std::string(""), &Testnet);
            auto account = BitcoinSigning::accountKey(root);
            char xpub[120];
            account.xpub(xpub, sizeof(xpub));
            std::cout << root.fingerprint() << " " << xpub << "\n";
        }
        require(!checkMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon "
                               "abandon abandon abandon abandon"),
                "Bad checksum accepted");
        return 0;
    }
    if (argc != 3)
        return 2;
    try {
        uint8_t seed[32];
        for (int i = 0; i < 32; i++)
            seed[i] = i;
        HDPrivateKey root;
        root.fromSeed(seed, 32, &Testnet);
        auto account = BitcoinSigning::accountKey(root);
        Bytes fp(4);
        root.fingerprint(fp.data());
        std::ifstream file(argv[1], std::ios::binary);
        Bytes raw((std::istreambuf_iterator<char>(file)), {});
        auto review = validate(
            raw, fp, [&](uint32_t b, uint32_t i) { return BitcoinSigning::derive(account, b, i); },
            BitcoinSigning::hash256);
        auto signedPsbt = BitcoinSigning::sign(review, account);
        std::ofstream out(argv[2], std::ios::binary);
        out.write((const char *)signedPsbt.data(), signedPsbt.size());
        std::cout << review.fee << " ";
        for (auto &output : review.tx.outputs)
            std::cout << (output.change ? 'C' : 'R');
        std::cout << "\n";
        return 0;
    } catch (const std::exception &ex) {
        std::cerr << ex.what() << "\n";
        return 1;
    }
}
