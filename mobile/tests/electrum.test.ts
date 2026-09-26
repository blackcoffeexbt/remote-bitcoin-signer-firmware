import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { ElectrumClient, parseEndpoint } from '../src/electrum.ts';
import type { Dial } from '../src/electrum.ts';
function genesis() {
  const header = Buffer.alloc(80); header.writeInt32LE(1);
  Buffer.from('7aa0a7ae1e223414cb807e40cd57e667b718e42aaf9306db9102fe28912b7b4e', 'hex').reverse().copy(header, 36);
  header.writeUInt32LE(1714777860, 68); header.writeUInt32LE(0x1d00ffff, 72); header.writeUInt32LE(393743547, 76);
  return header.toString('hex');
}
function transport(header = genesis()) {
  let incoming: (data: string) => void = () => {}, closed = false;
  const requests: { id: number; method: string; params: unknown[] }[] = [];
  const dial: Dial = (_endpoint, ready, data) => {
    incoming = data; queueMicrotask(ready);
    return { close: () => { closed = true; }, write: text => {
      assert.ok(text.endsWith('\n')); const req = JSON.parse(text); requests.push(req);
      if (req.method === 'server.version' || req.method === 'blockchain.block.header') queueMicrotask(() => data(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: req.method === 'server.version' ? ['electrs test', '1.4'] : header }) + '\n'));
    } };
  };
  return { dial, requests, incoming: (value: string) => incoming(value), closed: () => closed };
}
test('parses Electrs TCP/TLS settings, including IPv6, without HTTP or credentials', () => {
  assert.deepEqual(parseEndpoint('ssl://example.com:50002'), { url: 'ssl://example.com:50002', host: 'example.com', port: 50002, tls: true });
  assert.equal(parseEndpoint('tcp://[::1]:50001').host, '::1');
  for (const v of ['https://example.com/api', 'tcp://host', 'ssl://u:p@host:50002', 'ssl://host:50002/path', 'ssl://host:50002?x', 'ssl://host:70000', 'ssl://host:50002#x']) assert.throws(() => parseEndpoint(v));
});
test('handshake verifies the actual Testnet4 genesis header before wallet requests', async () => {
  const wire = transport(), c = new ElectrumClient();
  await assert.rejects(c.request('blockchain.scripthash.listunspent', []), /verified/);
  await c.connect('ssl://example.com:50002', wire.dial);
  assert.deepEqual(wire.requests.map(r => r.method), ['server.version', 'blockchain.block.header']);
  c.close(); assert.equal(wire.closed(), true);
  const wrong = transport('00'.repeat(80)), bad = new ElectrumClient();
  await assert.rejects(bad.connect('ssl://example.com:50002', wrong.dial), /Testnet4/);
  assert.equal(wrong.closed(), true);
});
test('handles fragmented, concatenated and out-of-order replies bound to request IDs', async () => {
  const wire = transport(), c = new ElectrumClient(); await c.connect('tcp://host:50001', wire.dial);
  const one = c.request('a'), two = c.request('b');
  const a = wire.requests.at(-2)!, b = wire.requests.at(-1)!;
  const lines = JSON.stringify({ id: b.id, result: 'two' }) + '\n' + JSON.stringify({ id: a.id, result: 'one' }) + '\n';
  wire.incoming(lines.slice(0, 5)); wire.incoming(lines.slice(5));
  assert.equal(await one, 'one'); assert.equal(await two, 'two'); c.close();
});
test('server errors are bounded and a request timeout closes all pending work', async () => {
  const wire = transport(), c = new ElectrumClient(20); await c.connect('tcp://host:50001', wire.dial);
  const p = c.request('missing'); const failure = assert.rejects(p, /Electrs: not found/);
  wire.incoming(JSON.stringify({ id: wire.requests.at(-1)!.id, error: { message: 'not found' } }) + '\n'); await failure;
  await assert.rejects(c.request('offline'), /timed out/); assert.equal(wire.closed(), true);
});
test('malformed and oversized replies terminate instead of resolving wallet operations', async () => {
  for (const frame of ['not json\n', 'x'.repeat(2100001)]) {
    const wire = transport(), c = new ElectrumClient(); await c.connect('tcp://host:50001', wire.dial);
    const p = c.request('coins'), failure = assert.rejects(p);
    wire.incoming(frame); await failure; assert.equal(wire.closed(), true);
  }
});
test('connection attempts time out and can be explicitly cancelled', async () => {
  const c = new ElectrumClient(10);
  await assert.rejects(c.connect('tcp://host:50001', () => ({ write() {}, close() {} })), /timed out/);
  const d = new ElectrumClient(), promise = d.connect('tcp://host:50001', () => ({ write() {}, close() {} }));
  d.close(); await assert.rejects(promise, /disconnected/);
});
