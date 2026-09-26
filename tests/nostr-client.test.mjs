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
