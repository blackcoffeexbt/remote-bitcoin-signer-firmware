import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../src/network_portal_page.h', import.meta.url), 'utf8')
const script = source.match(/R"JS\(([\s\S]*?)\)JS"/)[1]
function setup(responses = []) {
  const elements = new Map(), calls = []
  function element() {
    return {value: '', type: 'password', hidden: false, disabled: false, textContent: '', children: [], handlers: {},
      addEventListener(event, handler) {this.handlers[event] = handler},
      replaceChildren() {this.children = []}, appendChild(child) {this.children.push(child)}}
  }
  const document = {
    getElementById(id) {if (!elements.has(id)) elements.set(id, element()); return elements.get(id)},
    createElement() {return element()}
  }
  document.getElementById('token').value = 'test-session-token'
  vm.runInNewContext(script, {document, setTimeout: callback => callback(), fetch: async (url, options) => {
    calls.push({url, options})
    const next = responses.shift()
    if (next instanceof Error) throw next
    assert.ok(next, 'Unexpected extra scan request')
    return {ok: next.ok !== false, json: async () => next, text: async () => next.error}
  }})
  return {get: id => document.getElementById(id), calls}
}
test('password visibility can be toggled without altering its value', () => {
  const {get} = setup(); get('password').value = 'test password'
  get('show-password').handlers.change({target: {checked: true}})
  assert.equal(get('password').type, 'text')
  get('show-password').handlers.change({target: {checked: false}})
  assert.equal(get('password').type, 'password')
  assert.equal(get('password').value, 'test password')
})
test('scan polls and safely lists SSIDs; selection fills the editable network field', async () => {
  const ssid = '<img src=x onerror=alert(1)>'
  const {get, calls} = setup([{status: 'scanning'}, {status: 'scanning'}, {status: 'complete', networks: [{ssid, open: true}]}])
  await get('scan').handlers.click()
  assert.equal(calls.length, 3)
  assert.equal(calls[0].options.method, 'POST')
  assert.ok(calls.every(call => call.options.headers['X-Setup-Token'] === 'test-session-token'))
  assert.equal(get('networks').children[1].textContent, ssid + ' (open)')
  assert.equal(get('networks').children[1].value, ssid)
  assert.equal(get('networks').hidden, false)
  get('networks').handlers.change({target: {value: ssid}})
  assert.equal(get('ssid').value, ssid)
  assert.equal(get('scan').disabled, false)
})
test('empty scan preserves manual entry and allows retry', async () => {
  const {get} = setup([{}, {status: 'complete', networks: []}])
  get('ssid').value = 'Hidden network'
  await get('scan').handlers.click()
  assert.match(get('scan-status').textContent, /No networks found/)
  assert.equal(get('ssid').value, 'Hidden network')
  assert.equal(get('scan').disabled, false)
})
test('expired setup and scan failures display an error and release the button', async () => {
  for (const response of [{ok: false, error: 'Setup expired'}, new Error('Connection lost')]) {
    const {get} = setup([response]); await get('scan').handlers.click()
    assert.match(get('scan-status').textContent, /Setup expired|Connection lost/)
    assert.equal(get('scan').disabled, false)
  }
})
test('a scan that never completes times out and can be retried', async () => {
  const {get} = setup(Array.from({length: 31}, () => ({status: 'scanning'})))
  await get('scan').handlers.click()
  assert.match(get('scan-status').textContent, /timed out/)
  assert.equal(get('scan').disabled, false)
})
test('setup form defaults to the requested relay', () => {
  assert.match(source, /<textarea[^>]*id="relays"[^>]*>wss:\/\/relay\.nostrconnect\.com<\/textarea>/)
})
