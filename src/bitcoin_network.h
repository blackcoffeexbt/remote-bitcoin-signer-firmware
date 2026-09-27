#pragma once
#include <stdint.h>

// Build-time only. No NVS setting or remote/device command can change this.
#ifndef BITCOIN_TESTNET4
#define BITCOIN_TESTNET4 0
#endif
#if BITCOIN_TESTNET4 != 0 && BITCOIN_TESTNET4 != 1
#error "BITCOIN_TESTNET4 must be 0 (Mainnet) or 1 (Testnet4)"
#endif
namespace BitcoinNetwork {
#if BITCOIN_TESTNET4
constexpr const char *name = "Testnet4";
constexpr const char *banner = "ARGUS  /  TESTNET4";
constexpr const char *path = "m/84'/1'/0'";
constexpr const char *derivePath = "m/84h/1h/0h";
constexpr const char *origin = "/84h/1h/0h]";
constexpr uint32_t coinType = 0x80000001;
#else
constexpr const char *name = "Mainnet";
constexpr const char *banner = "ARGUS  /  MAINNET";
constexpr const char *path = "m/84'/0'/0'";
constexpr const char *derivePath = "m/84h/0h/0h";
constexpr const char *origin = "/84h/0h/0h]";
constexpr uint32_t coinType = 0x80000000;
#endif
}
