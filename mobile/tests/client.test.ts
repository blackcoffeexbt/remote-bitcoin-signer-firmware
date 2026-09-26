import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event } from 'nostr-tools/core';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { SignerClient, parsePairing } from '../src/client.ts';
import type { Socket, ClientState } from '../src/client.ts';
import { fixture } from './fixtures.ts';
class FakeSocket implements Socket {
  readyState = 0; sent: string[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(seconds = 150) {
  const device = generateSecretKey(), phone = generateSecretKey();
  const pubkey = getPublicKey(device), sockets: FakeSocket[] = [], states: ClientState[] = [];
  const c = new SignerClient({ secret: phone, connection: { pubkey, relays: ['wss://one.example', 'wss://two.example'] }, requestSeconds: seconds,
    socket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, onState: s => states.push(s) });
  c.connect(); sockets.forEach(s => s.open());
  const key = nip44.utils.getConversationKey(device, c.clientKey);
  const request = () => {
    const event = JSON.parse(sockets[0].sent.findLast(s => JSON.parse(s)[0] === 'EVENT')!)[1];
    return JSON.parse(nip44.decrypt(event.content, key));
  };
  const response = (r: ReturnType<typeof request>, extra: object, signer = device, mutate?: (event: Event) => void) => {
    const { protocol, version, network, id, method, psbt_hash } = r;
    const conversation = nip44.utils.getConversationKey(signer, c.clientKey);
    const e = finalizeEvent({ kind: 24134, created_at: Math.floor(Date.now() / 1000), tags: [['p', c.clientKey]],
      content: nip44.encrypt(JSON.stringify({ protocol, version, network, id, method, psbt_hash, ...extra }), conversation) }, signer);
    mutate?.(e);
    sockets[0].onmessage?.({ data: JSON.stringify(['EVENT', 'bitcoin-v1', e]) });
  };
  return { c, sockets, states, request, response, pubkey };
}
test('pairing parser rejects insecure or malformed QR contents', () => {
  const good = { protocol: 'bitcoin-signer', version: 1, pubkey: 'a'.repeat(64), token: 'b'.repeat(32), relays: ['wss://relay.example'] };
  assert.equal(parsePairing(JSON.stringify(good)).relays.length, 1);
  for (const patch of [{ relays: ['ws://relay.example'] }, { pubkey: 'bad' }, { relays: [] }, { version: 2 }, { relays: ['wss://user:pass@relay.example'] }]) assert.throws(() => parsePairing(JSON.stringify({ ...good, ...patch })));
});
test('real encrypted pair and account retrieval; identical event on both relays', async () => {
  const t = setup(); const f = fixture();
  try {
    const p = t.c.pair('a'.repeat(32), 'Phone'); const r = t.request();
    assert.equal(r.method, 'pair'); assert.equal(r.params.label, 'Phone');
    assert.equal(t.sockets[0].sent[1], t.sockets[1].sent[1]);
    t.response(r, { result: f.account }); assert.equal((await p).xpub, f.account.xpub);
    const next = t.c.getAccount(); t.response(t.request(), { result: f.account }); await next;
  } finally { t.c.close(); }
});
test('end-to-end remote signing refreshes session, binds PIN, verifies result', async () => {
  const t = setup(); const f = fixture();
  try {
    const p = t.c.sign(f.unsigned); assert.equal(t.request().method, 'get_account');
    t.response(t.request(), { result: f.account }); await flush();
    const signing = t.request(); assert.equal(signing.params.session, f.account.session);
    await assert.rejects(t.c.submitPin('123456'), /No active PIN/);
    t.response(signing, { status: 'PIN required', sequence: 2 });
    t.response(signing, { status: 'Ready to sign', sequence: 1 });
    assert.equal(t.states.at(-1)!.pinRequired, true);
    const unlock = t.c.submitPin('123456'); const u = t.request();
    assert.equal(u.params.request_id, signing.id); assert.equal(u.psbt_hash, signing.psbt_hash);
    assert.equal(u.expires, signing.expires); assert.equal(u.params.pin, '123456');
    await assert.rejects(t.c.submitPin('123456'), /No active PIN/);
    t.response(u, { result: {} }); await unlock;
    t.response(signing, { status: 'Signing complete', sequence: 7 });
    assert.equal(t.states.at(-1)!.status, 'Signing complete');
    t.response(signing, { result: { psbt: f.signed } });
    assert.ok((await p).startsWith('cHNidP')); assert.equal(t.states.at(-1)!.pinRequired, false);
  } finally { t.c.close(); }
});
test('ignore wrong author/binding, mixed envelopes, tampering and status sequence', async () => {
  const t = setup(); const f = fixture();
  try {
    const p = t.c.getAccount(), r = t.request(); let settled = false; void p.then(() => { settled = true; });
    for (const patch of [{ network: 'Mainnet' }, { id: 'b'.repeat(32) }, { method: 'pair' }, { psbt_hash: 'x' }, { error: 'mixed' }]) t.response(r, { result: f.account, ...patch });
    t.response(r, { result: f.account }, generateSecretKey());
    await flush(); assert.equal(settled, false);
    t.response(r, { result: f.account }, undefined, e => { e.sig = '0'.repeat(128); });
    await flush(); assert.equal(settled, false);
    t.response(r, { result: f.account }); await p;
  } finally { t.c.close(); }
});
test('close and concurrency guard prevent stale operations', async () => {
  const t = setup();
  const p = t.c.getAccount(); const rejected = assert.rejects(p, /does not cancel/);
  await assert.rejects(t.c.getAccount(), /already active/);
  t.c.close(); await rejected;
});
test('timeout fails closed without requiring a relay response', async () => {
  const t = setup(0);
  try { await assert.rejects(t.c.getAccount(), /timed out/); } finally { t.c.close(); }
});
test('authenticated device errors and changed account propagate', async () => {
  const t = setup(); const f = fixture();
  try {
    const p = t.c.getAccount(); const error = assert.rejects(p, /unauthorized/);
    t.response(t.request(), { error: 'unauthorized' }); await error;
    const q = t.c.getAccount(); t.response(t.request(), { result: f.account }); await q;
    const s = t.c.getAccount(); const invalid = assert.rejects(s, /Unsupported|account/);
    t.response(t.request(), { result: { ...f.account, path: 'other' } }); await invalid;
  } finally { t.c.close(); }
});

test('ephemeral relay retry and reconnect reuse the original signed event', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const t = setup();
  try {
    const promise = t.c.getAccount(); const rejection = assert.rejects(promise, /Stopped waiting/);
    const original = t.sockets[0].sent[1];
    context.mock.timers.tick(5000);
    assert.equal(t.sockets[0].sent.at(-1), original);
    assert.equal(t.sockets[1].sent.at(-1), original);
    t.sockets[0].close(); context.mock.timers.tick(5000);
    assert.equal(t.sockets.length, 3); t.sockets[2].open();
    assert.equal(t.sockets[2].sent[1], original);
    t.c.close(); await rejection;
  } finally { t.c.close(); context.mock.timers.reset(); }
});
test('cooldown refusal re-enables PIN only for the still-active signing request', async () => {
  const t = setup(); const f = fixture();
  try {
    const sign = t.c.sign(f.unsigned); const cancelled = assert.rejects(sign, /Stopped waiting/);
    t.response(t.request(), { result: f.account }); await flush();
    t.response(t.request(), { status: 'PIN required', sequence: 2 });
    const unlock = t.c.submitPin('123456'); const refused = assert.rejects(unlock, /Wait before retrying/);
    t.response(t.request(), { error: 'Wait before retrying PIN' }); await refused;
    assert.equal(t.states.at(-1)!.pinRequired, true);
    t.c.close(); await cancelled;
  } finally { t.c.close(); }
});
