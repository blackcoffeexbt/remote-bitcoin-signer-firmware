import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Psbt, Transaction, address, networks } from 'bitcoinjs-lib';
import { fixture } from './fixtures.ts';
import { buildPsbt, broadcastPayment, checkPsbtUnspent, checkUnspent, deriveAddress, estimatedVsize, feeRate, finalizePayment, outpoint, planPayment, recipientScript, sats, syncWallet, transactionKnown, verifyCoin } from '../src/wallet.ts';
import type { Coin } from '../src/wallet.ts';
import type { Rpc } from '../src/electrum.ts';
import { reviewPsbt } from '../src/bitcoin.ts';

function setup() {
  const f = fixture(), a = deriveAddress(f.account, 0, 0);
  const raw = Buffer.from(f.psbt.data.inputs[0].nonWitnessUtxo!).toString('hex');
  const txid = Transaction.fromHex(raw).getId(), row = { tx_hash: txid, tx_pos: 0, value: 100000, height: 1 };
  const coin = verifyCoin(a, row, raw, 150);
  const destination = address.fromOutputScript(f.psbt.txOutputs[0].script, networks.testnet);
  const calls: string[] = [];
  const rpc: Rpc = { request: async (method, params = []) => {
    calls.push(method);
    if (method === 'blockchain.headers.subscribe') return { height: 150 };
    if (method === 'blockchain.scripthash.get_history') return params[0] === a.scripthash ? [{ tx_hash: txid, height: 1 }] : [];
    if (method === 'blockchain.scripthash.listunspent') return params[0] === a.scripthash ? [row] : [];
    if (method === 'blockchain.transaction.get' && params[0] === txid) return raw;
    throw new Error('Electrs: No such mempool or blockchain transaction');
  } };
  return { ...f, a, row, coin, destination, rpc, calls };
}
test('discovers both branches through a gap and verifies coins using full transactions', async () => {
  const f = setup();
  const wallet = await syncWallet(f.rpc, f.account, { receive: 0, change: 0 });
  assert.equal(wallet.coins.length, 1); assert.equal(wallet.coins[0].value, 100000n);
  assert.equal(wallet.addresses.length, 41); assert.deepEqual(wallet.next, { receive: 1, change: 0 });
  assert.equal(wallet.history.length, 1); assert.equal(wallet.coins[0].confirmations, 150);
  assert.equal(f.calls.includes('blockchain.transaction.broadcast'), false);
});
test('discovery scans beyond issued addresses even when an early gap is empty', async () => {
  const f = setup();
  const wallet = await syncWallet(f.rpc, f.account, { receive: 25, change: 2 });
  assert.equal(wallet.addresses.filter(a => !a.branch).length, 45);
  assert.equal(wallet.addresses.filter(a => a.branch).length, 22);
  assert.equal(wallet.next.receive, 25);
});
test('fails closed on lying amounts, duplicate coins, invalid history and oversized responses', async () => {
  const f = setup();
  for (const kind of ['amount', 'duplicate', 'history', 'size']) {
    const rpc: Rpc = { request: async (m, p) => {
      if (m.endsWith('get_history') && kind === 'history') return [{ tx_hash: 'wrong', height: 0 }];
      if (m.endsWith('listunspent')) {
        if (kind === 'amount') return [{ ...f.row, value: 100001 }];
        if (kind === 'duplicate') return [f.row, f.row];
        if (kind === 'size') return Array(1001).fill(f.row);
      }
      return f.rpc.request(m, p);
    } };
    await assert.rejects(syncWallet(rpc, f.account, { receive: 0, change: 0 }));
  }
});
test('builds, signs, verifies and finalizes a real payment with correct change and fee', () => {
  const f = setup(), plan = planPayment([f.coin], null, f.destination, '50000', '2.125');
  const original = buildPsbt(f.account, plan, deriveAddress(f.account, 1, 0), [f.a]);
  const review = reviewPsbt(original, f.account);
  assert.equal(review.outputs.length, 2); assert.equal(review.outputs[1].change, true);
  assert.equal(BigInt(review.fee), plan.fee);
  const signed = Psbt.fromBase64(original).signAllInputs(f.signer).toBase64();
  const final = finalizePayment(original, signed, f.account);
  assert.ok(final.vsize <= plan.vsize); assert.ok(final.feeRate >= 2.125);
  assert.equal(Transaction.fromHex(final.raw).getId(), final.txid);
  assert.ok(Transaction.fromHex(final.raw).ins[0].witness.length > 0);
});
test('manual selection uses exactly the checked coins; stale, duplicated and excess selections fail', () => {
  const f = setup(), second: Coin = { ...f.coin, txid: 'a'.repeat(64), value: 200000n };
  const plan = planPayment([f.coin, second], [outpoint(f.coin)], f.destination, '50000', '1');
  assert.deepEqual(plan.coins, [f.coin]);
  assert.equal(planPayment([f.coin, second], null, f.destination, '50000', '1').coins[0].txid, second.txid);
  assert.throws(() => planPayment([f.coin], [outpoint(second)], f.destination, '50000', '1'));
  assert.throws(() => planPayment([f.coin], [outpoint(f.coin), outpoint(f.coin)], f.destination, '50000', '1'));
  assert.throws(() => planPayment([f.coin], [], f.destination, '50000', '1'));
  const many = Array.from({ length: 33 }, (_, n) => ({ ...f.coin, txid: n.toString(16).padStart(64, '0') }));
  assert.throws(() => planPayment(many, null, f.destination, 'max', '1'), /32/);
});
test('send max deducts exact estimated fee, and dust change is included in the reviewed fee', () => {
  const f = setup();
  const max = planPayment([f.coin], null, f.destination, 'max', '1.001');
  assert.equal(max.amount + max.fee, f.coin.value); assert.equal(max.change, 0n);
  const noChange = planPayment([f.coin], null, f.destination, '99600', '1');
  assert.equal(noChange.change, 0n); assert.equal(noChange.fee, 400n);
  assert.throws(() => planPayment([f.coin], null, f.destination, '100000', '1'), /Insufficient/);
  assert.throws(() => planPayment([f.coin], null, f.destination, '293', '1'), /dust/);
});
test('excludes immature coinbase and unconfirmed inputs unless explicitly eligible', () => {
  const f = setup();
  assert.throws(() => planPayment([{ ...f.coin, confirmations: 99 }], null, f.destination, '1000', '1'));
  assert.throws(() => planPayment([{ ...f.coin, coinbase: false, confirmations: 0 }], null, f.destination, '1000', '1'));
  assert.ok(planPayment([{ ...f.coin, coinbase: false, confirmations: 0 }], null, f.destination, '1000', '1', true));
});
test('integer satoshi math rejects precision loss and wrong-network / unsupported recipients', () => {
  assert.equal(sats('2100000000000000'), 2100000000000000n);
  for (const value of ['1.1', '1e8', '-1', '0', '2100000000000001']) assert.throws(() => sats(value));
  assert.equal(feeRate('0.001'), 1n); assert.equal(feeRate('1.125'), 1125n);
  for (const value of ['0', '1e3', '1.0001', '10001', 'NaN']) assert.throws(() => feeRate(value));
  assert.throws(() => recipientScript('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'));
  const taproot = address.toBech32(new Uint8Array(32).fill(1), 1, 'tb');
  assert.throws(() => recipientScript(taproot));
  assert.ok(estimatedVsize(32, [new Uint8Array(25), new Uint8Array(22)]) > 2200);
});
test('rechecks spent inputs before preparation and broadcast, including coinbase maturity', async () => {
  const f = setup(); await checkUnspent(f.rpc, [f.coin]); await checkPsbtUnspent(f.rpc, f.unsigned, f.account);
  const spent: Rpc = { request: (m, p) => m.endsWith('listunspent') ? Promise.resolve([]) : f.rpc.request(m, p) };
  await assert.rejects(checkUnspent(spent, [f.coin]), /spent/);
  await assert.rejects(checkPsbtUnspent(spent, f.unsigned, f.account), /spent/);
  const reorg: Rpc = { request: (m, p) => m.endsWith('listunspent') ? Promise.resolve([{ ...f.row, height: 0 }]) : f.rpc.request(m, p) };
  await assert.rejects(checkUnspent(reorg, [f.coin]), /confirmations/);
});
test('explicit broadcast sends only verified transaction bytes and requires matching txid', async () => {
  const f = setup(), final = finalizePayment(f.unsigned, f.signed, f.account), calls: unknown[][] = [];
  const rpc: Rpc = { request: async (m, p) => { calls.push([m, p]); return final.txid; } };
  assert.equal(await broadcastPayment(rpc, f.unsigned, f.signed, f.account), final.txid);
  assert.deepEqual(calls, [['blockchain.transaction.broadcast', [final.raw]]]);
  await assert.rejects(broadcastPayment({ request: async () => 'bad' }, f.unsigned, f.signed, f.account), /uncertain/);
  const bad = Psbt.fromBase64(f.unsigned, { network: networks.testnet }); bad.addOutput({ address: f.destination, value: 1n }); bad.signAllInputs(f.signer);
  // No request is sent for a changed transaction.
  await assert.rejects(broadcastPayment(rpc, f.unsigned, bad.toBase64(), f.account));
  assert.equal(calls.length, 1);
});
test('status lookup distinguishes a missing transaction from network failures', async () => {
  const f = setup();
  assert.equal(await transactionKnown(f.rpc, f.coin.txid), true);
  assert.equal(await transactionKnown(f.rpc, 'a'.repeat(64)), false);
  await assert.rejects(transactionKnown({ request: async () => { throw new Error('timeout'); } }, f.coin.txid), /timeout/);
});
