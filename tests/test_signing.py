"""Independent libwally checks of the firmware's actual C++ validation and signatures.
Run after scripts/test-native.py; BITCOIN_NETWORK=testnet4 selects the Testnet4 runner.
"""

import base64
import copy
import json
import os
from pathlib import Path
import subprocess
import unittest
import wallycore as w

ROOT = Path(__file__).resolve().parents[1]
NETWORK = os.environ.get("BITCOIN_NETWORK", "mainnet")
TESTNET = NETWORK == "testnet4"
VECTORS = json.loads(
    (ROOT.parent / "lnbits/tests/unit/onchain/bitcoin_vectors.json").read_text()
)
VECTOR = next(
    v for v in VECTORS["signing"] if v["kind"] == "wpkh" and v["network"] == ("test" if TESTNET else "main")
)
WORK = ROOT / "tests/generated"
WORK.mkdir(exist_ok=True)
RUNNER = WORK / "native" / NETWORK / "validator"


def read_compact(data, pos):
    n = data[pos]
    pos += 1
    if n < 253:
        return n, pos
    size = {253: 2, 254: 4, 255: 8}[n]
    return int.from_bytes(data[pos : pos + size], "little"), pos + size


def compact(n):
    return bytes([n]) if n < 253 else b"\xfd" + n.to_bytes(2, "little")


def maps(data):
    result = []
    pos = 5
    while pos < len(data):
        entries = {}
        while True:
            n, pos = read_compact(data, pos)
            if not n:
                break
            key = data[pos : pos + n]
            pos += n
            n, pos = read_compact(data, pos)
            entries[key] = data[pos : pos + n]
            pos += n
        result.append(entries)
    return result


def serialize(parts):
    return b"psbt\xff" + b"".join(
        b"".join(compact(len(k)) + k + compact(len(v)) + v for k, v in m.items())
        + b"\0"
        for m in parts
    )


def fixture():
    psbt = w.psbt_from_base64(VECTOR["unsigned"], 0)
    previous = w.tx_from_hex(
        VECTOR["data"]["inputs"][0]["tx_hex"], w.WALLY_TX_FLAG_USE_WITNESS
    )
    w.psbt_set_input_utxo(psbt, 0, previous)
    return bytes(w.psbt_to_bytes(psbt, 0))


class FirmwareSigningTests(unittest.TestCase):
    def run_firmware(self, raw, error=None):
        inp = WORK / "input.psbt"
        out = WORK / "signed.psbt"
        inp.write_bytes(raw)
        result = subprocess.run(
            [str(RUNNER), str(inp), str(out)],
            capture_output=True,
            text=True,
            env={**os.environ, "ASAN_OPTIONS": "detect_leaks=0"},
        )
        if error:
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn(error, result.stderr)
        else:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("runtime error:", result.stderr)
            return out.read_bytes(), result.stdout

    def test_recovery_matches_libwally(self):
        result = subprocess.run(
            [str(RUNNER), "--recovery"], check=True, capture_output=True, text=True
        )
        expected = []
        for length in (16, 32):
            phrase = w.bip39_mnemonic_from_bytes(None, bytes(length))
            seed = w.bip39_mnemonic_to_seed512(phrase, "")
            root = w.bip32_key_from_seed(
                seed, (w.BIP32_VER_TEST_PRIVATE if TESTNET else w.BIP32_VER_MAIN_PRIVATE), w.BIP32_FLAG_KEY_PRIVATE
            )
            child = w.bip32_key_from_parent_path(
                root, [0x80000054, 0x80000001 if TESTNET else 0x80000000, 0x80000000], w.BIP32_FLAG_KEY_PRIVATE
            )
            expected.append(
                bytes(w.bip32_key_get_fingerprint(root)).hex()
                + " "
                + w.bip32_key_to_base58(child, w.BIP32_FLAG_KEY_PUBLIC)
            )
        self.assertEqual(result.stdout.strip().splitlines(), expected)
        self.assertNotIn("runtime error:", result.stderr)

    def test_signed_transaction_matches_independent_vector(self):
        signed, review = self.run_firmware(fixture())
        self.assertEqual(review.strip(), "1000 RC")
        psbt = w.psbt_from_bytes(signed, 0)
        self.assertEqual(w.psbt_get_input_signatures_size(psbt, 0), 1)
        # Verify independently: uBitcoin and libwally can choose different valid
        # RFC6979 signatures because libwally grinds R to a shorter encoding.
        signature = bytes(w.psbt_get_input_signature(psbt, 0, 0))
        pubkey = next(k[1:] for k in maps(signed)[1] if k[0] == 2)
        tx = w.psbt_get_global_tx(psbt)
        previous = w.psbt_get_input_utxo(psbt, 0)
        amount = w.tx_get_output_satoshi(previous, w.tx_get_input_index(tx, 0))
        script = b"\x76\xa9\x14" + bytes(w.hash160(pubkey)) + b"\x88\xac"
        digest = w.tx_get_btc_signature_hash(tx, 0, script, amount, w.WALLY_SIGHASH_ALL, w.WALLY_TX_FLAG_USE_WITNESS)
        self.assertEqual(signature[-1], w.WALLY_SIGHASH_ALL)
        w.ec_sig_verify(pubkey, digest, w.EC_FLAG_ECDSA, w.ec_sig_from_der(signature[:-1]))
        expected = w.psbt_from_base64(VECTOR["signed"], 0)
        self.assertEqual(w.tx_to_hex(tx, 0), w.tx_to_hex(w.psbt_get_global_tx(expected), 0))
        # Normalize only the signature to compare the entire final wire transaction.
        parts = maps(signed)
        parts[1][b"\x02" + pubkey] = bytes(w.psbt_get_input_signature(expected, 0, 0))
        normalized = w.psbt_from_bytes(serialize(parts), 0)
        w.psbt_finalize(normalized, 0)
        self.assertEqual(w.tx_to_hex(w.psbt_extract(normalized, 0), w.WALLY_TX_FLAG_USE_WITNESS), VECTOR["tx_hex"])

    def test_tampering(self):
        original = maps(fixture())
        pathkey = next(k for k in original[1] if k[0] == 6)
        cases = []

        def case(name, mutate, error):
            parts = copy.deepcopy(original)
            mutate(parts)
            cases.append((name, serialize(parts), error))

        case("missing previous", lambda p: p[1].pop(b"\0"), "Missing PSBT field")
        case(
            "false amount",
            lambda p: p[1].__setitem__(b"\1", b"\0" * 8 + p[1][b"\1"][8:]),
            "False witness amount",
        )
        case(
            "non ALL sighash",
            lambda p: p[1].__setitem__(b"\3", b"\x82\0\0\0"),
            "Only SIGHASH_ALL",
        )
        case(
            "wrong account",
            lambda p: p[1].__setitem__(
                pathkey, p[1][pathkey][:8] + (0x80000000 if TESTNET else 0x80000001).to_bytes(4, "little") + p[1][pathkey][12:]
            ),
            "Wrong account path",
        )
        case(
            "wrong fingerprint",
            lambda p: p[1].__setitem__(pathkey, b"\0" * 4 + p[1][pathkey][4:]),
            "Wrong wallet fingerprint",
        )
        case(
            "hardened child",
            lambda p: p[1].__setitem__(pathkey, p[1][pathkey][:20] + b"\0\0\0\x80"),
            "Invalid child path",
        )
        case(
            "wrong public key",
            lambda p: p[1].__setitem__(
                pathkey[:-1] + bytes([pathkey[-1] ^ 1]), p[1].pop(pathkey)
            ),
            "Public key mismatch",
        )
        case(
            "v2", lambda p: p[0].__setitem__(b"\xfb", b"\2\0\0\0"), "Unsupported global"
        )
        case(
            "already signed",
            lambda p: p[1].__setitem__(b"\2" + pathkey[1:], b"\0"),
            "Unsupported input field",
        )
        case(
            "previous hash",
            lambda p: p[1].__setitem__(
                b"\0", bytes([p[1][b"\0"][0] ^ 1]) + p[1][b"\0"][1:]
            ),
            "Previous transaction hash",
        )
        change_key = next(k for k in original[-1] if k[0] == 2)
        case(
            "false change",
            lambda p: p[2].__setitem__(change_key, p[-1][change_key]),
            "False wallet output",
        )
        for name, raw, error in cases:
            with self.subTest(name=name):
                self.run_firmware(raw, error)

    def test_truncation_oversize_and_duplicates(self):
        raw = fixture()
        self.run_firmware(raw + b"\0", "Trailing data")
        self.run_firmware(raw + b"\0" * 32768, "exceeds 32 KiB")
        parts = maps(raw)
        globalmap = serialize([parts[0]])[5:-1]
        self.run_firmware(
            b"psbt\xff"
            + globalmap
            + globalmap
            + serialize(parts)[5 + len(globalmap) :],
            "Duplicate PSBT key",
        )
        for n in [0, 4, 6, 10, 50, len(raw) - 1]:
            inp = WORK / "input.psbt"
            inp.write_bytes(raw[:n])
            result = subprocess.run(
                [str(RUNNER), str(inp), str(WORK / "signed.psbt")],
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertNotIn("AddressSanitizer", result.stderr)


if __name__ == "__main__":
    unittest.main()
