# Repository guidance

- Read [the current flow and mobile delivery spec](docs/mobile-signer-spec.md)
  before changing the mobile app or signer behavior. [docs/protocol.md](docs/protocol.md)
  defines the existing v1 wire contract. Keep both accurate when changing it.
- `src/` is ESP32 firmware; `../mobile/` is a separate React Native / Expo repository.
  The mobile app is the remote client, equivalent to the LNbits browser. Bitcoin
  keys, approval policy and signing stay on the ESP32. Distinguish implemented
  client functionality from physically verified interoperability.
- Stay Testnet4-only. Preserve explicit user-confirmed in-app broadcast, request-bound approval,
  remote PIN semantics, validation before signing, and locking on terminal paths.
- Never log/store demo inputs as real secrets or introduce seed/PIN telemetry.
  Never add Bitcoin custody to the phone; this project is a remote client.
- The mobile wallet uses a configurable Electrs Electrum TCP/TLS endpoint and
  mempool.space Testnet4 fee estimates. Verify the Testnet4 genesis before queries
  or broadcast; verify UTXOs, signatures and transaction identity locally. Keep
  persisted address cursors and signed-payment recovery across app restarts.
- `../lnbits/` is a separately managed sibling repository. Do not make the mobile
  project depend on it or modify it without inspecting its own AGENTS.md.
- For mobile changes run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint` and
  `npm run export:check` from `../mobile/`. Use the device checklist in its README
  for native changes; state clearly which physical-device tests were not run.
- Preserve unrelated local edits. Do not flash hardware, erase storage, publish
  builds or broadcast transactions as part of ordinary source changes.

- This is the firmware Git root. Run PlatformIO and firmware checks here.
  Keep wire-contract documentation coordinated with the mobile repository.
