# Remote Bitcoin signer — Guition JC3248W535

A dedicated ESP32-S3 / PlatformIO **Testnet4** signer. LNbits builds a PSBT, the device validates it and asks for touchscreen approval, and an encrypted signed PSBT comes back over Nostr. Broadcasting remains a separate action in LNbits.

## Build and install

```sh
pio run -e esp32-s3-n16r8v
pio run -e esp32-s3-n16r8v -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -b 115200
```

The upload helper reads the installed partition table, identifies the active OTA application, backs it up under `.pio/backups/`, and writes **only that application partition**. It refuses unsupported layouts. It does not erase NVS, rewrite the partition table, or change OTA selection. The firmware uses its own `btc-signer` settings namespace; the reference Nostr signer's settings remain separate.

For an erased board, install the bootloader, partition table and firmware together:

```sh
sh scripts/flash-erased.sh /dev/cu.usbmodem1101
```

This builds the latest normal firmware and refuses to proceed unless the partition table is blank. It does not erase the device. Use the regular app-only upload command above for subsequent updates.

The reference project is unchanged. Its ArduinoGFX/AXS15231B display and touch implementation, LVGL configuration, and Nostr transport libraries are reused here. Dependencies are pinned; public TLS trust roots are included in `data/cert/`.

## First use

1. On the device, generate a recovery phrase, write it down, and verify all 12 words in order by tapping each word from four choices. Correct answers advance immediately; incorrect answers show “Incorrect word”. Alternatively restore a 12- or 24-word phrase. Set a 6–32 digit PIN. The recovery phrase stays on the device. During signing, the paired browser sends the PIN directly to the device inside a signed, NIP-44 encrypted Nostr message; the LNbits server does not receive it.
2. On the touchscreen choose **Network settings**. Join the temporary **Bitcoin-Signer-…** Wi-Fi network using the displayed password or QR code, then open **http://192.168.4.1/** on your phone or computer. Choose **Scan for Wi-Fi** and select your network, or enter its name manually. Enter the Wi-Fi password (use **Show password** to check it) and one to three `wss://` relay URLs. The default relay is `wss://relay.nostrconnect.com`. Choose **Save and connect**. The setup access point closes after submission, on **Close setup Wi-Fi**, or after ten minutes. Existing wallets must be unlocked to open setup. Relays must accept experimental ephemeral event kind **24134**, allow browser connections, and support the configured message sizes. Connections validate TLS certificates. Wait for network time synchronization.
3. Start the included LNbits checkout on port 5001, with its onchain wallet and block explorer configured for Testnet4. Select or create a Testnet4 onchain wallet.
4. Choose **Nostr signer**. On the device choose **Pair a browser**, scan its QR code into LNbits (or enter its JSON pairing code), and choose **Pair**. Compare the browser public key and approve locally.
5. After pairing approval, LNbits automatically imports the public wallet and shows confirmation. It receives only the account descriptor, fingerprint and public key. If import fails, the pairing is retained and **Retry public wallet import** is available. Reconnecting recognizes an already imported account.
6. Receive test coins using the existing onchain wallet. Construct a payment and choose **Sign with device**. LNbits connects automatically and retrieves the current device session. Wait for **PIN required**, enter the device PIN in LNbits, and follow the progress messages. Review the client, every full recipient address, amount, change and fee on the device; approve or reject.
7. LNbits verifies that the signed PSBT matches its original transaction and verifies the signatures. Review the finalized transaction and choose **Broadcast** explicitly.

Keep the wallet page open while waiting for approval. Browser pairing is remembered per LNbits user and wallet; Signing automatically retrieves a fresh device session, including after a restart. **Reconnect** remains available for checking the connection. Up to eight browsers can be paired. Revoke a browser using **Paired browsers** on the device. Forgetting the browser's local pairing does not revoke its identity on the device.

PIN derivation takes roughly 20 seconds on this board; wait for the working screen to finish when saving or unlocking. The first touch on a dark display only wakes it. The device boots with the Bitcoin wallet locked while Wi-Fi and relay connections start automatically. Wi-Fi outages are retried every 15 seconds; relay connections and subscriptions are restored automatically. Each signing request requires the PIN again. Bitcoin keys are cleared before the signed result is sent, and on failure, rejection, or expiry. **Unlock settings** is available locally for pairing and network administration.

**Existing-device upgrade:** unlock locally once after installing this firmware to save the existing relay identity and public account separately. Pairings remain valid. Subsequent boots need no local unlock to receive signing requests. The relay identity is stored separately in NVS so it can operate while the Bitcoin vault remains PIN-encrypted; it cannot derive Bitcoin signing keys.

## Deliberate v1 limits

- One account: `m/84'/1'/0'`, native SegWit, receive/change branches 0 and 1; no BIP39 passphrase.
- PSBT v0, transaction version 2, final input sequences, zero locktime, `SIGHASH_ALL`, at most 32 inputs and 32 outputs, decoded PSBT at most 32 KiB.
- Every input must belong to this account. Full previous transactions are required and their hashes, output indexes, scripts and amounts are verified. Conflicting witness metadata is rejected.
- Recipient scripts: P2PKH, P2SH, P2WPKH and P2WSH. No Taproot, multisig inputs, arbitrary scripts, pre-signed inputs, or unsupported PSBT metadata.
- One approval at a time; other requests receive `busy`. Requests expire after 150 seconds in the browser. Firmware accepts at most 180 seconds. Duplicate deliveries cannot cause another signature.
- The signer validates supplied transaction data; it does not run a Bitcoin node or independently establish whether inputs are still unspent. LNbits provides chain data and broadcasting.
- PIN-encrypted storage uses PBKDF2-HMAC-SHA256 (210,000 rounds, random 16-byte salt) and AES-256-GCM (random 12-byte nonce). This is prototype protection, not secure-element or physical-extraction resistance. Secure boot/flash encryption are not provisioned.

## Tests

```sh
python3 scripts/test-native.py
lnbits/.venv/bin/python tests/test_signing.py
clang++ -std=c++17 -fsanitize=address,undefined tests/protocol.cpp -o /tmp/bitcoin-protocol-tests
/tmp/bitcoin-protocol-tests
node --test tests/nostr-client.test.mjs tests/nostr-pairing-import.test.mjs
```

The native validator and signer are the production C++ code, compiled with address/undefined-behavior sanitizers. Tests compare its signature and final transaction against independent libwally vectors and reject malformed or dishonest PSBTs. Browser tests use real Nostr signatures and NIP-44 encryption with simulated relay sockets. If Node dependencies live elsewhere, set `LNBITS_PACKAGE` to that checkout's absolute `package.json` path.

The focused LNbits tests live in `lnbits/tests/unit/onchain/test_psbt.py`. Normal LNbits checks and dependencies apply.

For hardware-only recovery/encryption checks:

```sh
pio run -e selftest -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -b 115200
```

Expect `BITCOIN SELFTEST PASS: recovery, vault, wrong PIN, tamper, NIP44`. These checks use disposable public test vectors and RAM only, with no writes to the wallet vault. Install the normal firmware afterwards. A successful build alone does not verify the hardware tests or a live Testnet4 payment.

See [protocol.md](docs/protocol.md) for client interoperability and [verification.md](docs/verification.md) for the current validation record.
