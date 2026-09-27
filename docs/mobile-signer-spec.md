# Argus: current flow and mobile delivery specification

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

The phone now implements the complete payment workflow: Electrs-backed wallet
sync and history, fresh receive addresses, coin control, network-specific mempool.space
fee estimates, local PSBT construction, remote ESP32 signing, local signature
verification/finalization and separately confirmed in-app broadcasting. LNbits
is not a runtime dependency. PSBT import/export remains available as an optional
interoperability tool. The v0.2 remote-client checkpoint is commit `b62a140`;
the in-app wallet is v0.3.

## Network selection

Mainnet is the default for firmware builds and the mobile app (including an
upgrade with no saved network preference). Testnet4 remains available.
Firmware uses the build-only `[bitcoin] testnet4` flag in platformio.ini, with
`0` for Mainnet and `1` for Testnet4. On-device controls cannot change it.
Mobile uses Settings > Bitcoin network and never switches automatically to
match a device. Authenticated mismatches block signing and explain the fix.
See [protocol.md](protocol.md#bitcoin-network) for the response-binding exception
used only to report mismatch errors and the public-account refresh after a
firmware network change.

Switching the app network is disabled during signing/chain operations or
unresolved recovery. It closes the signer connection, clears in-memory wallet,
fees, selections and unsigned review, and requires reconnect. A signed payment
must have a verified recovery copy before switching. Saved cursors, history and
signed payments remain keyed by xpub, so the different BIP84 accounts cannot
share them; switching back and reconnecting restores the account's journal.
The existing pinned device xpub is retained; a different account requires
explicit pairing. The separate phone transport identity is retained.

Electrs settings are separate per network. Legacy server preferences belong to
Testnet4; Mainnet defaults to `ssl://mempool.space:50002`, Testnet4 to
`ssl://mempool.space:40002`. Every connection checks the selected genesis before
queries or broadcast. Fee endpoints are `/api/v1/fees/recommended` for Mainnet
and `/testnet4/api/v1/fees/recommended` for Testnet4 on mempool.space. No fallback
crosses networks. Explicit user-confirmed broadcast remains mandatory.

## Current system and trust boundaries

| Component | Responsibility / retained information |
| --- | --- |
| ESP32 signer | Bitcoin seed in PIN-encrypted vault; independent Nostr secret; public account; paired browser keys; approval policy and daily reservations |
| LNbits browser | Separate Nostr secret and connection data scoped to user/wallet; pending PSBT and transient wallet PIN; authenticates signer responses |
| LNbits server | Public wallet, chain/explorer access, UTXOs, PSBT construction, signature verification/finalization and explicit broadcast; does not receive the remote wallet PIN |
| Mobile wallet | Independent secure Nostr identity; public account/address cursors; verified UTXOs; local transaction construction/finalization; signed-payment recovery; explicit broadcast |
| Configured Electrs | Electrum 1.4 TCP/TLS endpoint for history, UTXOs, full previous transactions and broadcast; sees wallet script hashes and transaction bytes |
| mempool.space | Selected-network fee-rate recommendations only; receives no wallet/account data |
| Nostr relays | Carry signed encrypted events; see author, recipient, time, size and traffic patterns; not trusted for authorization or delivery |

Bitcoin and Nostr keys are independent. This protocol is project-specific v1,
**not NIP-46**. NIP-44 provides ciphertext authentication but neither forward
secrecy nor routing privacy. The signer validates supplied previous transactions;
it cannot prove inputs remain unspent without chain access. Mainnet and Testnet4; Mainnet is the default.

Source of truth: `src/main.cpp` (screens), `src/engine.cpp` (orchestration),
`src/protocol_state.h` (freshness/replay/session checks), `src/wallet.h`,
`src/validation.h`, `src/signing.h`, `src/device_settings.h`, and
`src/approval_policy.h`. The locally included, separately managed LNbits checkout
contains `../lnbits/lnbits/onchain/static/js/nostr-signer-client.js`,
`static/components/nostr-signer.js`, `static/components/payment.js`, and `psbt.py`
under its onchain directory. It is a separate sibling repository, so mobile code
must not depend on that checkout being installed. See also [protocol.md](protocol.md).

## Existing ESP32 / LNbits reference journey (Testnet4 example)

1. **Provision:** create a 6–32 digit settings PIN. Continue wallet setup;
   generate 12 words and verify each word from four choices, or restore a valid
   12/24-word BIP39 phrase. Set and confirm a separate 6–32 digit wallet PIN.
   Optional Generate wallet → Advanced → Add dice rolls uses 50–256 physical
   die results, with no device randomness: SHA-256 of the ordered ASCII digits
   (no separators), first 16 bytes → English BIP39. The same sequence reproduces
   the same phrase; see [README](../README.md#optional-dice-generation).
   Account is native SegWit `m/84'/0'/0'` on Mainnet or `m/84'/1'/0'` on Testnet4, no BIP39 passphrase.
2. **Connect:** Settings requires the settings PIN. Network settings opens a
   temporary password-protected Wi-Fi AP, with credentials/QR and
   `http://192.168.4.1/`. Scan/select Wi-Fi (or enter manually), enter its password
   and 1–3 secure relays. Save closes the portal; cancel or ten minutes also
   closes it. Default relay: `wss://relay.nostrconnect.com`. Device validates TLS
   and waits for synchronized time. Wi-Fi reconnect attempts occur every 15s.
3. **Pair:** open a Testnet4 onchain wallet in LNbits and choose Nostr signer.
   Open Settings → Connect Remote Client on the device. Scan/paste the pairing JSON
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
expires after one minute without touchscreen activity while the configuration portal is inactive, or immediately on close;
signing cannot interrupt an open settings session. Revocation rejects future
requests and cancels pending work from that client. Forgetting browser storage
does not revoke the device pairing. Old approval callbacks are request-ID-bound.

Settings → Display stores brightness (10–100%), display timeout (15/30/60/120/300
seconds), a Disable timeout checkbox, and Light/Dark theme. Save applies the
preferences and retains them across reboot. Defaults are full brightness,
30 seconds with timeout enabled, and Light. Display timeout is independent of
settings authorization and recovery-phrase expiry; disabling it does not extend
either security limit. These preferences are local-only and add no wire methods.

Settings → Keys → View recovery phrase is a local-only viewer for the stored
12/24-word phrase. It requires settings authorization plus a fresh wallet-PIN
verification using the shared wallet attempt counter/cooldown. It does not open
signing keys. Hide/Done and screen changes clear the owned display buffer; a
60-second maximum reveal time hides it and requests Settings closure independently
of touchscreen activity. There is no corresponding remote method.

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
Descriptor form for Testnet4: `wpkh([fingerprint/84h/1h/0h]tpub.../<0;1>/*)#checksum`;
Mainnet uses `84h/0h/0h` and `xpub` instead.
The session is a boot freshness challenge, not a secret, and does not change
on wallet lock/unlock. Fetch it before each sign.

An unlock has its own request ID but must match the original peer, parent ID,
session and hash, while the parent awaits a PIN. The browser sets the unlock
deadline equal to the parent's deadline; the firmware also requires the parent
to remain live. Wrong PIN/validation failure terminates the parent; unmatched
unlock or cooldown refusal does not. Failed unlocks use exponential backoff
starting at two seconds and capped at 1,024 seconds, reapplied on restart.
Separate persistent settings-PIN and wallet-PIN counters wipe all device NVS on
the 16th failed verification. Successful verification resets only its counter;
interrupted checks consume an attempt. Failure messages show attempts remaining
before wipe locally and, for remote unlocks, in bound signing/unlock errors.
Validation/signing errors do not count as PIN failures. See [protocol.md](protocol.md)
for erasure and storage-failure behavior.

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

Manual-approval status 5 may include an authenticated `reason` string describing
the exceeded limit or disabled automatic approval. Updated LNbits displays it with
“Waiting for on device approval”; existing mobile clients retain the status text.

Ignore older/duplicate sequences and never extend deadlines on progress. Even
sequence 7 is not final success; only `result.psbt` is. Match all binding fields
and signer identity before accepting any status/result/error. Error strings are
human-readable, not stable machine codes: examples include `busy`, `unauthorized`,
`Device restarted; reconnect first`, `PSBT hash mismatch`, and
`Device settings open; close Settings first`. Malformed/unauthenticated traffic
is ignored. Transport timeout can be ambiguous: a signature may have been made.
Check device and transaction state before creating a new request.

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
the phone disconnects; check device and chain state before starting a new request.

`mobile/src/storage.ts` stores the independent Nostr private key using Expo
SecureStore (iOS Keychain / Android Keystore-backed storage) with unlocked,
this-device-only iOS accessibility. Connection information and the pinned xpub
are saved separately. Pairing tokens, PINs and PSBTs are not persisted in connection storage.
The wallet separately preserves verified signed payments for recovery, below.
The candidate connection is saved before requesting pairing, so a local storage
interruption after device approval can be recovered with Reconnect. Forgetting
local state rotates the phone identity but does not revoke the old identity on
the ESP32; the user must revoke it in device Settings → Paired browsers.

`mobile/src/bitcoin.ts` validates public account structure and network-matched BIP84 xpub/tpub,
derives public BIP84 addresses, parses bounded PSBT v0, verifies full
previous transactions and account derivations, computes fee/debit and recognizes
owned outputs. The ESP32 remains the authoritative transaction validator. On
return, the client compares the entire unsigned transaction, requires one
SIGHASH_ALL signature from the expected account key on every input, verifies
ECDSA against the **original** UTXOs and returns the original maps plus only
those verified signatures. Returned metadata cannot change the reviewed PSBT.

`ClientProvider.tsx`, `WalletProvider.tsx`, `screens.tsx` and `BroadcastPanel.tsx` provide pairing, server
preferences, account retrieval, wallet sync, receive/send, coin control, fees,
transaction review, authenticated PIN handling, recovery and explicit broadcast.
Approval/rejection and device settings stay on ESP32.

### In-app chain backend and wallet construction

The user saves an Electrum-protocol endpoint, `ssl://host:port` or
`tcp://host:port`. This is a direct Electrs connection, not an Esplora HTTP URL.
TLS requires a system-trusted certificate and matching hostname; TCP is for a
trusted local network and exposes queries. `react-native-tcp-socket` 6.4.3 has a
pinned postinstall Android patch for hostname verification and SNI. No certificate
bypass is exposed. iOS uses native peer-name/trust verification. Physical TLS
negative tests remain an acceptance gate.

Each new connection negotiates Electrum 1.4 and retrieves `blockchain.block.header`
at height 0. The phone double-SHA256 hashes the 80-byte header and requires
`00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043`
for Testnet4, or
`000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f`
for Mainnet, before wallet requests or broadcast. Testnet4, Testnet3 and Signet share address
formats, so address validation alone is insufficient. This check catches wrong
network configuration; it is not chain/SPV validation. Electrs remains trusted
for completeness, unspent status and confirmations.

`electrum.ts` frames JSON-RPC 2.0 as newline-delimited JSON, matches monotonically
increasing request IDs and rejects malformed/oversized replies (2.1 MB maximum).
Connection and request deadlines are 15 seconds; at most 16 RPC calls can be
pending. Disconnection rejects all pending work. No request, especially a
broadcast, is automatically retried.

`wallet.ts` derives account branches 0 and 1, computes Electrum script hashes
(SHA256 of scriptPubKey, reversed), and queries `blockchain.scripthash.get_history`
and `listunspent`. Discovery continues through 20 consecutive unused addresses
past both observed usage and locally issued indices. It stops with an error,
not a partial spendable balance, if 1,000 addresses per branch, 1,000 coins or
2,000 unique history entries would be exceeded. History displays its latest
50 entries with server-reported confirmations. Full previous transaction data
from `blockchain.transaction.get` is checked against txid, vout, value and owned
script before a coin enters the wallet snapshot. Immature coinbase is displayed
but never selected; unconfirmed spend requires explicit opt-in.

Receive and change cursors are monotonic and scoped to the xpub in SecureStore.
Save before displaying a fresh receive address or exposing a prepared change
address. At most 20 unused addresses may be issued beyond the last observed
usage. Forgetting a device pairing retains these cursors. App deletion/storage
loss and another wallet issuing beyond the gap can still require external
recovery; the scanner does not claim unbounded wallet discovery.

Automatic selection chooses largest eligible coins first, up to 32. Manual coin
control spends exactly the selected outpoints and rejects stale/missing/duplicate
selections. Send-max deducts the fee from their sum. Amounts use bigint satoshis;
fee rates use integer thousandths of sat/vB. Fee sizing uses conservative native
SegWit witness lengths, actual recipient script sizes and change. Change below
294 sats is omitted and included in the displayed fee; recipient dust checks
also reflect script type. The final signed transaction shows actual vsize and
fee rate. Construction includes full `nonWitnessUtxo`, matching `witnessUtxo`,
BIP84 derivations and SIGHASH_ALL, then runs the existing PSBT validator. Firmware
v1 still requires version 2, locktime 0, final sequences (no RBF), <=32 inputs/
outputs, 32 KiB unsigned PSBT and supported scripts. Imported PSBT broadcast
also uses the 1,000-address derivation bound.

Selected coins are rechecked against Electrs before construction, and every
input is rechecked before broadcast. A five-minute-old wallet snapshot must be
resynced before construction. These checks reduce stale-input errors but cannot
remove the race with another spender; server rejection/uncertainty is surfaced.

### Fee recommendations

`fees.ts` calls the selected network endpoint only:
`https://mempool.space/api/v1/fees/recommended` on Mainnet or
`https://mempool.space/testnet4/api/v1/fees/recommended` on Testnet4, with a 10-second timeout.
It validates numeric, positive, ordered `fastestFee`, `halfHourFee`, `hourFee`,
`economyFee`, and `minimumFee` fields and records retrieval time. The UI offers
those target estimates plus an explicit manual sat/vB field (0.001–10,000).
No wallet information is sent to mempool.space. Fee lookup failure is visible,
not silently replaced with another network or old data. Selected estimates older than
five minutes must be refreshed or deliberately replaced by a manual rate.
Targets are estimates, not confirmation guarantees.

### Finalization, broadcast and recovery

Only signature-verified original PSBT maps are finalized locally. Display the
locally computed txid, actual vsize, fee, debit and recipients before a separate
**Broadcast transaction** confirmation. The phone first looks up that exact txid,
checks unspent inputs if unknown, then calls `blockchain.transaction.broadcast`
with the verified raw transaction. A successful reply must equal the local txid.
Only a user action can start this submission; reconnect, signing success and
status checks never broadcast automatically.

`wallet-storage.ts` preserves the original and verified signed PSBT, timestamp,
and state (`ready`, `unknown`, `submitted`) in an account-scoped two-slot app
document journal, with its active-slot pointer in SecureStore. Write and verify
the inactive slot before switching the pointer, retaining the prior complete
record if a write fails. An interrupted first save blocks a replacement instead
of appearing empty. This is public transaction data, not Bitcoin private material. Revalidate
transaction identity/signatures when loading. Before broadcasting, save and
read back an `unknown` recovery state; after a matching reply, save `submitted`.
A write failure prevents starting the broadcast. Transport failure, lost reply,
backgrounding or restart must not imply that the transaction was not sent.
Restore after reconnecting to the same account, check the exact txid, and retry
only those same bytes after explicit action. Acceptance is not confirmation;
wallet sync supplies history/confirmation status. New payment preparation is
disabled while a signed payment is retained, until the user explicitly clears
it after reviewing transaction state. A malformed recovery record blocks new
payments until deliberately cleared; the app does not silently discard it.
No LNbits API, finalizer, explorer or broadcaster is needed in this flow.

On inactive/background, close sockets, stop request retries, invalidate stale UI
callbacks, obscure content, and clear PIN/pairing text. Do not resume pending
approval automatically. Public review/output can remain in memory so file
sharing is usable, and verified signed-payment recovery remains on disk. File exports are temporary and removed when sharing ends.
CSPRNG bytes come from Expo Crypto before Nostr dependencies initialize. Never
log PINs/keys or use Math.random. JavaScript cannot guarantee erasure of every
string copy; make no native-memory zeroization claim for this client.

## Corrected phases and acceptance gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| **1 — remote client MVP (implemented)** | Real QR/paste pairing, secure transport identity, public account, PSBT import/review, encrypted sign/unlock, progress, verified signed PSBT export | Automated real-crypto protocol/Bitcoin tests, typecheck/lint and Android/iOS bundles; physical ESP32 + Android/iPhone round trip still required |
| **2 — independent mobile wallet (implemented)** | Direct Electrs sync/history, fresh addresses, coin control, mempool.space fees, local PSBT construction/finalization, explicit broadcast and restart recovery | Automated wallet/backend tests and native build; physical end-to-end payment on both phones with conflict/fee/error handling remains required |
| **3 — reliability and release** | More relay fault testing, accessibility, optional authenticated notifications, app signing/release review | Device background/expiry/reconnect tests, storage migrations and security review |

Out of scope: Bitcoin custody on the phone; remotely changing ESP32 settings,
pairing approval, policy or revocation (v1 exposes none); automatic
broadcast; always-on background signing; Taproot/multisig inputs.

## Physical acceptance checklist

Verify Mainnet/Testnet4 selection persists after restart, account/fee/history
state resets on switching, and returning to an account restores its signed
payment. Check both mismatch directions block signing before PIN entry. Use
a Testnet4 firmware build and app setting for disposable-fund payment tests.

1. Open ESP32 Settings → Connect Remote Client. Scan its QR from the phone or paste the
   JSON. Confirm the phone's displayed key on the ESP32 and approve there.
2. Verify the descriptor/xpub/fingerprint against the device/LNbits account.
   Restart the phone and reconnect; the client key and pairing should survive.
   Reboot ESP32 and sign again to test automatic fresh-session retrieval.
3. Configure Testnet4 Electrs in the app. Receive disposable test coins, sync
   both branches, choose coins/recipient/amount and a mempool.space or manual
   fee rate. Prepare the PSBT in-app. Also exercise optional PSBT file import.
4. Review full recipients, amounts, owned outputs, fee and debit. Request device
   signing; PIN entry must appear only after the authenticated PIN-required status.
5. Enter the **wallet** PIN on the phone. Review and approve/reject on ESP32.
   Verify and finalize on the phone, then explicitly confirm in-app broadcast.
   Compare the txid on Electrs and sync confirmations. Drop the broadcast reply,
   restart/reconnect, restore the signed record and check/retry the same txid.
6. Exercise wrong PIN/cooldown, rejection, revoked pairing, offline relays,
   deadline expiry, backgrounding, restart, changed device account, malformed
   PSBT and duplicate relay deliveries. Stopping the phone is not remote cancel.
7. Verify denied camera permission falls back to paste, binary/base64 PSBT file
   import works, signed PSBT sharing works, and PIN is absent after backgrounding.

Automated tests do not establish real ESP32 interoperability or physical-device
UI behavior. Record actual device/OS/firmware/app versions when completing these
gates. See [mobile/README.md](../../mobile/README.md) for build and test instructions.

## References

- [Expo local builds](https://docs.expo.dev/guides/local-app-overview/)
- [React Native security](https://reactnative.dev/docs/security)
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
- [bitcoinjs-lib](https://github.com/bitcoinjs/bitcoinjs-lib)
- [Electrum protocol methods](https://electrum-protocol.readthedocs.io/en/latest/protocol-methods.html)
- [Bitcoin Core Testnet4 chain parameters](https://github.com/bitcoin/bitcoin/blob/master/src/kernel/chainparams.cpp)
- [mempool.space API](https://mempool.space/docs/api/rest)
- [React Native TCP/TLS module](https://github.com/Rapsssito/react-native-tcp-socket)

## Consumer wallet navigation — v0.4

Expo Router routes under `mobile/src/app/` provide Wallet, Activity and Settings
bottom tabs. Wallet shows balance, Send/Receive shortcuts, a saved-payment entry
and recent activity. Receive displays a QR code and copy/share actions. Send
collects recipient and amount, with separate fee and coin-control screens, then
opens payment review, device PIN/approval and explicit **Send payment** confirmation.
Activity provides progressively loaded transactions with expandable identifiers.

Device pairing lives only in Settings → Signing device. Server configuration is
Settings → Wallet server. Public account details and PSBT import/export are
Settings → Advanced tools. Full pairing verification codes appear only while
pairing. Normal screens never display Nostr/relay/protocol diagnostics, engineering
notes, conversation history or implementation/testing caveats. The selected Bitcoin network remains
visible on wallet, receive, review and broadcast screens. Backend errors are translated into actionable
wallet messages without echoing arbitrary server text.

Shared providers preserve public wallet state, selections and prepared payments
across navigation. Navigating between pages does not duplicate a signing request.
Backgrounding invalidates active operations, closes connections, clears PIN and
pairing input, and covers the UI. Returning never resumes signing or broadcasting
automatically. Signed-payment recovery, explicit send confirmation, account
pinning and the existing wire contract remain unchanged.
