# Remote Bitcoin Signer: current flow and mobile delivery specification

Status: implementation baseline, 26 September 2026. The mobile project starts at
Phase 0; it is not yet a Bitcoin signer. This document describes the current
ESP32 + LNbits implementation separately from the proposed mobile behavior.

## Product direction

Working assumption: the Android/iOS app **replaces the ESP32 signer**, holding the
Bitcoin wallet and responding to the existing LNbits browser over Nostr. LNbits
continues to discover UTXOs, build payments, verify/finalize signed transactions,
and broadcast after a separate user action. The phone is not a second LNbits
wallet UI or a remote control for the ESP32. Confirm this assumption before
implementing custody. The starter contains no seed, PIN, network signing, or
production vault implementation.

The smallest useful live MVP is: restore a disposable Testnet4 wallet on the
phone, pair LNbits, import its public account, receive test coins, review and
manually sign one payment, then explicitly broadcast from LNbits. Keep the app
foregrounded. Automatic approval and background delivery are later phases.

## Current system and trust boundaries

| Component | Responsibility / retained information |
| --- | --- |
| ESP32 signer | Bitcoin seed in PIN-encrypted vault; independent Nostr secret; public account; paired browser keys; approval policy and daily reservations |
| LNbits browser | Separate Nostr secret and connection data scoped to user/wallet; pending PSBT and transient wallet PIN; authenticates signer responses |
| LNbits server | Public wallet, chain/explorer access, UTXOs, PSBT construction, signature verification/finalization and explicit broadcast; does not receive the remote wallet PIN |
| Nostr relays | Carry signed encrypted events; see author, recipient, time, size and traffic patterns; not trusted for authorization or delivery |

Bitcoin and Nostr keys are independent. This protocol is project-specific v1,
**not NIP-46**. NIP-44 provides ciphertext authentication but neither forward
secrecy nor routing privacy. The signer validates supplied previous transactions;
it cannot prove inputs remain unspent without chain access. Testnet4 only.

Source of truth: `src/main.cpp` (screens), `src/engine.cpp` (orchestration),
`src/protocol_state.h` (freshness/replay/session checks), `src/wallet.h`,
`src/validation.h`, `src/signing.h`, `src/device_settings.h`, and
`src/approval_policy.h`. The locally included, separately managed LNbits checkout
contains `lnbits/lnbits/onchain/static/js/nostr-signer-client.js`,
`static/components/nostr-signer.js`, `static/components/payment.js`, and `psbt.py`
under its onchain directory. It is ignored by this repository, so mobile code
must not depend on that checkout being installed. See also [protocol.md](protocol.md).

## Current user journey

1. **Provision:** create a 6–32 digit settings PIN. Continue wallet setup;
   generate 12 words and verify each word from four choices, or restore a valid
   12/24-word BIP39 phrase. Set and confirm a separate 6–32 digit wallet PIN.
   Account is native SegWit `m/84'/1'/0'`, no BIP39 passphrase.
2. **Connect:** Settings requires the settings PIN. Network settings opens a
   temporary password-protected Wi-Fi AP, with credentials/QR and
   `http://192.168.4.1/`. Scan/select Wi-Fi (or enter manually), enter its password
   and 1–3 secure relays. Save closes the portal; cancel or ten minutes also
   closes it. Default relay: `wss://relay.nostrconnect.com`. Device validates TLS
   and waits for synchronized time. Wi-Fi reconnect attempts occur every 15s.
3. **Pair:** open a Testnet4 onchain wallet in LNbits and choose Nostr signer.
   Open Settings → Pair a browser on the device. Scan/paste the pairing JSON
   into LNbits, enter a printable client label and choose Pair. Device shows the
   label and full browser Nostr public key. Compare and approve or reject locally.
   Approval consumes the token and saves the pairing (maximum eight clients).
4. **Import:** pairing returns public account information; LNbits imports it
   automatically. An existing matching account is reused. A conflicting wallet
   is not overwritten. Import failure retains pairing and offers retry.
5. **Prepare:** receive Testnet4 coins using LNbits. Enter destination, amount,
   fee/coin selection there. LNbits builds a PSBT including full previous
   transactions. Choose Sign with device; browser reconnects if necessary and
   retrieves the current session with `get_account`.
6. **Unlock:** signer locks Bitcoin keys at the beginning of every request and
   emits Ready to sign then PIN required. Only after authenticated PIN required
   does LNbits show the wallet PIN field. Browser sends an encrypted `unlock`
   bound to this request. Device derives the vault key (about 20s on this board),
   decrypts, and validates the complete PSBT. The original signing request stays
   pending throughout.
7. **Approve:** review client, Testnet4 network, every full recipient address,
   amount, verified change and fee on the device. Approve/reject. Configured
   automatic limits can skip the tap, but never the wallet PIN or validation.
8. **Return:** reserve daily usage durably before signing; clear Bitcoin keys
   before publishing the encrypted signed PSBT. LNbits matches the unsigned
   transaction and verifies signatures before finalizing.
9. **Broadcast:** inspect the finalized transaction in LNbits and separately
   choose Broadcast. Relay ACK, approval, Signing complete, and signed PSBT
   delivery do not mean a transaction was broadcast or confirmed.

On boot the wallet is locked while relay transport remains available. A legacy
vault needs one local unlock to provision the independent transport/public
metadata and one-time authorization to create a settings credential. Settings
expires after ten minutes without a settings command, or immediately on close;
signing cannot interrupt an open settings session. Revocation rejects future
requests and cancels pending work from that client. Forgetting browser storage
does not revoke the device pairing. Old approval callbacks are request-ID-bound.

## Wire protocol

### Nostr transport envelope

Both directions publish `["EVENT", event]`; subscriptions receive
`["EVENT", subscriptionId, event]`. A browser subscribes using:

```json
["REQ", "bitcoin-v1", {"kinds":[24134], "authors":["<signer pubkey>"], "#p":["<browser pubkey>"], "since":1800000000}]
```

`since` is current Unix seconds minus 180. A signer filters by its recipient key
and authorizes peers locally (new peers only during its pairing window).

```json
{
  "id": "<64 lowercase hex event hash>",
  "pubkey": "<64 lowercase hex sender x-only Nostr public key>",
  "created_at": 1800000000,
  "kind": 24134,
  "tags": [["p", "<64 lowercase hex recipient public key>"]],
  "content": "<base64 NIP-44 v2 encrypted JSON>",
  "sig": "<128 lowercase hex Schnorr signature>"
}
```

Exactly one tag is allowed, exactly `['p', recipient]`. Event ID is SHA-256 of
NIP-01 canonical JSON `[0,pubkey,created_at,kind,tags,content]`; signature is
BIP340 over that ID. Verify hash/signature, routing, author, kind and timestamp
**before** decryption. Do not confuse the event ID with the inner request ID.
Ephemeral kind 24134 does not guarantee offline delivery. Sign a request once,
send that identical event to all relays, and retry it every five seconds until
completion/deadline. Restore subscriptions and resend pending events on reconnect.

### Pairing QR / paste payload

```json
{
  "protocol":"bitcoin-signer", "version":1,
  "pubkey":"<signer 64 lowercase hex public key>",
  "token":"<32 lowercase hex from 16 random bytes>",
  "relays":["wss://relay.nostrconnect.com"]
}
```

The QR contains no seed, private key, PIN, network, or expiry field. Its
three-minute lifetime is enforced by the signer. The browser validates 1–3
relay URLs, length ≤200 each, `wss`, port absent/443, no credentials or fragment,
and deduplicates them. A token alone cannot approve pairing: local approval is
required. Do not log or retain the token after completion.

### Decrypted request

```json
{
  "protocol":"bitcoin-signer", "version":1, "network":"Testnet4",
  "id":"<32 lowercase hex from 16 fresh random bytes>",
  "method":"sign_psbt", "expires":1800000150,
  "psbt_hash":"<SHA-256 of original decoded PSBT bytes, 64 lowercase hex>",
  "params":{"session":"<current signer boot session>","psbt":"<canonical base64 PSBT>"}
}
```

| Method | `params` | `psbt_hash` | Success `result` |
| --- | --- | --- | --- |
| `pair` | `token`, `label` (1–40 printable ASCII) | Empty string | Public account, after local approval |
| `get_account` | `{}` | Empty string | Public account; paired peer only, works locked |
| `sign_psbt` | `session`, `psbt` | Hash of original decoded bytes | `{ "psbt": "<signed base64 PSBT>" }` |
| `unlock` | `session`, `request_id`, `pin` (6–32 digits) | Same as parent signing request | `{}`; does not settle signing |

Public account fields: `descriptor`, `xpub`, `fingerprint`, `path`, `session`.
Descriptor form: `wpkh([fingerprint/84h/1h/0h]tpub.../<0;1>/*)#checksum`.
The session is a boot freshness challenge, not a secret, and does not change
on wallet lock/unlock. Fetch it before each sign.

An unlock has its own request ID but must match the original peer, parent ID,
session and hash, while the parent awaits a PIN. The browser sets the unlock
deadline equal to the parent's deadline; the firmware also requires the parent
to remain live. Wrong PIN/validation failure terminates the parent; unmatched
unlock or cooldown refusal does not. Failed unlocks use exponential backoff
starting at two seconds and capped at 1,024 seconds.

### Responses and progress

Every response repeats `protocol`, `version`, `network`, `id`, `method`,
`psbt_hash`, and contains `result`, `error`, or `status` + `sequence`.
There is no `expires` field in the response. Use the original local deadline.

```json
{
  "protocol":"bitcoin-signer", "version":1, "network":"Testnet4",
  "id":"<original sign request ID>", "method":"sign_psbt",
  "psbt_hash":"<original hash>", "status":"PIN required", "sequence":2
}
```

| Sequence | Status text |
| --- | --- |
| 1 | `Ready to sign` |
| 2 | `PIN required` |
| 3 | `Decrypting wallet` |
| 4 | `Validating transaction` |
| 5 | `Ready to sign — approve on device` OR `Automatically approved` |
| 6 | `Signing` |
| 7 | `Signing complete` |

Ignore older/duplicate sequences and never extend deadlines on progress. Even
sequence 7 is not final success; only `result.psbt` is. Match all binding fields
and signer identity before accepting any status/result/error. Error strings are
human-readable, not stable machine codes: examples include `busy`, `unauthorized`,
`Device restarted; reconnect first`, `PSBT hash mismatch`, and
`Device settings open; close Settings first`. Malformed/unauthenticated traffic
is ignored. Transport timeout can be ambiguous: a signature may have been made.
Check LNbits transaction state before creating a new request.

### Bounds, concurrency and replay

- Browser deadline: 150s; firmware accepts expiry strictly after now and at most
  now +180s. Event time must be between now −180s and now +30s.
- Maximum WebSocket frame 100,000 bytes; firmware ciphertext length ≤90,000;
  decrypted request ≤46,000; decoded PSBT ≤32 KiB. No fragmentation protocol.
- One active pairing/signing approval; unrelated concurrent work returns busy.
- Replay window stores 64 sender/request-ID pairs for 180s. Full means refuse
  new requests, never evict an unexpired entry. Eight latest encrypted replies
  are cached until request expiry; status replaces status and final replaces
  status. Duplicate delivery replays the cache, never decrypts PIN/signs again.
- In-memory replay state is not durable across process restart; the new boot
  session prevents an old signing/unlock request authorizing new signing.

## Bitcoin validation and approval policy

PSBT v0; transaction version 2, zero locktime, final sequences, SIGHASH_ALL,
≤32 inputs and ≤32 outputs. All inputs must belong to this BIP84 account.
Require full previous transactions and verify txids, output indices, amounts,
scripts, derivations and conflicting witness metadata. Verify change by script
and derivation, not a caller label. Reject pre-signed inputs, unsupported
metadata, foreign inputs, Taproot, multisig inputs and arbitrary scripts.
Recipients may be P2PKH/P2SH/P2WPKH/P2WSH. Reuse this restrictive policy for MVP.

Debit = recipient total + fee, excluding verified change. Automatic approval
requires both limits >0, debit **strictly below** the per-transaction threshold,
and UTC-day reserved total + debit ≤ daily limit; otherwise manual approval.
Every manual or automatic signature reserves usage durably before signing.
Never refund for crash, failure, timeout or delivery loss. New retries count
again; duplicate deliveries do not. Persist limits/day/total atomically, retain
the counter across limit edits/reboots, and fail closed on invalid storage,
save failure or time rollback. Defaults are zero (manual approval only).

Current firmware vault: PBKDF2-HMAC-SHA256, 210,000 rounds, random 16-byte salt,
AES-256-GCM with random 12-byte nonce. Settings credential is separate. This
format is not automatically the mobile storage design. Neither firmware nor
the mobile starter claims secure-element Bitcoin signing.

## Mobile architecture and lifecycle

Use React Native + TypeScript with Expo development builds, generating local
Android/iOS projects for Android Studio/Xcode. Keep protocol validation, request
state, storage, Bitcoin validation/signing and UI separate. Bundle dependencies
inside `mobile/`; do not import code from the ignored LNbits checkout.

The starter implements a deterministic in-memory request reducer and a plainly
labelled simulated manual-approval journey. It displays full fixture addresses,
amounts, fee/change, expiry, reject/lock outcomes, and the return-to-LNbits step.
Its demo unlock action represents LNbits delivering an authenticated unlock;
it never collects a real PIN or creates a signature. It has no relay connection.

For live MVP, preserve v1 remote PIN semantics to work with existing LNbits.
Local-only/biometric unlock would change that contract: negotiate a versioned
capability or update both ends, rather than silently skipping PIN required.
Use native OS-backed storage for the transport credential and a separately
encrypted Bitcoin vault; choose and validate native KDF/AEAD/key handling before
custody. Persist public account and peer records independently so locked account
retrieval works. Do not put keys/PINs in AsyncStorage, logs, analytics or clipboard.
JavaScript garbage collection cannot guarantee secret zeroization; production
key handling needs a reviewed native boundary. Exclude secrets from backups.

On inactive/background: obscure sensitive UI, cancel active review, close live
sockets and clear unlocked material. Foreground reestablishes connections; do
not resume approval automatically. Process restart rotates session. A future
push notification is only a wake hint; fetch and authenticate the request and
require live review. iOS/Android do not promise always-on relay sockets.

## Phased implementation and acceptance gates

| Phase | Deliverable | Exit test |
| --- | --- | --- |
| **0 — starter (this change)** | Expo TypeScript app, Testnet4-only simulated approval flow, request-bound reducer, local run guide | Type-check and both platform bundles pass; state tests cover stale actions, expiry, background lock, rejection and completion. Physical taps still require device testing. |
| **1 — first functional signing MVP** | Restore disposable 12/24-word wallet with checksum validation, confirm wallet/settings PINs, encrypted persistence, public account derivation; stable separate Nostr identity; secure relay configuration; QR/paste pairing and local peer confirmation; pair/revoke and get_account; real v1 sign/unlock/manual review/result | On both physical phones: restart, pair existing LNbits, auto-import matching descriptor, receive Testnet4 coins, sign one payment, verify and explicitly broadcast in LNbits. Reject and wrong-PIN paths pass. No automatic approval/background signing. |
| **2 — recovery and reliability** | Generate/verify recovery words, polished settings and peer management, multi-relay reconnect/retry/replay, migration/backup rules and durable accounting, offline/expiry recovery | Airplane mode, two-relay duplicates, process kill/background, revoked peer, wrong session, stale tap, oversized/hostile PSBT and storage failure all fail safely. Restore recovers same public account on each OS. |
| **3 — firmware feature parity** | Optional auto-approval thresholds, durable shared daily budget, richer request history without secrets | Strict threshold/equality, day rollover/clock rollback, reboot and failed delivery accounting pass; each signature still requires PIN. |
| **4 — release hardening** | Native custody review, dependency/security review, accessibility, release signing, optional authenticated wake notifications | Independent security review and release-device regression; no mainnet until explicitly scoped and reviewed. |

Implement Phase 1 in small vertical steps: (a) native vault + independently
checked public account vectors; (b) encrypted pair/get_account interoperability;
(c) constrained PSBT validation + full review; (d) sign/unlock/result and LNbits
verification/broadcast. Use audited Bitcoin/Nostr implementations; do not write
new cryptographic primitives. Every step remains manually testable. Minimal
replay/session/expiry protection is required in Phase 1; Phase 2 expands fault
testing and recovery rather than deferring these protections.

Deferred from MVP: balances/coin selection on phone, LNbits API credentials,
mainnet, additional accounts, passphrases, Taproot, multisig, hardware migration,
automatic broadcast, always-on background service, and store publication.

## Device test plan

See [mobile/README.md](../mobile/README.md) for local installation. Use disposable
Testnet4 funds and record OS, device, app commit, LNbits commit, relays and result.

1. Phase 0 on Android and iPhone: start demo, observe PIN-wait placeholder,
   simulate unlock, inspect every address/amount, approve; repeat with reject,
   expiry and Home/app switching. Confirm no actual signing/broadcast claim.
2. Phase 1: restore same fixture on each platform separately; compare descriptor,
   xpub and fingerprint with independently derived vectors. Reopen and verify
   credentials persist while Bitcoin wallet starts locked.
3. Pair LNbits → verify both displayed peer identity and account import. Cancel
   and expire pairing. Revoke and confirm the old peer cannot retrieve/sign.
4. Fund an address on Testnet4; construct a transaction with recipient + change.
   Verify full review and fee; approve; check signatures and unchanged unsigned
   transaction using LNbits, then explicitly broadcast and check confirmation.
5. Reject, wrong PIN, cooldown, deadline during KDF, wrong hash/session/peer,
   duplicate delivery, reconnect, background and restart. No stale approval,
   duplicate signature or automatic broadcast is allowed.

Current delivery validation is recorded in the mobile README. A JavaScript
bundle does not prove native compilation, key security or live interoperability.

## Platform references

- [Expo local builds with Android Studio and Xcode](https://docs.expo.dev/guides/local-app-overview/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [React Native security and sensitive storage](https://reactnative.dev/docs/security)
