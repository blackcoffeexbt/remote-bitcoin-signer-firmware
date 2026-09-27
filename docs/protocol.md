# Experimental Bitcoin signer protocol v1

This is a project-specific protocol, not NIP-46. Both directions use signed NIP-01 events of kind `24134`, with exactly one `p` tag containing the recipient's 64-character lowercase hex Nostr public key. The event content is NIP-44 v2 encrypted JSON. Never send a Bitcoin seed. A PIN is accepted only in a NIP-44 encrypted `unlock` request from the paired browser owning the active signing request. Bitcoin and Nostr identities are separate.

Validate the event hash, Schnorr signature, author, recipient, kind and timestamps before decrypting. Firmware only accepts unpaired senders while its local pairing window is open. NIP-44 authenticates ciphertext; it does not conceal routing metadata from relays or provide forward secrecy.

## Request

```json
{
  "protocol": "bitcoin-signer",
  "version": 1,
  "network": "Testnet4",
  "id": "32 lowercase hex characters from 16 random bytes",
  "method": "sign_psbt",
  "expires": 1800000150,
  "psbt_hash": "64 lowercase hex SHA-256 of original decoded PSBT bytes",
  "params": {
    "session": "device session from get_account",
    "psbt": "base64 encoded unsigned PSBT"
  }
}
```

Generate and sign a request once, then publish that same event to every relay. Republish the identical event every five seconds until completion or expiry, as ephemeral relays cannot deliver requests sent while the device is offline. The browser uses a 150-second deadline. Firmware rejects expired requests, deadlines more than 180 seconds away, events older than 180 seconds and event timestamps more than 30 seconds ahead. A synchronized device clock is required.

Methods:

| Method | Parameters | Result |
| --- | --- | --- |
| `pair` | `token`, printable `label` (1–40 characters) | Public account after local approval |
| `get_account` | Empty object; paired clients only | `descriptor`, `xpub`, `fingerprint`, `path`, `session` |
| `sign_psbt` | `session`, base64 `psbt`; paired clients only | Progress events, then `{ "psbt": "signed PSBT base64" }` after remote PIN unlock and local or policy approval |
| `unlock` | `session`, `request_id` of active signing request, `pin` (6–32 digits); same paired client and `psbt_hash` as signing request | `{}` after successful unlock and validation; errors terminate the signing request except unmatched requests or cooldown refusals |

For pair/account requests, `psbt_hash` is an empty string. The device session changes on reboot and remains stable across wallet locks/unlocks. Clients retrieve it automatically before each signing request. Public account retrieval works while the wallet is locked. It is a freshness challenge, not a secret.

The device's QR contains JSON with `protocol`, `version`, `pubkey`, `token` (16 random bytes as hex), and `relays`. It expires after three minutes. Local confirmation consumes the pairing token. Browser storage retains only its separate transport identity and connection information, scoped to the LNbits user/wallet.

## Progress and remote PIN

Signing first emits `Ready to sign` (sequence 1), then `PIN required` (2). The client keeps the original signing promise pending and shows PIN entry only after the authenticated status arrives. The `unlock` request has its own unique ID and binds `params.request_id`, `params.session`, sender and `psbt_hash` to the active signing request. Its deadline cannot extend the original signing deadline. Duplicate unlock deliveries never repeat decryption. Failed unlocks use the same exponential cooldown as local unlocks.

Further statuses are `Decrypting wallet` (3), `Validating transaction` (4), `Ready to sign — approve on device` (5) or `Automatically approved` (5), `Signing` (6), and `Signing complete` (7). Status messages carry the original signing response binding fields plus `status` and integer `sequence`, without `result` or `error`. Clients ignore duplicate/older sequences and do not reset the deadline. Only the final `result` settles signing successfully. All statuses are signed and encrypted like other responses. The latest status replaces the previous cached reply for that request; the final result replaces the status.

## Response

Responses repeat `protocol`, `version`, `network`, `id`, `method`, and `psbt_hash`, and contain either `result` or a human-readable `error`. Clients must match all binding fields and the device's signing identity, then still verify the returned PSBT against the original unsigned transaction. Never infer approval from relay acknowledgement or broadcast automatically.

The device keeps a bounded 180-second replay window of 64 sender/request-ID pairs. It refuses additional requests rather than evict an unexpired ID. The eight most recent encrypted replies are cached until their request deadlines and republished on reconnect or duplicate delivery. A request outside that reply cache can time out but cannot be approved twice. Retry a failed payment only after reviewing current LNbits transaction state.

Revocation rejects future requests and cancels a pending request from that client. Locking cancels pending approval and clears the unlocked Bitcoin account. Relay transport remains available using a separately persisted Nostr identity. Every signing request starts locked, and Bitcoin keys are cleared before publishing the signed result, or on rejection, failure or expiry. Recovery phrases and PINs are cleared after use; only public wallet metadata and the independent transport identity remain available. Existing vaults need one local unlock to provision this transport/public metadata without changing their identity or pairings. Approval callbacks bind to the active request ID, so an old UI action cannot approve another transaction.

## Resource and transaction limits

See README for wallet/PSBT limits. Relay WebSocket frames are bounded to 100,000 bytes before JSON processing. Firmware limits decrypted requests to 46,000 bytes; PSBTs use the bounded, short-message NIP-44 representation. Oversized transactions are rejected, not fragmented. Configure relays that permit these frame sizes.

LNbits' `CreatePsbt` accepts an optional `include_non_witness_utxo` boolean (default `false`). The Nostr integration sets it to `true`; existing hardware signers retain their compact PSBT behavior.

## Settings authentication and approval policy

Settings are local-only and protected by a separate settings PIN (6–32 digits), using an independently salted credential stored outside the wallet vault. Settings authentication never decrypts Bitcoin keys. Existing devices without a settings credential require one local wallet-PIN verification before creating it. New devices set the settings PIN during initial setup. Pairing, revocation, network changes and policy changes require settings authentication; signing requests cannot interrupt an open Settings session. Settings closes and clears settings authorization after one minute without touchscreen activity, including PIN entry and scrolling. This timeout is suspended while the configuration portal is active; closing the portal starts a fresh minute. The portal retains its own ten-minute lifetime.

After wallet PIN unlock and full PSBT validation, compute debit as recipient outputs plus the fee, excluding verified change. Automatic approval requires both nonzero configured limits, debit strictly below the per-transaction threshold, and today's reserved total plus debit no greater than the daily limit. Other transactions require touchscreen review and approval. All requests still require the wallet PIN and all terminal signing paths clear Bitcoin keys.

The global UTC-day counter includes both automatic and manual approvals. Persist the reservation atomically with the limits and day in NVS before producing a signature. Never refund on a timeout, crash, signing error, or failed result delivery. Reload this record on reboot; limit edits retain the counter. A new UTC day starts a new counter, using the synchronized device clock; a day earlier than the stored day is rejected for accounting. Invalid records and failed saves stop signing. The same request's replay handling prevents duplicate reservations; a new request, replacement or retry is counted separately. Broadcast confirmations are not used for accounting.

## PIN attempts and automatic device wipe

Settings PIN and wallet decryption have independent, persistent counters. Local
and remote wallet unlocks share the wallet counter. The 16th failed verification
(more than 15 failures) triggers erasure of the entire NVS partition and reboot
into setup: wallet vault, settings PIN, Nostr identity, pairings, network settings,
approval policy and counters are removed. Recovery requires the recovery phrase.
This also erases any legacy configuration in other NVS namespaces.

Each attempt is saved before credential verification; interrupted checks consume
an attempt. Successful credential verification resets only that credential's
counter. Failed writes stop authentication. Exhausted counters found on boot
trigger erasure before connections or authentication. Failed erasure keeps the
device locked and retries; it never returns to normal operation.

Failure messages include the number of attempts remaining before wipe (15 after
the first failure, 1 after the fifteenth). Settings failures appear on the device;
remote wallet failures are sent in both the bound signing and unlock errors and
shown locally. The final wipe notice is shown locally; relay delivery is best
effort and does not delay erasure. Exponential cooldown remains 2–1,024 seconds
and is reapplied on reboot. Cooldown refusals, unmatched/unauthenticated requests,
replays and errors after credential verification do not consume PIN attempts.
Malformed or damaged credentials that fail verification do consume attempts.

Manual-approval progress retains `Ready to sign — approve on device` at sequence 5
and adds an optional authenticated `reason` string (at most 256 characters).
Updated LNbits displays the reason followed by `Waiting for on device approval`.
Older clients can continue displaying the original status. Reasons distinguish a debit meeting/exceeding
the per-transaction limit, exceeding the remaining daily allowance, both limits,
or disabled automatic approval. Debit includes the fee. The same reason appears
on the device review. LNbits displays the authenticated reason as plain text; signing
remains pending until device approval and the final signed result.

## Local recovery phrase viewer

Settings → Keys → View recovery phrase is device-only and introduces no wire
method. It requires the settings PIN and a fresh wallet-PIN check, sharing the
wallet failure counter, cooldown and wipe policy. It displays the stored 12/24
words without opening signing keys. Display material is cleared on Hide/Done,
screen exit or the 60-second reveal timeout. Remote clients cannot request the
phrase, and signing remains blocked while Settings is open.
