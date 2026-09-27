# Verification record

Updated 26 September 2026. This is a prototype; a successful build is not evidence of a completed device payment.

## Automated checks

- PlatformIO normal and self-test environments build for the Guition JC3248W535 ESP32-S3 with 8 MB PSRAM.
- Four native test groups pass with AddressSanitizer and UndefinedBehaviorSanitizer. They compile the production validation/signing code and compare recovery, public keys, signatures and finalized transactions against independently generated libwally vectors. Negative cases cover previous transaction verification, inconsistent amounts, false change, foreign derivations, unsupported sighashes, pre-signed inputs, malformed maps, truncation and size bounds.
- Native protocol state tests pass for duplicate detection, replay capacity, expiry, clock skew and session binding.
- Six browser transport tests pass using real nostr-tools cryptography and simulated relay connections. They cover pairing bounds, duplicate relay delivery, invalid responses, busy/rejection/revocation/session errors, reconnects, one pending request, expiry and oversized PSBTs.
- LNbits PSBT unit tests: 111 passed, including the opt-in full previous transaction data. Existing compact PSBT construction remains the default.
- A broader LNbits unit run reported 828 passed and four failures in payment-notification and Breez wallet tests. Those failures are outside the modified onchain code; they have not been independently established as baseline failures.
- Changed LNbits Python and frontend files pass Ruff, Black, Prettier and whitespace checks.

## Device and live integration

The self-test application has been flashed using the application-only uploader, which backs up the prior application and preserves NVS and the partition table. Display, touchscreen and LVGL initialization were observed over serial. The device reported `BITCOIN SELFTEST PASS: recovery, vault, wrong PIN, tamper, NIP44`. This checks 12/24-word recovery, the independent PBKDF2 vector, encrypted storage round trip, wrong-PIN and ciphertext-tampering rejection, and authenticated NIP44 round trip. The complete run took approximately 106 seconds; PIN derivation intentionally contributes most of that time.

The normal firmware was subsequently built and uploaded successfully, preserving data partitions.

Local LNbits is running from the modified checkout at http://localhost:5001. The explorer is configured to `ssl://mempool.space:40002` on Testnet4 and successfully returned a chain tip (height 153960) through the LNbits API. The existing empty Onchain wallet is configured for Testnet4 with the LNbits explorer. Browser checks confirmed the Nostr signer button is enabled and its pairing panel renders without JavaScript errors.

A device-backed receive → touchscreen approval → signed PSBT → manual broadcast demonstration has **not yet been completed**. Recovery backup verification, unlocking after restart, live pairing/revocation, a request expiring on-screen and a restart while awaiting approval also need device-level verification. Automated tests above do not substitute for these checks.

## Backup verification UI update

The generated-wallet backup check now presents four distinct word choices for each of the 12 positions, advancing immediately on a correct tap and displaying “Incorrect word” on an incorrect tap. Incorrect selections cannot advance, and repeated words in a phrase remain supported. The updated normal firmware builds successfully. Physical walkthrough of all 12 choices is pending.

## PIN and touch update

PIN setup, confirmation and unlock now use a digits-only keypad with backspace and Done, and enforce 6–32 digits. Keyboard keys act on release with repeat disabled. The touch driver polls actual contact data rather than treating missing interrupts as finger releases, validates complete I2C reads, and uses the event bits defined by the [Espressif driver](https://github.com/espressif/esp-iot-solution/blob/master/components/display/lcd/esp_lcd_axs15231b/esp_lcd_axs15231b.c). Native sanitizer tests pass for continuous contact, explicit release, repeated intentional taps, brief read errors, lost-controller timeout, multiple contacts and timer wraparound. The follow-up touch fix requires 90 ms of stable release before emitting a click, retains the last real coordinates during release debounce, and requires a fresh press after release so stale contact packets cannot create another tap. A regression sequence alternates empty/lift/contact packets during one held press and verifies exactly one character on release; an intentional second tap of the same digit still works. Read-error and timer-wrap checks also pass. This follow-up is built only, **not flashed**, at the user's request. Physical confirmation of typing behaviour remains pending.

## Access-point setup portal

Wi-Fi credentials and relay URLs are now entered in a browser connected to a temporary password-protected device access point. The touchscreen displays its credentials, Wi-Fi QR code and `http://192.168.4.1/` address. The HTTP server binds to the AP address, accepts a per-session form token, and exposes only network setup. Existing wallets require local unlock. Active transaction approvals prevent starting setup; relay processing pauses during setup. Setup closes on submission, cancellation, lock or a ten-minute timeout. Credentials are not prefilled or logged.

Native sanitizer checks pass for the shared settings validator: valid/open Wi-Fi, SSID/password limits, one-to-three secure relay URLs, malformed hosts, unsupported schemes/ports, credentials in URLs, whitespace, embedded NUL and oversized input. PlatformIO build passes. AP association, phone-browser submission and reconnect still need device testing; the agent has run build checks only and has not flashed this update.

## AP page scan and password controls

The portal includes an asynchronous Wi-Fi scan, a selectable list of up to 32 distinct visible networks, manual SSID entry, a password-visibility checkbox, and default relay `wss://relay.nostrconnect.com`. Scan requests require the setup-session token. Scans are stopped and results cleared when setup closes. Six JavaScript tests pass for password visibility, scan polling and selection, safe rendering of SSIDs, empty results, failures/expiry, polling timeout and the default relay. Real radio scanning still needs device verification. No firmware upload was performed by the agent.

## Automatic public-wallet import

Successful browser pairing now retrieves and imports the public account automatically, with progress text and success/error notifications. Existing matching descriptors are reused, different accounts are not overwritten, and failed imports retain the connection and pairing for retry. Five component tests pass for automatic import, rejected pairing, reconnect idempotence, import failure/retry and conflicting accounts. Changed frontend files pass Prettier and whitespace checks. A live device-backed pairing/import has not been repeated for this change.

## Boundaries

No mainnet, multisig, Taproot input, wallet-PIN-free signing or server-side background delivery is supported. Optional touchscreen auto approval uses the transaction and daily limits below. The prototype makes no claim of secure-element or physical-extraction protection. Keep recovery phrases on the device. Enter the PIN only in the paired client’s requested PIN field or local settings unlock; never paste it into logs, pairing fields or chat.


## Remote PIN signing and reconnection update (26 September)

Firmware now connects while the Bitcoin wallet is locked, retries Wi-Fi, and rebuilds relay connections/subscriptions after Wi-Fi recovery. Existing vaults require one local unlock to provision the separate transport identity/public metadata. Signing requires a request-bound encrypted PIN, publishes ordered progress, retains local transaction approval, and clears Bitcoin keys before publishing the signed PSBT and on all terminal failure paths. Wallet seed derivation uses temporary buffers that are explicitly wiped; key destructors zero private scalars and chain codes.

Automated verification: normal and self-test firmware builds; sanitizer protocol tests for PIN ownership, request/hash/session binding, expiry and Wi-Fi retry timing/wraparound; 12 real-cryptography transport tests (including retries through ephemeral relays); 9 pairing/signing component tests; four independent libwally validation/signing groups; and all 96 existing LNbits onchain UI tests. The hardware self-test additionally checks that a closed wallet rejects validation.

This update has not been flashed. Actual Wi-Fi loss/recovery, remote PIN entry, hardware memory cleanup and device-backed signing still require physical verification. Earlier hardware results above apply to the previous firmware, not this update.


## Separate settings PIN, touch responsiveness and automatic approval

Settings now owns Network settings, pairing/revocation and Auto Signing Settings. A separately salted 6–32 digit settings credential is created during setup; existing devices first verify their wallet PIN once to authorize migration. Settings access uses no Bitcoin decryption and expires on close or after one minute without touchscreen activity while the configuration portal is inactive.

Touch polling is 10 ms. Confirmed lifts use a 20 ms release filter; ambiguous empty packets retain a 70 ms filter. Short stale contact tails cannot re-arm a key, while a new contact after a quiet interval can recover a missed initial press packet. Numeric keypads have no Done/dismiss key and remain open through PIN entry. Background status messages do not reset input controls, and incoming signing requests cannot replace open settings screens.

Native sanitizer checks cover rapid repeated taps, held-finger bounce, stale tails, missed press packets, read failures and timer wraparound. Policy checks cover recipients-plus-fees excluding change, strict transaction thresholds, exact daily limits, disabled limits, reboot state, UTC rollover, clock rollback, manual reservations, storage failure before signing, overflow and malformed amounts. The hardware self-test additionally rejects wallet-domain encrypted data as a settings credential.

The client accepts authenticated automatic-approval progress without treating it as a final signature. The earlier automatic-connection regression test exercises Sign with device after a page reload with a saved pairing and no wallet metadata flag.

This update is built and automatically tested only; physical touch responsiveness, settings migration, NVS power-loss behavior and device-backed automatic/manual signing need hardware verification. No firmware upload was performed.


## Slate & Mint device theme

The shared LVGL theme uses slate surfaces, mint primary actions, rounded settings rows, subdued secondary actions and distinct rejection/error styling. Numeric input uses 28 px text in 64 px fields; the 240 px numeric keyboard uses large keys and 28 px digits. Explanatory text collapses while entering numbers so the active field and next action stay reachable. PIN masking remains immediate, and signing/settings authorization behavior is unchanged.

Representative home, settings and PIN screens were rendered using the installed LVGL library with the production styles and 32 KiB UI heap. The inspected screens retained at least 14 KiB of free UI heap. Normal firmware builds successfully. Previews are in `output/slate-mint/`. This update has not been flashed; visual and touch confirmation on the physical display remains pending.

## Argus light identity — 26 September 2026

The Argus device-and-signal mark appears at startup, on the locked home and
welcome screens, and in Settings. The shared theme now uses cloud/white surfaces,
ink text, teal actions and readable error colors. The setup portal is also light,
and its access point is named `Argus-…`. Wire protocol and NVS keys are unchanged.

- `pio run -e esp32-s3-n16r8v` passed: RAM 89,984 / 327,680 bytes;
  flash 1,853,905 / 6,553,600 bytes.
- Six network-portal tests and native touch sanitizer tests passed.
- Representative splash, home, Settings and PIN/keypad views rendered with the
  actual production LVGL theme and generated logo. Inspected the rendered images
  in `output/argus/`. Settings remains scrollable; its lowest visible button can
  be reached by scrolling. Minimum free UI heap among these renders: 13,544 bytes.
- No hardware was flashed. Physical display/touch checks and device-backed
  signing/approval interoperability remain unverified by this visual update.
