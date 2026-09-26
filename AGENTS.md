# Repository guidance

- Read [the current flow and mobile delivery spec](docs/mobile-signer-spec.md)
  before changing the mobile app or signer behavior. [docs/protocol.md](docs/protocol.md)
  defines the existing v1 wire contract. Keep both accurate when changing it.
- `src/` is ESP32 firmware; `mobile/` is a separate React Native / Expo project.
  The mobile starter is a simulation, not a live Bitcoin signer. Preserve that
  distinction in UI, documentation and completion reports until Phase 1 passes.
- Stay Testnet4-only. Preserve explicit LNbits broadcast, request-bound approval,
  remote PIN semantics, validation before signing, and locking on terminal paths.
- Never log/store demo inputs as real secrets or introduce seed/PIN telemetry.
  Do not add live custody without the storage and validation gates in the spec.
- `lnbits/` is an ignored, separately managed checkout. Do not make the mobile
  project depend on it or modify it without inspecting its own AGENTS.md.
- For mobile changes run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint` and
  `npm run export:check` from `mobile/`. Use the device checklist in its README
  for native changes; state clearly which physical-device tests were not run.
- Preserve unrelated local edits. Do not flash hardware, erase storage, publish
  builds or broadcast transactions as part of ordinary source changes.
