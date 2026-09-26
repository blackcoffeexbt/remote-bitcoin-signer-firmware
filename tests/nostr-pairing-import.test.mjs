import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../lnbits/lnbits/onchain/static/components/nostr-signer.js', import.meta.url), 'utf8').replace(/^import .*\n/, '')
function fixture({accounts = [], failPair = false, failImport = false} = {}) {
  let component
  const calls = [], notices = [], events = [], storage = new Map()
  const state = {failImport}
  const descriptor = 'wpkh([12345678/84h/1h/0h]test-descriptor/<0;1>/*)'
  class Client {
    clientKey = 'browser-public-key'
    connect() {}
    close() {}
    async request(method) {calls.push(method); if (failPair) throw new Error('Pairing rejected')}
    async getAccount() {calls.push('get_account'); return {descriptor, fingerprint: '12345678'}}
  }
  vm.runInNewContext(source, {
    window: {app: {component: (_, value) => {component = value}}},
    Vue: {markRaw: value => value},
    NostrTools: {generateSecretKey: () => new Uint8Array(32).fill(1)},
    NostrBitcoinSigner: Client,
    parsePairing: () => ({token: 'pair-token', pubkey: 'device', relays: ['wss://relay.example']}),
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    LNbits: {api: {request: async (method, path, key, payload) => {
      calls.push(method)
      if (method === 'GET') return {data: accounts}
      assert.equal(payload.masterpub, descriptor)
      assert.equal(payload.network, 'Testnet4')
      if (state.failImport) throw {response: {data: {detail: 'Explorer unavailable'}}}
      return {data: {masterpub: descriptor}}
    }}}
  })
  const instance = {...component.data(), network: 'Testnet4', storageKey: 'user:wallet', adminkey: 'test',
    pairing: 'test-code', $emit: event => events.push(event), $q: {notify: notice => notices.push(notice)}}
  for (const [name, method] of Object.entries(component.methods)) instance[name] = method.bind(instance)
  return {instance, calls, notices, events, storage, state, descriptor}
}
test('pairing automatically imports and provides success feedback', async () => {
  const {instance, calls, notices, events, storage} = fixture()
  await instance.connect(true)
  assert.deepEqual(calls, ['pair', 'get_account', 'GET', 'POST'])
  assert.equal(instance.imported, true)
  assert.equal(instance.connected, true)
  assert.equal(instance.busy, false)
  assert.ok(storage.has('user:wallet'))
  assert.ok(events.includes('wallet-imported'))
  assert.equal(notices.at(-1).type, 'positive')
  assert.match(instance.message, /public wallet imported/)
})
test('pairing rejection never imports a wallet', async () => {
  const {instance, calls} = fixture({failPair: true})
  await instance.connect(true)
  assert.deepEqual(calls, ['pair'])
  assert.equal(instance.connected, false)
  assert.match(instance.message, /Pairing rejected/)
})
test('reconnecting an already imported account does not create a duplicate', async () => {
  const f = fixture()
  await f.instance.connect(true)
  // Supply the same descriptor returned by the signer on reconnect.
  const existing = fixture({accounts: [{network: 'Testnet4', masterpub: f.descriptor}]})
  existing.storage.set('user:wallet', f.storage.get('user:wallet'))
  await existing.instance.connect(false)
  assert.deepEqual(existing.calls, ['get_account', 'GET'])
  assert.equal(existing.instance.imported, true)
  assert.match(existing.instance.message, /already imported/)
})
test('failed import keeps pairing and connection, shows API detail, and supports retry', async () => {
  const {instance, state, storage, notices, calls} = fixture({failImport: true})
  await instance.connect(true)
  assert.equal(instance.connected, true)
  assert.equal(instance.imported, false)
  assert.equal(instance.busy, false)
  assert.ok(storage.has('user:wallet'))
  assert.match(instance.message, /Explorer unavailable/)
  assert.equal(notices.at(-1).type, 'warning')
  state.failImport = false
  await instance.importAccount()
  assert.equal(instance.imported, true)
  assert.equal(calls.filter(call => call === 'pair').length, 1)
})
test('a different existing account is not replaced', async () => {
  const {instance, calls} = fixture({accounts: [{network: 'Testnet4', masterpub: 'other-wallet'}]})
  await instance.connect(true)
  assert.equal(calls.includes('POST'), false)
  assert.equal(instance.imported, false)
  assert.equal(instance.connected, true)
  assert.match(instance.message, /already has an account/)
})
