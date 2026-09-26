# Remote Signer mobile client

This app controls the existing ESP32 Bitcoin signer over Nostr, in the same
protocol role as the LNbits browser. **Bitcoin keys and approval stay on the
ESP32.** The old phone-as-signer simulation was incorrect and has been removed.

## Working wallet flow

1. Open ESP32 **Settings → Pair a browser**. Scan/paste its QR in the app,
   compare the phone's full Nostr public key on the ESP32 and approve there.
   The independent phone transport key is held in OS-backed secure storage.
2. In **App settings**, save your Testnet4 Electrs Electrum endpoint:
   `ssl://host:50002` for TLS with a system-trusted certificate, or
   `tcp://192.168.1.10:50001` for a trusted local network. Plain TCP exposes
   queries to the network. This field is not an Esplora HTTP API URL. Standard
   Electrs can sit behind a TLS proxy; accept-any-certificate mode is not offered.
3. **Reconnect / refresh account**, then **Sync wallet**. The phone verifies
   Testnet4's genesis, scans receive/change branches, and displays balances,
   coins and transaction history. Electrs sees script hashes and supplies chain
   status; this is a server-trusting wallet, not SPV or a full node.
4. Choose **New receive address** and copy it to receive Testnet4 coins. Issued
   receive/change indices are persisted per xpub before exposure. Discovery uses
   a 20-address gap and a 1,000-address limit per branch; incomplete scans fail.
5. Enter a recipient and amount in sats, or choose **Send maximum**. Use
   automatic largest-first selection or **Coin control** to select exact outputs.
   Unconfirmed inputs require an explicit opt-in; immature coinbase is excluded.
6. **Refresh fee estimates** uses only mempool.space's Testnet4 recommended-fee
   endpoint. Choose a target or enter sat/vB manually (up to three decimals).
   Stale estimates require refresh after five minutes. API failures are shown;
   no mainnet fallback is used. Confirmation targets are approximate.
7. **Prepare and review payment** checks the selected coins again and builds
   the PSBT locally with full previous transactions and BIP84 derivations. Review
   recipients, verified change, wallet debit and the total fee. Dust remainder
   is explicitly included in the displayed fee. No LNbits service is required.
8. **Request signature from ESP32**. Enter the **wallet PIN** only after its
   authenticated request; approve on the device unless its policy permits auto
   approval. All signing, private keys and approval policy stay on the ESP32.
9. The phone verifies every signature against the original transaction/UTXOs,
   finalizes it locally, and shows its txid, actual vsize and fee rate.
   **Broadcast transaction** opens a separate confirmation before submitting
   to your Electrs server. Acceptance is not confirmation; sync history to track it.
10. A verified signed-payment recovery record remains on disk until explicitly
    cleared. After restarting, reconnect to the same account to restore it.
    On an uncertain result, **Check transaction status** first; retrying broadcasts
    the identical transaction, never automatically creates a replacement.

PSBT file/base64 import and signed PSBT export remain optional tools. No payment
construction, finalization or broadcasting is outsourced to LNbits. v1 firmware
still restricts transactions to Testnet4, native SegWit BIP84 inputs, final
sequences (no RBF), and at most 32 inputs/outputs and a 32 KiB unsigned PSBT.
Full previous transactions can hit that size limit even with fewer inputs.

**Stop waiting / disconnect is local only.** Firmware v1 has no remote cancel,
lock, approve, policy-edit or revoke method. A pending request may still complete
on the ESP32. Backgrounding closes connections and clears PIN/pairing text.
Forgetting the phone connection does not revoke its key on ESP32; use Settings
→ Paired browsers. It also retains account-scoped address cursors and payment
recovery records. A corrupted recovery record blocks new payments until reviewed
and explicitly cleared. PINs, tokens and Bitcoin private keys are never saved.

## Build and run

Node 22.13+, npm, Android Studio / SDK 36 / Java 21, and Xcode 26.4+ for iOS.
The project uses Expo SDK 57 and development builds. Native TCP/TLS support requires a new native build; an older APK cannot run it.

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

- `src/client.ts`: authenticated Nostr/NIP-44 device requests and PIN binding.
- `src/electrum.ts` / `electrum-native.ts`: bounded Electrum 1.4 JSON-RPC,
  connection/request timeouts and Testnet4 genesis verification over TCP/TLS.
- `src/wallet.ts`: discovery, verified UTXOs, coin selection, fee/PSBT construction,
  signature-checked finalization, spend checks and explicit broadcast operations.
- `src/fees.ts`: bounded, validated mempool.space Testnet4 estimates.
- `src/bitcoin.ts`: original-transaction/UTXO/signature validation.
- `src/wallet-storage.ts`: server/cursor preferences in SecureStore, and a
  public signed-payment recovery file in the app document sandbox (no PIN/seed).
- `src/WalletPanel.tsx` / `BroadcastPanel.tsx`: wallet, settings and broadcast UI.
- `scripts/patch-tcp-tls.cjs`: pinned postinstall fix for Android TCP module TLS
  hostname verification/SNI. Fails closed on unexpected dependency versions.
  Never bypass certificate checks to connect to a self-signed Electrum server.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run export:check
```

Tests use real Bitcoin/Nostr cryptography and deterministic test-only fixtures,
with fake Electrum/relay connections. They cover network mismatches, framed RPC,
bad UTXOs, gap discovery, coinbase maturity, exact coin control, fee rounding,
send-max/dust, spent-input checks, finalization and broadcast binding/errors.
They do not establish native socket interoperability or physical-device behavior.

## Physical acceptance checklist

- Pair/reconnect on Android and iPhone; compare the public account with ESP32.
- Connect to Testnet4 Electrs via TCP and trusted TLS; reject wrong-host, expired,
  untrusted certificates and non-Testnet4 servers. Exercise local-network prompts.
- Receive test coins on a fresh address; restart and ensure indices survive.
- Sync both branches, pending transactions and change; simulate backend failures.
- Select exact UTXOs, exclude immature coinbase, opt into unconfirmed inputs,
  test max-send/insufficient funds/dust, and compare displayed versus final fees.
- Fetch fees, test API failure and five-minute staleness, and use a manual rate.
- Build/sign/reject on ESP32; test wrong PIN, cooldown, timeout and backgrounding.
- Confirm broadcast separately, verify the txid, sync confirmation and restart.
  Drop the broadcast reply; recover/check/retry the exact saved transaction.
- Verify camera/file permissions, signed export and PIN clearing on background.

The corrected iOS native project still needs regeneration/CocoaPods and a device
build. Physical Android/iPhone/ESP32 interoperability has not been verified.
See [the specification](../docs/mobile-signer-spec.md) for bounds and phases.
