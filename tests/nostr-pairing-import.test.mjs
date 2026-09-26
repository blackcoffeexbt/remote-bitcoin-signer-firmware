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
    constructor(options) { this.onStatus = options.onStatus }
    async sign(psbt) {
      calls.push('sign_psbt')
      this.onStatus('PIN required')
      assert.equal(instance.pinRequired, true)
      this.onStatus('Signing')
      assert.equal(instance.pinRequired, false)
      return 'signed-' + psbt
    }
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

test('signing reconnects a saved pairing automatically and shows progress without reimporting', async () => {
  const f = fixture()
  await f.instance.connect(true)
  f.instance.disconnect()
  f.calls.length = 0
  assert.equal(await f.instance.signPsbt('psbt'), 'signed-psbt')
  assert.deepEqual(f.calls, ['get_account', 'sign_psbt'])
  assert.equal(f.instance.dialog, true)
  assert.equal(f.instance.signing, false)
  assert.equal(f.instance.pinRequired, false)
  assert.equal(f.instance.pin, '')
  assert.equal(f.instance.message, 'Signing complete')
})
test('signing failure clears PIN input and permits a new request', async () => {
  const {instance} = fixture()
  instance.connected = true
  instance.client = {sign: async () => { throw new Error('User rejected') }}
  instance.pin = '123456'
  await assert.rejects(instance.signPsbt('psbt'), /User rejected/)
  assert.equal(instance.pin, '')
  assert.equal(instance.signing, false)
  assert.equal(instance.pinRequired, false)
  assert.equal(instance.message, 'User rejected')
})
test('submitting the PIN immediately clears the field while waiting for the device', async () => {
  const {instance} = fixture()
  let complete
  instance.pin = '123456'
  instance.pinRequired = true
  instance.client = {submitPin: pin => {
    assert.equal(pin, '123456')
    return new Promise(resolve => { complete = resolve })
  }}
  const submission = instance.submitPin()
  assert.equal(instance.pin, '')
  assert.equal(instance.pinRequired, false)
  assert.equal(instance.pinBusy, true)
  complete()
  await submission
  assert.equal(instance.pinBusy, false)
})

test('an imported Nostr wallet selects its signer before any manual connection', () => {
  const walletSource = readFileSync(new URL('../lnbits/lnbits/onchain/static/wallet.js', import.meta.url), 'utf8')
  const component = vm.runInNewContext('(' + walletSource.split('export default ')[1] + ')')
  const nostr = {}, serial = {}, trezor = {}
  const state = {selectedWallet: {meta: {signer: 'nostr'}}, connectedDeviceType: null,
    $refs: {nostrSigner: nostr, serialSigner: serial, trezorSigner: trezor}}
  assert.equal(component.computed.signerDevice.call(state), nostr)
  state.selectedWallet = {meta: {}}
  assert.equal(component.computed.signerDevice.call(state), serial)
  state.connectedDeviceType = 'trezor-device'
  assert.equal(component.computed.signerDevice.call(state), trezor)
})

test('saved pairing is detected after reload without needing wallet metadata or a connection', async () => {
  const paired = fixture()
  await paired.instance.connect(true)
  const reloaded = fixture()
  assert.equal(reloaded.instance.hasPairing(), false)
  reloaded.storage.set('user:wallet', paired.storage.get('user:wallet'))
  assert.equal(reloaded.instance.connected, false)
  assert.equal(reloaded.instance.hasPairing(), true)
})

test('Sign with device selects a saved pairing, connects, creates a full PSBT and signs after reload', async () => {
  const paired = fixture()
  await paired.instance.connect(true)
  const reloaded = fixture()
  reloaded.storage.set('user:wallet', paired.storage.get('user:wallet'))
  reloaded.instance.isNostrSigner = true
  const walletSource = readFileSync(new URL('../lnbits/lnbits/onchain/static/wallet.js', import.meta.url), 'utf8')
  const walletComponent = vm.runInNewContext('(' + walletSource.split('export default ')[1] + ')')
  let paymentComponent
  const paymentSource = readFileSync(new URL('../lnbits/lnbits/onchain/static/components/payment.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  vm.runInNewContext(paymentSource, {window: {app: {component: (_, value) => { paymentComponent = value }}}})
  const notices = [], calls = []
  const disconnectedSerial = {isConnected: () => false}
  const wallet = {
    config: {network: 'Testnet4'}, selectedWallet: {meta: {}}, connectedDeviceType: null,
    $refs: {serialSigner: disconnectedSerial, nostrSigner: reloaded.instance},
    async $nextTick() {
      payment.serialSignerRef = walletComponent.computed.signerDevice.call(this)
    }
  }
  const payment = {
    ...paymentComponent.data(), serialSignerRef: disconnectedSerial, utxos: [],
    $q: {notify: value => notices.push(value)},
    prepareSigner: walletComponent.methods.prepareSigner.bind(wallet),
    async createPsbt() {
      assert.equal(this.serialSignerRef.isNostrSigner, true)
      assert.equal(this.serialSignerRef.isConnected(), true)
      calls.push('create_psbt')
      this.psbtBase64 = 'psbt'
    },
    async updateSignedPsbt(value) { calls.push(value) }
  }
  await paymentComponent.methods.checkAndSend.call(payment)
  assert.deepEqual(notices, [])
  assert.deepEqual(reloaded.calls, ['get_account', 'sign_psbt'])
  assert.deepEqual(calls, ['create_psbt', 'signed-psbt'])
  assert.equal(payment.showChecking, false)
  assert.equal(wallet.connectedDeviceType, 'nostr-device')
})

test('saved pairing selection is scoped to the current wallet and Testnet4', async () => {
  const source = readFileSync(new URL('../lnbits/lnbits/onchain/static/wallet.js', import.meta.url), 'utf8')
  const component = vm.runInNewContext('(' + source.split('export default ')[1] + ')')
  for (const [network, paired] of [['Mainnet', true], ['Testnet4', false]]) {
    const state = {config: {network}, connectedDeviceType: 'trezor-device',
      $refs: {nostrSigner: {hasPairing: () => paired}}, async $nextTick() {}}
    await component.methods.prepareSigner.call(state)
    assert.equal(state.connectedDeviceType, 'trezor-device')
  }
})
