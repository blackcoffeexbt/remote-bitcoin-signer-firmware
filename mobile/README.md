# Remote Signer mobile client

This app controls the existing ESP32 Bitcoin signer over Nostr, in the same
protocol role as the LNbits browser. **Bitcoin keys and approval stay on the
ESP32.** The old phone-as-signer simulation was incorrect and has been removed.

## Working client flow

1. On ESP32 open **Settings → Pair a browser**. In the phone app scan its QR or
   paste the pairing JSON, name this client, and choose **Request pairing**.
   Compare the phone's full Nostr public key on ESP32 and approve there.
2. The app retrieves the public account. Its independent Nostr transport identity
   and connection are saved in OS-backed secure storage. Reopen the app and use
   **Reconnect / refresh account** to retrieve the device's current account.
3. Prepare a Testnet4 payment in LNbits with full previous transactions included
   (`include_non_witness_utxo=true`). Export the unsigned PSBT. Paste its base64
   or use **Import PSBT file** (binary `.psbt` or base64 text).
4. **Review transaction** displays full recipients, verified own outputs,
   amounts, fee and wallet debit. **Request signature from ESP32** refreshes
   the boot session and sends the encrypted signing request.
5. Enter the ESP32 **wallet PIN** only when the authenticated device status
   requests it. The PIN is encrypted to the device with the original request
   ID/hash/session binding. It is not sent to LNbits or stored on the phone.
6. Review/approve on ESP32, unless its existing auto-approval policy applies.
   The phone follows authenticated progress and verifies the returned unsigned
   transaction and every Bitcoin signature against the original PSBT data.
7. **Copy signed PSBT** or **Share signed PSBT file**, return it to LNbits, and
   explicitly finalize/broadcast there. The phone does not broadcast.

The current MVP imports prepared PSBTs. It does not yet reproduce LNbits'
balances, coin selection, transaction builder or broadcast UI. The displayed
index-0 receive address is a reference, not a fresh-address allocator.

**Stop waiting / disconnect is local only.** Firmware v1 has no remote cancel,
lock, approve, policy-edit or revoke method. A pending request may still complete
on the ESP32; inspect device/LNbits state before retrying. Backgrounding clears
PIN/pairing text, closes sockets and stops waiting. Forgetting the phone's local
connection does not revoke its old key on ESP32: use Settings → Paired browsers.

## Build and run

Node 22.13+, npm, Android Studio / SDK 36 / Java 21, and Xcode 26.4+ for iOS.
The project uses Expo SDK 57 and development builds. Native dependencies changed
for the real client, so reinstalling the earlier demo APK is not sufficient.

```sh
cd mobile
npm ci
npx expo prebuild
npm run android:device
# or, on the Mac with an iPhone connected:
npm run ios:device
```

For later JavaScript development, `npm start`. Keep the phone and Mac on a
reachable local network. For standalone ARM64 Android testing:

```sh
sh scripts/build-apk.sh
```

The local test APK uses the generated debug certificate, with bundled JavaScript
and no Metro requirement. It is not store-signed. Android 7+ is supported.
Generated `android/` and `ios/` directories are ignored; config plugins preserve
native settings across regeneration.

For iPhone, first regenerate with `npx expo prebuild --platform ios` to install
the new native dependencies, then open the generated `.xcworkspace` under `ios/`.
The earlier demo workspace is not ready for this client: its obsolete generated
Pods were removed to free space for the Android build. Select the
`Device`-suffixed scheme, your iPhone and Apple development team, then Run.
The device scheme bundles JavaScript in Release configuration.

`withActivityLintWorkaround.js` limits a release lint exception to MainActivity's
false `Instantiatable` finding. Its compiled public constructor and full
ReactActivity/AndroidX chain to android.app.Activity were verified during the
previous build. All other release checks remain enabled; recheck on upgrades.

## Architecture and checks

- `src/client.ts`: signed NIP-01 kind 24134 + NIP-44 v2 client, retry/reconnect,
  binding/expiry/progress validation, account pinning and PIN submission.
- `src/bitcoin.ts`: Testnet BIP84 ownership/UTXO review and signed PSBT validation.
  Returned metadata is discarded; only verified signatures join original maps.
- `src/storage.ts`: separate secure transport key and connection persistence.
- `src/random.ts`: native cryptographic randomness before Nostr initialization.
- `App.tsx`: real pairing, QR/file import, progress/PIN and verified PSBT export.
- `tests/`: real Nostr and Bitcoin cryptography against fake relay sockets and
  disposable deterministic Bitcoin fixtures. No firmware or network mock is
  reachable from the app UI.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run export:check
```

See [the corrected spec](../docs/mobile-signer-spec.md) for the full protocol and
physical acceptance checklist. A test against simulated relay sockets does not
prove live ESP32/Android/iPhone interoperability. Camera permission, secure-store
persistence, background behavior, file sharing, wrong-PIN/cooldown handling and
one device-backed Testnet4 round trip still require physical-device testing.

The existing Expo build-tool audit findings remain separate from runtime checks;
this client is Testnet4-only and is not represented as production-audited.

## Verification record — 26 September 2026

Dependency installation, all 14 protocol/Bitcoin tests, TypeScript, lint and
Android/iOS JavaScript exports passed. The standalone Android release build
passed and its APK signature was verified: `artifacts/remote-signer-client-arm64.apk`,
version 0.2.0 (code 2), ARM64, minimum Android 7. The APK uses the local test
certificate. No physical Android/iPhone or live ESP32 round trip was tested.
The corrected iOS native project has not been rebuilt.
