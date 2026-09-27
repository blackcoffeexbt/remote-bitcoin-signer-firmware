#include "../src/signing.h"
#include "../src/dice_entropy.h"
#include <fstream>
#include <iostream>
#include <iterator>
using namespace BitcoinPolicy;
int main(int argc, char **argv) {
    if (argc == 2 && std::string(argv[1]) == "--dice") {
        // Public fixture, independently computed with Python hashlib and libwally.
        std::string rolls;
        for (int i = 0; i < 8; ++i)
            rolls += "123456";
        rolls += "12";
        uint8_t entropy[16], again[16];
        require(DiceEntropy::derive(entropy, rolls.data(), rolls.size()), "50 rolls rejected");
        require(toHex(entropy, 16) == "ee72ae915a4e6ea7ccbeb8e5e5eecef2", "Dice vector mismatch");
        require(std::string(mnemonicFromEntropy(entropy, 16)) ==
                    "unveil nice picture region tragic fault cream strike tourist control recipe tourist",
                "Dice mnemonic mismatch");
        memset(again, 0xff, sizeof(again));
        require(DiceEntropy::derive(again, rolls.data(), rolls.size()) &&
                    !memcmp(entropy, again, 16), "Dice output depends on previous buffer");
        std::swap(rolls[0], rolls[1]);
        require(DiceEntropy::derive(again, rolls.data(), rolls.size()) &&
                    memcmp(entropy, again, 16), "Roll order ignored");
        for (size_t size : {size_t(0), size_t(1), size_t(49), size_t(257)}) {
            std::string invalid(size, '1');
            memcpy(again, entropy, 16);
            require(!DiceEntropy::derive(again, invalid.data(), size) &&
                        !memcmp(entropy, again, 16), "Invalid length accepted or output changed");
        }
        require(!DiceEntropy::valid(nullptr, 50), "Null rolls accepted");
        for (char invalid : {'0', '7', ' ', '\n', '\0'}) {
            rolls[25] = invalid;
            require(!DiceEntropy::derive(again, rolls.data(), rolls.size()), "Invalid face accepted");
        }
        DiceEntropy::Rolls input;
        input.undo();
        require(!input.add('0') && !input.add('7') && !input.size(), "Invalid tap accepted");
        for (size_t i = 0; i < DiceEntropy::maximum; ++i)
            require(input.add('6'), "Roll capacity too small");
        require(!input.add('1') && DiceEntropy::valid(input.data(), input.size()), "Roll bound failed");
        require(DiceEntropy::derive(again, input.data(), input.size()), "256 rolls rejected");
        input.undo();
        require(input.size() == 255 && input.data()[255] == 0, "Undo did not erase roll");
        input.clear();
        require(input.size() == 0, "Clear did not reset count");
        for (size_t i = 0; i <= DiceEntropy::maximum; ++i)
            require(input.data()[i] == 0, "Clear did not erase rolls");
        require(input.add('2') && input.size() == 1 && input.data()[0] == '2', "Fresh entry failed");
        std::cout << "Dice entropy tests passed\n";
        return 0;
    }
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
