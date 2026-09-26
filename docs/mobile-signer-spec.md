# Remote Bitcoin Signer: current flow and mobile delivery specification

Status: corrected client implementation, 26 September 2026. The phone controls
the existing ESP32 signer. The earlier phone-as-signer proposal and simulation
were incorrect and are superseded by this specification.

## Product direction

The Android/iOS app occupies the same protocol role as the LNbits browser:
**it is the remote client, not the Bitcoin signer**. The ESP32 retains the seed,
wallet vault, settings PIN, validation, signing and approval policy. The phone
has only its own independent Nostr transport identity and public account data.
It sends the wallet PIN to the ESP32 only in the existing encrypted, request-bound
`unlock` message. No Bitcoin wallet creation, restoration or local signing exists.

The first functional client MVP imports an unsigned Testnet4 PSBT prepared by
LNbits, reviews it, requests an ESP32 signature, collects the requested wallet
PIN, follows authenticated progress, verifies the returned signatures and
exports the signed PSBT. LNbits remains responsible for transaction preparation,
finalization and an explicit broadcast. This phase does not replicate LNbits'
balances, UTXO discovery, coin selection or transaction builder inside the phone.

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
format belongs to the ESP32; the phone stores no Bitcoin vault.

## Mobile client architecture and lifecycle

`mobile/src/client.ts` owns the real Nostr connection: bounded secure pairing
JSON, event signatures, NIP-44 encryption, exact response binding, authenticated
progress, identical-event multi-relay retry every five seconds, reconnect,
150-second deadlines, per-operation concurrency and request-bound PIN handling.
Every sign fetches the device's current session. The previously paired xpub is
pinned; a changed account requires deliberate re-pairing. Closing the phone's
client only stops local waiting: v1 has **no remote cancel/lock/approve method**.
The UI must never imply otherwise. An ESP32 request may still complete after
the phone disconnects; check device/LNbits state before starting a new request.

`mobile/src/storage.ts` stores the independent Nostr private key using Expo
SecureStore (iOS Keychain / Android Keystore-backed storage) with unlocked,
this-device-only iOS accessibility. Connection information and the pinned xpub
are saved separately. Pairing tokens, PINs and PSBTs are not persisted there.
The candidate connection is saved before requesting pairing, so a local storage
interruption after device approval can be recovered with Reconnect. Forgetting
local state rotates the phone identity but does not revoke the old identity on
the ESP32; the user must revoke it in device Settings → Paired browsers.

`mobile/src/bitcoin.ts` validates public account structure and Testnet BIP84 xpub,
derives a labelled index-0 receive address, parses bounded PSBT v0, verifies full
previous transactions and account derivations, computes fee/debit and recognizes
owned outputs. The ESP32 remains the authoritative transaction validator. On
return, the client compares the entire unsigned transaction, requires one
SIGHASH_ALL signature from the expected account key on every input, verifies
ECDSA against the **original** UTXOs and returns the original maps plus only
those verified signatures. Returned metadata cannot change the reviewed PSBT.

`App.tsx` implements pairing QR/paste, client key comparison, reconnect, public
account display/share, unsigned PSBT paste/file import, recipient/change/fee
review, Request signature, authenticated PIN entry and progress, and signed
PSBT copy/file sharing. Approval/rejection and device settings stay on ESP32.
The index-0 receive address is a reference, not a fresh-address allocator.

On inactive/background, close sockets, stop request retries, invalidate stale UI
callbacks, obscure content, and clear PIN/pairing text. Do not resume pending
approval automatically. Public review/output can remain in memory so file
sharing is usable. File exports are temporary and removed when sharing ends.
CSPRNG bytes come from Expo Crypto before Nostr dependencies initialize. Never
log PINs/keys or use Math.random. JavaScript cannot guarantee erasure of every
string copy; make no native-memory zeroization claim for this client.

## Corrected phases and acceptance gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| **1 — remote client MVP (implemented)** | Real QR/paste pairing, secure transport identity, public account, PSBT import/review, encrypted sign/unlock, progress, verified signed PSBT export | Automated real-crypto protocol/Bitcoin tests, typecheck/lint and Android/iOS bundles; physical ESP32 + Android/iPhone round trip still required |
| **2 — wallet convenience** | Optional LNbits API integration or explicit Testnet4 chain backend for balances, fresh receive addresses, UTXO selection, payment/fee construction and explicit broadcast | End-to-end payment on both phones with double-spend/fee/error handling and no automatic broadcast |
| **3 — reliability and release** | More relay fault testing, accessibility, optional authenticated notifications, app signing/release review | Device background/expiry/reconnect tests, storage migrations and security review |

Out of scope: Bitcoin custody on the phone; remotely changing ESP32 settings,
pairing approval, policy or revocation (v1 exposes none); mainnet; automatic
broadcast; always-on background signing; Taproot/multisig inputs.

## Physical acceptance checklist

1. Open ESP32 Settings → Pair a browser. Scan its QR from the phone or paste the
   JSON. Confirm the phone's displayed key on the ESP32 and approve there.
2. Verify the descriptor/xpub/fingerprint against the device/LNbits account.
   Restart the phone and reconnect; the client key and pairing should survive.
   Reboot ESP32 and sign again to test automatic fresh-session retrieval.
3. Build a disposable Testnet4 payment in LNbits including full previous
   transactions. Export its unsigned PSBT and import/paste into the phone.
4. Review full recipients, amounts, owned outputs, fee and debit. Request device
   signing; PIN entry must appear only after the authenticated PIN-required status.
5. Enter the **wallet** PIN on the phone. Review and approve/reject on ESP32.
   Verify the returned PSBT on the phone, export to LNbits, and broadcast there
   explicitly after its own verification/finalization.
6. Exercise wrong PIN/cooldown, rejection, revoked pairing, offline relays,
   deadline expiry, backgrounding, restart, changed device account, malformed
   PSBT and duplicate relay deliveries. Stopping the phone is not remote cancel.
7. Verify denied camera permission falls back to paste, binary/base64 PSBT file
   import works, signed PSBT sharing works, and PIN is absent after backgrounding.

Automated tests do not establish real ESP32 interoperability or physical-device
UI behavior. Record actual device/OS/firmware/app versions when completing these
gates. See [mobile/README.md](../mobile/README.md) for build and test instructions.

## References

- [Expo local builds](https://docs.expo.dev/guides/local-app-overview/)
- [React Native security](https://reactnative.dev/docs/security)
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib)
