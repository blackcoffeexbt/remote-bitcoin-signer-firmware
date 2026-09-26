import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {webcrypto} from 'node:crypto'
const require = createRequire(process.env.LNBITS_PACKAGE || new URL('../lnbits/package.json', import.meta.url))
const tools = require('nostr-tools')
const source = readFileSync(new URL('../lnbits/lnbits/onchain/static/js/nostr-signer-client.js', import.meta.url), 'utf8')
const {NostrBitcoinSigner, parsePairing, BITCOIN_SIGNER_KIND} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
class Socket {
  constructor(url) {this.url=url;this.readyState=0;this.sent=[]}
  send(value) {this.sent.push(JSON.parse(value))}
  open() {this.readyState=1;this.onopen()}
  close() {this.readyState=3;this.onclose?.()}
}
const deviceSecret=tools.generateSecretKey(), pubkey=tools.getPublicKey(deviceSecret)
function setup() {
  const client = new NostrBitcoinSigner({tools, WebSocketClass:Socket,crypto:webcrypto,
    secret:tools.generateSecretKey(),pubkey,relays:['wss://one.example/','wss://two.example/']})
  client.connect();client.sockets.forEach(s=>s.open());return client
}
function request(client) {
  return client.sockets[0].sent.findLast(v=>v[0]==='EVENT')[1]
}
function response(client, body, secret=deviceSecret) {
  const key=tools.nip44.v2.utils.getConversationKey(secret,client.clientKey)
  const event=tools.finalizeEvent({kind:BITCOIN_SIGNER_KIND,created_at:Math.floor(Date.now()/1000),
    tags:[['p',client.clientKey]],content:tools.nip44.v2.encrypt(JSON.stringify(body),key)},secret)
  return JSON.stringify(['EVENT','bitcoin-v1',event])
}
function body(client,extra={}) {
  const event=request(client)
  const key=tools.nip44.v2.utils.getConversationKey(deviceSecret,client.clientKey)
  const original=JSON.parse(tools.nip44.v2.decrypt(event.content,key))
  return {protocol:original.protocol,version:1,id:original.id,method:original.method,
    network:'Testnet4',psbt_hash:original.psbt_hash,result:{ok:true},...extra}
}
test('pairing requires bounded secure relays and exact protocol',()=>{
  const good={protocol:'bitcoin-signer',version:1,pubkey,token:'a'.repeat(32),relays:['wss://one.example']}
  assert.equal(parsePairing(JSON.stringify(good)).relays[0],'wss://one.example/')
  for(const change of [{version:2},{token:'123'},{relays:['ws://one.example']},{relays:[]},{pubkey:'bad'}])
    assert.throws(()=>parsePairing(JSON.stringify({...good,...change})))
})
test('same signed request travels over all relays; duplicate responses settle once',async()=>{
  const c=setup();try {
    const promise=c.request('get_account')
    assert.deepEqual(c.sockets[0].sent[1],c.sockets[1].sent[1])
    const wire=response(c,body(c))
    await c.receive(wire);await c.receive(wire)
    assert.deepEqual(await promise,{ok:true});assert.equal(c.pending.size,0)
  }finally{c.close()}
})
test('wrong peer, hash, request id, network, and tampered signature are ignored',async()=>{
  const c=setup();try {
    const promise=c.request('sign_psbt',{},'a'.repeat(64))
    for(const extra of [{id:'b'.repeat(32)},{psbt_hash:'b'.repeat(64)},{network:'Mainnet'},{method:'pair'}]) {
      await c.receive(response(c,body(c,extra)));assert.equal(c.pending.size,1)
    }
    await c.receive(response(c,body(c),tools.generateSecretKey()));assert.equal(c.pending.size,1)
    const broken=JSON.parse(response(c,body(c)));broken[2].sig='0'.repeat(128)
    await c.receive(JSON.stringify(broken));assert.equal(c.pending.size,1)
    await c.receive(response(c,body(c)));await promise
  }finally{c.close()}
})
test('device rejection, busy, revoked pairing and restart session errors propagate',async()=>{
  for(const error of ['User rejected','busy','unauthorized','Device restarted; reconnect first']) {
    const c=setup();try {const promise=c.request('sign_psbt');const assertion=assert.rejects(promise,{message:error});
      await c.receive(response(c,body(c,{error})));await assertion
    }finally{c.close()}
  }
})
test('disconnect rejects requests; a second request cannot replace active review',async()=>{
  const c=setup();const pending=c.request('get_account');const assertion=assert.rejects(pending,/disconnected/)
  await assert.rejects(c.request('get_account'),/already active/);c.close();await assertion
})
test('late responses are ignored and oversized PSBT is rejected before publication',async()=>{
  const c=setup();try {
    c.account={session:'a'.repeat(32)}
    await assert.rejects(c.sign('A'.repeat(43696)),/32 KiB/)
    const p=c.request('get_account');const assertion=assert.rejects(p,/disconnected/)
    c.pending.values().next().value.deadline=0
    await c.receive(response(c,body(c)));assert.equal(c.pending.size,1)
    c.close();await assertion
  }finally{c.close()}
})

test("authenticated progress stays pending and ignores duplicate or older statuses", async () => {
  const c = setup(),
    statuses = [];
  c.onStatus = (status) => statuses.push(status);
  try {
    const promise = c.request("sign_psbt", {}, "a".repeat(64));
    const original = body(c);
    for (const [status, sequence] of [
      ["PIN required", 2],
      ["Ready to sign", 1],
      ["PIN required", 2],
      ["Decrypting wallet", 3],
    ]) {
      await c.receive(
        response(c, { ...original, result: undefined, status, sequence }),
      );
      assert.equal(c.pending.size, 1);
    }
    await c.receive(
      response(c, {
        ...original,
        status: "Signing",
        sequence: 6,
        psbt_hash: "b".repeat(64),
      }),
    );
    assert.deepEqual(statuses, ["PIN required", "Decrypting wallet"]);
    await c.receive(response(c, { ...original, result: { psbt: "signed" } }));
    assert.deepEqual(await promise, { psbt: "signed" });
  } finally {
    c.close();
  }
});

test("PIN submission binds to the signing request, PSBT hash and refreshed boot session", async () => {
  const c = setup();
  try {
    c.account = { session: "b".repeat(32) };
    await assert.rejects(c.submitPin("123456"), /No active PIN/);
    const signing = c.request("sign_psbt", {}, "a".repeat(64));
    const original = body(c);
    await c.receive(
      response(c, { ...original, status: "PIN required", sequence: 2 }),
    );
    await assert.rejects(c.submitPin("bad"), /6–32/);
    const unlock = c.submitPin("123456");
    const event = request(c);
    const key = tools.nip44.v2.utils.getConversationKey(
      deviceSecret,
      c.clientKey,
    );
    const clear = JSON.parse(tools.nip44.v2.decrypt(event.content, key));
    assert.equal(clear.method, "unlock");
    assert.deepEqual(clear.params, {
      pin: "123456",
      request_id: original.id,
      session: c.account.session,
    });
    assert.equal(clear.psbt_hash, original.psbt_hash);
    assert.equal(c.pending.size, 2);
    await assert.rejects(c.submitPin("123456"), /No active PIN/);
    await c.receive(response(c, body(c, { result: {} })));
    await unlock;
    assert.equal(c.pending.size, 1);
    await c.receive(response(c, { ...original, result: { psbt: "signed" } }));
    await signing;
  } finally {
    c.close();
  }
});

test("every sign refreshes the session automatically, including after reboot", async () => {
  const c = setup();
  try {
    c.account = { session: "a".repeat(32) };
    const signing = c.sign(btoa("psbt"));
    // SHA-256 is asynchronous before the get_account request is published.
    while (!c.pending.size)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(body(c).method, "get_account");
    await c.receive(
      response(
        c,
        body(c, {
          result: {
            session: "b".repeat(32),
            descriptor: "descriptor",
            path: "m/84'/1'/0'",
          },
        }),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const key = tools.nip44.v2.utils.getConversationKey(
      deviceSecret,
      c.clientKey,
    );
    const clear = JSON.parse(tools.nip44.v2.decrypt(request(c).content, key));
    assert.equal(clear.method, "sign_psbt");
    assert.equal(clear.params.session, "b".repeat(32));
    await c.receive(response(c, body(c, { result: { psbt: "signed" } })));
    assert.equal(await signing, "signed");
  } finally {
    c.close();
  }
});

test("relay reconnection republishes identical in-flight requests after subscribing", async () => {
  const c = setup();
  try {
    const promise = c.request("sign_psbt");
    const expected = request(c);
    const old = c.sockets[0];
    old.close();
    c.openRelay(old.url);
    const replacement = c.sockets.at(-1);
    replacement.open();
    assert.equal(replacement.sent[0][0], "REQ");
    assert.deepEqual(replacement.sent[1][1], expected);
    await c.receive(response(c, body(c)));
    await promise;
  } finally {
    c.close();
  }
  assert.equal(c.retries.size, 0);
});

test("a terminal signing response clears a lost PIN acknowledgement and its ciphertext", async () => {
  const c = setup();
  try {
    c.account = { session: "a".repeat(32) };
    const signing = c.request("sign_psbt", {}, "a".repeat(64));
    const original = body(c);
    await c.receive(
      response(c, { ...original, status: "PIN required", sequence: 2 }),
    );
    const pin = c.submitPin("123456");
    const entries = [...c.pending.values()];
    assert.equal(entries[0].deadline, entries[1].deadline);
    await c.receive(response(c, { ...original, result: { psbt: "signed" } }));
    await Promise.all([signing, pin]);
    assert.equal(c.pending.size, 0);
  } finally {
    c.close();
  }
});

test('ephemeral requests are retried unchanged until a recovered device responds', async context => {
  context.mock.timers.enable({apis: ['setInterval']})
  const c = setup()
  try {
    const promise = c.request('get_account')
    const expected = request(c)
    const count = c.sockets[0].sent.length
    context.mock.timers.tick(5000)
    assert.equal(c.sockets[0].sent.length, count + 1)
    assert.deepEqual(request(c), expected)
    await c.receive(response(c, body(c)))
    await promise
    context.mock.timers.tick(10000)
    assert.equal(c.sockets[0].sent.length, count + 1)
  } finally { c.close() }
})
