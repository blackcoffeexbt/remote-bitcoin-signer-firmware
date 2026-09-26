# Remote Signer mobile

React Native + TypeScript, using Expo SDK 57. Android and iOS share the same
application. **Phase 0 is an interactive simulation, not a working Bitcoin
signer.** No keys, seeds or PINs are collected, stored or transmitted. No Nostr
connection, PSBT validation/signing or broadcast is implemented yet.

Read the [current-flow specification and phased plan](../docs/mobile-signer-spec.md).
The working product direction is a phone replacing the ESP32 signer, with
LNbits remaining the payment builder and broadcaster.

## Run on your devices

Prerequisites: Node 22.13+ (Node 22 LTS recommended), npm, Xcode with its command
line tools and an iOS simulator runtime, Android Studio with Android SDK 36,
and a compatible Java toolchain. SDK 57 supports iOS 16.4+ / Android 7+ and
requires Xcode 26.4+; see [Expo's version matrix](https://docs.expo.dev/versions/v57.0.0/).
Xcode 26.6 was detected on the development machine.

From this repository:

```sh
cd mobile
npm ci
```

For an Android phone, enable Developer options and USB debugging, connect it
and accept the computer's debugging authorization, then:

```sh
npm run android:device
```

For an iPhone, connect and trust the Mac, enable Developer Mode, then:

```sh
npm run ios:device
```

Choose the physical device when prompted. iPhone installation requires local
development signing. Select your Apple development team in Xcode if requested.
The starter bundle ID is `pw.sats.remotebitcoinsigner`; change both identifiers
in `app.json` if needed for your signing setup. No App Store/EAS deployment is
required. These commands generate native projects and build/install a development
client using your local tools. See [Expo local builds](https://docs.expo.dev/guides/local-app-overview/).

For Android emulator or iOS Simulator:

```sh
npm run android
npm run ios
```

After the first native build, start the JavaScript development server with
`npm start`. Keep the phone and Mac on the same reachable network and permit
local-network access when asked. Android over USB can use
`adb reverse tcp:8081 tcp:8081`. Rebuild the native app when native dependencies
or native configuration change. This project uses a development client rather
than relying on the version of Expo Go installed on your devices.

To inspect the generated native projects in your IDEs, run `npm run prebuild`,
then open `android/` in Android Studio or the generated `.xcworkspace` under
`ios/` in Xcode. Generated folders are ignored; maintain configuration in
`app.json`/config plugins. Do not put lasting changes only in generated files.

## Try the current prototype

### Standalone device builds

Build a standalone ARM64 Android APK (includes the JavaScript bundle; no Metro
server needed):

```sh
sh scripts/build-apk.sh
```

Output: `artifacts/remote-signer-demo-arm64.apk`. The generated Expo release
configuration uses the local **debug signing key** for this test APK; it is
not a store release. Install with Android's package installer or
`adb install -r artifacts/remote-signer-demo-arm64.apk`.

For iPhone, open `ios/RemoteSignerDemo.xcworkspace`, select the
**RemoteSignerDemoDevice** scheme, select your connected iPhone, and choose
your Apple development team under the app target's **Signing & Capabilities**.
Press Run. This scheme runs Release configuration with bundled JavaScript, so
the installed demo does not need Metro. The normal **RemoteSignerDemo** scheme
remains available for development. The device scheme is generated reproducibly
by `plugins/withDeviceScheme.js`.

Native build attempt, 26 September: dependencies required more disk space than
was available. The Android build was stopped during NDK installation before
the disk filled; **no APK has been produced yet**. iOS CocoaPods installation
completed and the workspace was opened in Xcode. iOS native compilation and
device signing remain unverified. Free at least 10 GB before retrying. No
Apple team was selected automatically because the available development
identity was not confirmed for this project.

### Demo checklist

1. Choose **Try demo pairing**. Inspect the clearly labelled fixture identity;
   approve or cancel. There is no actual QR/relay pairing yet.
2. Choose **Start demo payment**, then **Simulate PIN unlock**. This represents
   authenticated remote unlock and successful validation; it performs neither.
3. Inspect the recipient amount (25,000 sats), change (74,500 sats), fee (500
   sats) and total debit (25,500 sats). Addresses are invalid placeholders.
4. Approve to reach **Demo complete**, or reject. No PSBT or signature is created.
5. Repeat, leave the app during review, and return: the request must be cancelled.
   Also test **Lock and cancel**, a 150-second payment timeout, a three-minute
   pairing timeout, and **Forget demo browser**.

Demo state is intentionally in memory and resets on process restart. Locking
retains the demo pairing but cancels the active request. Pairing/authenticated
protocol input, persistent custody and live transactions belong to Phase 1.

## Implementation map

- `App.tsx`: single-screen interactive demo with native safe areas and lifecycle
  cancellation; use Expo Router when adding separate navigation screens.
- `src/demo.ts`: deterministic simulation reducer; request-ID and deadline-bound
  actions. Its inputs are trusted local fixtures, not untrusted relay messages.
- `src/protocol.ts`: typed v1 request/response shapes and constants. Runtime
  validation, NIP-01/NIP-44 crypto and relay delivery remain to be implemented.
- `tests/demo.test.ts`: meaningful state-transition and stale-action regressions.

Next vertical milestone: native vault/public account → encrypted pairing and
account import → constrained PSBT review → remote PIN/manual signing → LNbits
verification and explicit Testnet4 broadcast on both devices. Automatic approval
and background delivery are deferred; full gates are in the specification.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run export:check
```

`export:check` produces Android/iOS JavaScript bundles under ignored `dist/`.
It does not compile native binaries, install on devices or verify live signing.
The Node test runner uses its TypeScript stripping flag; an experimental-feature
warning on Node 22.17 is expected.

Validation on 26 September 2026: clean `npm ci` and Expo dependency compatibility
check pass; TypeScript and ESLint pass; all eight reducer
tests pass; Android and iOS Hermes bundles export successfully. No native
binary was built or installed. The sandboxed simulator inventory check could
not connect to CoreSimulator, so simulator UI behavior was not verified.

Dependency audit reports 10 moderate findings in the Expo build-tool chain,
rooted in the `xcode` package's transitive `uuid` dependency. The suggested npm
automatic resolution includes downgrading Expo to SDK 46; it has not been
applied. Review the upstream fix before progressing to a release/custody build.

Physical acceptance still requires running the checklist above on an Android
phone and iPhone. Record OS/device and result before calling the UI device-tested.
Native custody, live relay interoperability and a real Testnet4 payment are
unimplemented and untested in this phase.
