# Argus — Guition JC3248W535

Argus uses a light cloud/white theme with teal actions and ink text. Its device-and-
signal logo appears at startup, on the home screen and in Settings. Network setup
also uses the Argus name and palette. The v1 `bitcoin-signer` wire protocol and NVS
namespaces remain unchanged for existing wallets and pairings.

A dedicated ESP32-S3 / PlatformIO **Mainnet / Testnet4** signer. The mobile wallet or LNbits builds a PSBT, the device validates it and applies your touchscreen-approval policy, and an encrypted signed PSBT comes back over Nostr. Broadcasting remains a separate, explicit action in the client.

## What this repository contains

Firmware for the **Guition JC3248W535 ESP32-S3**, configured for 16 MB flash and
8 MB PSRAM. It keeps the Bitcoin wallet on the device and connects to remote
clients using signed, NIP-44 encrypted Nostr messages.

- Create or restore a BIP39 wallet and protect it with a wallet PIN.
- Protect device settings with a separate settings PIN.
- Connect up to eight remote clients, including the mobile app and LNbits.
- Validate every transaction before manual or policy-based approval.
- Show the approval-limit reason to LNbits while waiting for device approval.
- Persist PIN failure counters and wipe device storage on the 16th failed attempt.

**Mainnet is the default; Testnet4 is available at build time.** This is experimental firmware. Automated tests and successful
builds do not establish physical-device security or end-to-end interoperability.

## Bitcoin network

Set `[bitcoin] testnet4` in [platformio.ini](platformio.ini) to `0` for Mainnet
(default) or `1` for Testnet4, then build. This controls account derivation,
xpub/tpub encoding, address display, PSBT validation and protocol messages.
There is no on-device or remote network selector. The screen banner and payment
review show the compiled network.

Choose the same network in the mobile app's **Settings → Bitcoin network**.
A mismatch blocks signing and explains which network to select. Mainnet uses
`m/84'/0'/0'`; Testnet4 uses `m/84'/1'/0'`. After changing the firmware's build
network, a local wallet unlock must refresh cached public metadata; pair again
to deliberately accept the new xpub. Existing vault, pairings and approval-policy
storage are retained. The Testnet4 walkthrough below requires a Testnet4 build.

## View your recovery phrase

Open **Settings → Keys → View recovery phrase**. Unlock Settings with the settings
PIN, then enter the separate **wallet PIN** to reveal the stored 12- or 24-word
phrase. Incorrect wallet PINs share the existing persistent attempt counter and
cooldown with signing; the existing 16-failure device-wipe policy applies.

The numbered words appear only on the device. **Hide phrase** or **Done** clears
the display buffer immediately. Leaving the screen also clears it; after 60
seconds the viewer hides the words and requests Settings closure, even while
scrolling. Viewing does not unlock signing keys or expose a remote export method.
Revealing again requires the wallet PIN again.

Physical checks still required: test a generated 12-word wallet and restored
24-word wallet, wrong PIN/cooldown, Hide/Done, Settings expiry, the 60-second
viewer timeout while scrolling, and rejected remote signing during Settings.

## Optional dice generation

Choose **Generate wallet → Advanced → Add dice rolls**. Roll a fair six-sided die
and enter each result in order using the 1–6 keypad. The counter shows progress
and the last result; **Undo** removes the last entry. **Generate with dice** stays
disabled below 50 rolls; the firmware independently enforces 50–256 rolls.
Cancel discards the rolls. Continue through the normal 12-word backup verification
and wallet PIN setup.

Dice mode uses **only the rolls**, with no device randomness, salt or timestamp.
For reproducibility, concatenate the exact digits `1`–`6` as ASCII, with **no
spaces, separators or trailing newline**; compute SHA-256, take the **first 16
bytes** of the digest, then encode these as an English BIP39 12-word mnemonic
with its normal checksum. BIP39 passphrase is empty; the Mainnet account is
`m/84'/0'/0'` and Testnet4 is `m/84'/1'/0'`. Other tools must use this exact conversion to reproduce the wallet;
“dice mode” alone does not imply compatibility. Independent Nostr identity and
PIN-encrypted vault storage still use randomness and are not reproduced.

Use fresh physical rolls, not an invented sequence. Keep the sequence secret:
it can recreate the wallet. Rolls stay on the device, are not logged or saved,
and transient input is wiped after submission, cancellation or leaving the page.
Standard generation remains available and uses device randomness.

Public test fixture (never use for a wallet): `123456` repeated eight times,
followed by `12` (50 rolls), gives entropy `ee72ae915a4e6ea7ccbeb8e5e5eecef2` and
`unveil nice picture region tragic fault cream strike tourist control recipe tourist`.

Physical UI checks still required: confirm generation is unavailable at 49 rolls,
available at 50, and disabled again after Undo; check the 256-roll cap, cancellation,
repeat-sequence recovery, and the complete backup/PIN flow on the touchscreen.

## Requirements and quick start

Install PlatformIO Core or the PlatformIO editor extension. A USB connection to
the board is needed for flashing and serial monitoring. Run commands from this
repository's root, the directory containing `platformio.ini`.

```sh
pio run -e esp32-s3-n16r8v
```

This builds `.pio/build/esp32-s3-n16r8v/firmware.bin` without flashing hardware.
Dependencies and the target board are defined in [platformio.ini](platformio.ini).
Neither the mobile nor LNbits repository is required to compile the firmware.

Use a compatible remote client to prepare transactions and broadcast them after
signing. In the combined workspace, the [mobile app guide](../mobile/README.md)
covers Android/iOS setup; LNbits lives in the separate `../lnbits/` repository.

## Install on the device

Choose your board's actual serial port in place of the example below.

```sh
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

## First use with LNbits (alternative client)

For the standalone mobile wallet, follow the [in-app wallet flow](../mobile/README.md#working-wallet-flow).

1. On first setup choose a **settings PIN** of 6–32 digits, then choose **Continue wallet setup**. This PIN controls device settings independently of wallet decryption. Generate a recovery phrase, write it down, and verify all 12 words in order by tapping each word from four choices. Correct answers advance immediately; incorrect answers show “Incorrect word”. Alternatively restore a 12- or 24-word phrase. Set a separate 6–32 digit **wallet PIN**. The recovery phrase stays on the device. During signing, the paired browser sends the PIN directly to the device inside a signed, NIP-44 encrypted Nostr message; the LNbits server does not receive it.
2. On the touchscreen open **Settings**, enter the settings PIN, then choose **Network**. Join the temporary **Argus-…** Wi-Fi network using the displayed password or QR code, then open **http://192.168.4.1/** on your phone or computer. Choose **Scan for Wi-Fi** and select your network, or enter its name manually. Enter the Wi-Fi password (use **Show password** to check it) and one to three `wss://` relay URLs. The default relay is `wss://relay.nostrconnect.com`. Choose **Save and connect**. The setup access point closes after submission, on **Close setup Wi-Fi**, or after ten minutes. Network setup requires the settings PIN; it never decrypts the wallet. Relays must accept experimental ephemeral event kind **24134**, allow browser connections, and support the configured message sizes. Connections validate TLS certificates. Wait for network time synchronization.
3. Start the separate LNbits checkout using its own setup instructions, with its onchain wallet and block explorer configured for Testnet4. Select or create a Testnet4 onchain wallet.
4. Choose **Nostr signer**. On the device open **Settings → Connect Remote Client**, scan its QR code into LNbits (or enter its JSON pairing code), and choose **Pair**. Compare the browser public key and approve locally.
5. After pairing approval, LNbits automatically imports the public wallet and shows confirmation. It receives only the account descriptor, fingerprint and public key. If import fails, the pairing is retained and **Retry public wallet import** is available. Reconnecting recognizes an already imported account.
6. Receive test coins using the existing onchain wallet. Construct a payment and choose **Sign with device**. LNbits connects automatically and retrieves the current device session. Wait for **PIN required**, enter the device PIN in LNbits, and follow the progress messages. Unless the automatic-approval limits permit it, review the client, every full recipient address, amount, change and fee on the device; approve or reject.
7. LNbits verifies that the signed PSBT matches its original transaction and verifies the signatures. Review the finalized transaction and choose **Broadcast** explicitly.

Keep the wallet page open while waiting for approval. Browser pairing is remembered per LNbits user and wallet; Signing automatically retrieves a fresh device session, including after a restart. **Reconnect** remains available for checking the connection. Up to eight browsers can be paired. Revoke a browser using **Paired browsers** on the device. Forgetting the browser's local pairing does not revoke its identity on the device.

PIN derivation takes roughly 20 seconds on this board; wait for the working screen to finish when saving or unlocking. The first touch on a dark display only wakes it. The device boots with the Bitcoin wallet locked while Wi-Fi and relay connections start automatically. Wi-Fi outages are retried every 15 seconds; relay connections and subscriptions are restored automatically. Each signing request requires the PIN again. Bitcoin keys are cleared before the signed result is sent, and on failure, rejection, or expiry. **Settings** uses its own PIN for pairing, network administration and automatic-approval limits. Close Settings to accept signing requests. Settings sessions expire after one minute without touchscreen activity while the configuration portal is inactive; closing Settings locks them immediately.

**Existing-device upgrade:** if no settings PIN exists, open Settings and enter the existing wallet PIN once to authorize setup of the separate settings PIN. This also saves the existing relay identity and public account separately. Pairings remain valid. Subsequent boots need no local unlock to receive signing requests. The relay identity is stored separately in NVS so it can operate while the Bitcoin vault remains PIN-encrypted; it cannot derive Bitcoin signing keys.

## Automatic approval

Open **Settings → Auto signing** to set **Approve transactions under (sats)** and **Total allowed per UTC day (sats)**. Both default to 0, which disables automatic approval. The transaction debit is all recipient outputs plus the fee, excluding verified change. Automatic approval requires a debit strictly below the transaction limit and a running daily total no greater than the daily allowance. Otherwise the device shows the full transaction for manual approval.

The wallet PIN is still required remotely for **every** request, including automatically approved requests. Bitcoin keys are cleared immediately after signing. LNbits shows **Automatically approved**, followed by signing progress; broadcasting remains manual.

Daily usage counts all signing reservations, including manually approved transactions, across all paired clients. It is written to NVS before signing, survives reboot and limit edits, and resets at midnight UTC using the synchronized device clock. A failed or interrupted signing attempt after reservation still consumes allowance; replacements and newly submitted retries are counted again. Duplicate deliveries of the same request do not sign or charge again. Time rollback, damaged accounting or a failed storage write cannot bypass the allowance; signing stops if usage cannot be recorded safely.

## Deliberate v1 limits

- One account: `m/84'/0'/0'` on Mainnet or `m/84'/1'/0'` on Testnet4, native SegWit, receive/change branches 0 and 1; no BIP39 passphrase.
- PSBT v0, transaction version 2, final input sequences, zero locktime, `SIGHASH_ALL`, at most 32 inputs and 32 outputs, decoded PSBT at most 32 KiB.
- Every input must belong to this account. Full previous transactions are required and their hashes, output indexes, scripts and amounts are verified. Conflicting witness metadata is rejected.
- Recipient scripts: P2PKH, P2SH, P2WPKH and P2WSH. No Taproot, multisig inputs, arbitrary scripts, pre-signed inputs, or unsupported PSBT metadata.
- One approval at a time; other requests receive `busy`. Requests expire after 150 seconds in the browser. Firmware accepts at most 180 seconds. Duplicate deliveries cannot cause another signature.
- The signer validates supplied transaction data; it does not run a Bitcoin node or independently establish whether inputs are still unspent. The mobile client uses Electrs for chain data/broadcasting; LNbits is an alternative client.
- PIN-encrypted storage uses PBKDF2-HMAC-SHA256 (210,000 rounds, random 16-byte salt) and AES-256-GCM (random 12-byte nonce). This is prototype protection, not secure-element or physical-extraction resistance. Secure boot/flash encryption are not provisioned.

## Tests

Run the firmware build first to populate PlatformIO's pinned libraries. Native
checks require Python 3 and Clang with sanitizers; browser checks require Node.js
and the sibling LNbits checkout with its dependencies installed. The Python
signing comparison uses that checkout's `wallycore` environment and test vectors.


```sh
python3 scripts/test-native.py
tests/generated/native/mainnet/validator --dice
clang++ -std=c++17 -fsanitize=address,undefined tests/recovery-view.cpp -o /tmp/recovery-view-tests
/tmp/recovery-view-tests
../lnbits/.venv/bin/python tests/test_signing.py
python3 scripts/test-native.py --network testnet4
BITCOIN_NETWORK=testnet4 ../lnbits/.venv/bin/python tests/test_signing.py
clang++ -std=c++17 -fsanitize=address,undefined tests/protocol.cpp -o /tmp/bitcoin-protocol-tests
/tmp/bitcoin-protocol-tests
clang++ -std=c++17 -fsanitize=address,undefined tests/approval-policy.cpp -o /tmp/approval-policy-tests
/tmp/approval-policy-tests
clang++ -std=c++17 -fsanitize=address,undefined tests/pin-attempts.cpp -o /tmp/pin-attempt-tests
/tmp/pin-attempt-tests
clang++ -std=c++17 -fsanitize=address,undefined tests/touch.cpp -o /tmp/signer-touch-tests
/tmp/signer-touch-tests
node --test tests/nostr-client.test.mjs tests/nostr-pairing-import.test.mjs tests/network-portal.test.mjs
```

The native validator and signer are the production C++ code, compiled with address/undefined-behavior sanitizers. Tests compare its signature and final transaction against independent libwally vectors and reject malformed or dishonest PSBTs. Browser tests use real Nostr signatures and NIP-44 encryption with simulated relay sockets. If Node dependencies live elsewhere, set `LNBITS_PACKAGE` to that checkout's absolute `package.json` path.

The focused LNbits tests live in `../lnbits/tests/unit/onchain/test_psbt.py`. Normal LNbits checks and dependencies apply.

For hardware-only recovery/encryption checks:

```sh
pio run -e selftest -t upload --upload-port /dev/cu.usbmodem1101
pio device monitor -b 115200
```

Expect `BITCOIN SELFTEST PASS: recovery, vault, wrong PIN, tamper, NIP44`. These checks use disposable public test vectors and RAM only, with no writes to the wallet vault. Install the normal firmware afterwards. A successful build alone does not verify the hardware tests or a live Testnet4 payment.

See [protocol.md](docs/protocol.md) for client interoperability and [verification.md](docs/verification.md) for the current validation record.

### PIN retry and approval-status device checks

PIN failures now show attempts remaining before a device wipe. Settings and wallet
PINs have separate counters; local and remote wallet decryption share a counter.
The 16th incorrect attempt wipes all NVS, including the wallet, transport identity,
pairings and Wi-Fi settings. Successful verification resets its counter. Counters
survive reboot; interrupted checks consume an attempt. See [protocol.md](docs/protocol.md).

On a disposable device only, verify wrong settings/local-wallet/remote-wallet PINs,
remaining-attempt messages, cooldown/reboot behavior, success resetting only the
correct counter, and erasure at failure 16 followed by fresh setup. Exercise power
loss during verification and erasure and storage-write failure. Confirm old
pairings cannot reconnect after wipe. This is a destructive acceptance test and
must not be run on a funded device as part of ordinary source checks.

Verify LNbits displays the limit reason and “Waiting for on device approval” for
per-transaction, daily and combined limits. Approval/rejection must still be bound
to the active request; invalid PSBTs must not increment PIN failures. A firmware
build and native tests do not establish physical erasure or live relay delivery.

## Repository layout

This is the firmware Git repository. Run all build and test commands from this
directory. The mobile app and LNbits are independent sibling repositories at
`../mobile/` and `../lnbits/`. Firmware builds do not require either checkout;
optional LNbits interoperability tests use the sibling LNbits checkout.
The full pre-split history is retained; mobile has its own extracted history.

### Source map

| Path | Purpose |
| --- | --- |
| `src/main.cpp` | Touchscreen screens and user actions |
| `src/engine.cpp` | Settings, relay transport, PIN handling and signing lifecycle |
| `src/wallet.h` | Wallet vault and key handling |
| `src/validation.h`, `src/signing.h` | Bitcoin transaction validation and signing |
| `src/approval_policy.h`, `src/pin_attempts.h` | Approval limits and persistent retry policy |
| `scripts/` | Build support, safe upload and native test utilities |
| `tests/` | Native and client interoperability checks |
| `docs/protocol.md` | Version 1 wire contract |

See the [delivery specification](docs/mobile-signer-spec.md) for the complete
client/device flow and [verification record](docs/verification.md) for test scope.
