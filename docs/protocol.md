# Experimental Bitcoin signer protocol v1

This is a project-specific protocol, not NIP-46. Both directions use signed NIP-01 events of kind `24134`, with exactly one `p` tag containing the recipient's 64-character lowercase hex Nostr public key. The event content is NIP-44 v2 encrypted JSON. Do not send a Bitcoin seed or PIN in a message. Bitcoin and Nostr identities are separate.

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

Generate and sign a request once, then publish that same event to every relay. The browser uses a 150-second deadline. Firmware rejects expired requests, deadlines more than 180 seconds away, events older than 180 seconds and event timestamps more than 30 seconds ahead. A synchronized device clock is required.

Methods:

| Method | Parameters | Result |
| --- | --- | --- |
| `pair` | `token`, printable `label` (1–40 characters) | Public account after local approval |
| `get_account` | Empty object; paired clients only | `descriptor`, `xpub`, `fingerprint`, `path`, `session` |
| `sign_psbt` | `session`, base64 `psbt`; paired clients only | `{ "psbt": "signed PSBT base64" }` after local approval |

For pair/account requests, `psbt_hash` is an empty string. The device session changes on each unlock, including after reboot; reconnect before signing. It is a freshness challenge, not a secret.

The device's QR contains JSON with `protocol`, `version`, `pubkey`, `token` (16 random bytes as hex), and `relays`. It expires after three minutes. Local confirmation consumes the pairing token. Browser storage retains only its separate transport identity and connection information, scoped to the LNbits user/wallet.

## Response

Responses repeat `protocol`, `version`, `network`, `id`, `method`, and `psbt_hash`, and contain either `result` or a human-readable `error`. Clients must match all binding fields and the device's signing identity, then still verify the returned PSBT against the original unsigned transaction. Never infer approval from relay acknowledgement or broadcast automatically.

The device keeps a bounded 180-second replay window of 64 sender/request-ID pairs. It refuses additional requests rather than evict an unexpired ID. The eight most recent encrypted replies are cached until their request deadlines and republished on reconnect or duplicate delivery. A request outside that reply cache can time out but cannot be approved twice. Retry a failed payment only after reviewing current LNbits transaction state.

Revocation rejects future requests and cancels a pending request from that client. Locking cancels pending approval, disconnects relays, and clears the unlocked Bitcoin account and Nostr secrets. Approval callbacks bind to the active request ID, so an old UI action cannot approve another transaction.

## Resource and transaction limits

See README for wallet/PSBT limits. Relay WebSocket frames are bounded to 100,000 bytes before JSON processing. Firmware limits decrypted requests to 46,000 bytes; PSBTs use the bounded, short-message NIP-44 representation. Oversized transactions are rejected, not fragmented. Configure relays that permit these frame sizes.

LNbits' `CreatePsbt` accepts an optional `include_non_witness_utxo` boolean (default `false`). The Nostr integration sets it to `true`; existing hardware signers retain their compact PSBT behavior.

## Future policy rules

`BitcoinPolicy::validate` produces trusted transaction details independently of transport and UI. A future policy evaluator belongs between validation and approval. Persist daily allowance reservations before releasing signatures; count signed approvals rather than trusting a client-reported broadcast result. Define trusted time, crash recovery, replacement transactions and reconciliation before enabling unattended policies. No unattended policy mode exists in v1.
