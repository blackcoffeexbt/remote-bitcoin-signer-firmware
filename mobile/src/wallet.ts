import { Buffer } from 'buffer';
import { Psbt, Transaction, address, networks, payments } from 'bitcoinjs-lib';
import { sha256 } from '@noble/hashes/sha2.js';
import { accountKey, hex, reviewPsbt, verifySignedPsbt } from './bitcoin.ts';
import type { PublicAccount } from './protocol.ts';
import type { Rpc } from './electrum.ts';

export const GAP = 20, MAX_INDEX = 1000;
const MAX_MONEY = 2100000000000000n;
export type AddressCursor = { receive: number; change: number };
export type WalletAddress = { branch: 0 | 1; index: number; address: string; script: string; scripthash: string; pubkey: string; path: string };
export type Coin = WalletAddress & { txid: string; vout: number; value: bigint; height: number; confirmations: number; coinbase: boolean; raw: string };
export type HistoryEntry = { txid: string; height: number };
export type Snapshot = { xpub: string; height: number; syncedAt: number; coins: Coin[]; addresses: WalletAddress[]; history: HistoryEntry[]; next: AddressCursor; lastUsed: AddressCursor };
export const outpoint = (c: { txid: string; vout: number }) => `${c.txid}:${c.vout}`;
export function deriveAddress(account: PublicAccount, branch: 0 | 1, index: number): WalletAddress {
  if ((branch !== 0 && branch !== 1) || !Number.isSafeInteger(index) || index < 0 || index >= MAX_INDEX) throw new Error('Address scan limit reached (1,000 per branch)');
  const key = accountKey(account).deriveChild(branch).deriveChild(index).publicKey!;
  const p = payments.p2wpkh({ pubkey: key, network: networks.testnet });
  return { branch, index, address: p.address!, script: hex(p.output!), scripthash: hex(sha256(p.output!).reverse()), pubkey: hex(key), path: `${account.path}/${branch}/${index}` };
}
export function validateCursor(v: AddressCursor): AddressCursor {
  if (!v || ![v.receive, v.change].every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_INDEX - GAP)) throw new Error('Invalid or exhausted address cursor');
  return { receive: v.receive, change: v.change };
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const validHeight = (v: unknown, tip: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= -1 && v <= tip;
export async function tipHeight(rpc: Rpc) {
  const value = await rpc.request('blockchain.headers.subscribe') as { height: number };
  if (!value || !Number.isSafeInteger(value.height) || value.height < 0) throw new Error('Invalid server chain height');
  return value.height;
}
export async function rawTransaction(rpc: Rpc, txid: string): Promise<string> {
  const raw = await rpc.request('blockchain.transaction.get', [txid, false]);
  if (typeof raw !== 'string' || raw.length > 2000000 || raw.length < 20 || raw.length % 2 || !/^[0-9a-fA-F]+$/.test(raw) || Transaction.fromHex(raw).getId() !== txid) throw new Error('Server returned an invalid previous transaction');
  return raw;
}
type Unspent = { tx_hash: string; tx_pos: number; value: number; height: number };
export async function listUnspent(rpc: Rpc, a: WalletAddress, tip: number): Promise<Unspent[]> {
  const rows = await rpc.request('blockchain.scripthash.listunspent', [a.scripthash]);
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid or oversized unspent response');
  const seen = new Set<string>();
  for (const v of rows) {
    if (!v || !hash(v.tx_hash) || !Number.isInteger(v.tx_pos) || v.tx_pos < 0 || v.tx_pos > 0xffffffff || !Number.isSafeInteger(v.value) || v.value <= 0 || v.value > Number(MAX_MONEY) || !validHeight(v.height, tip)) throw new Error('Invalid coin from Electrs');
    const key = `${v.tx_hash}:${v.tx_pos}`;
    if (seen.has(key)) throw new Error('Duplicate coin from Electrs');
    seen.add(key);
  }
  return rows;
}
export function verifyCoin(a: WalletAddress, row: Unspent, raw: string, tip: number): Coin {
  const tx = Transaction.fromHex(raw), output = tx.outs[row.tx_pos];
  if (tx.getId() !== row.tx_hash || !output || output.value !== BigInt(row.value) || hex(output.script) !== a.script) throw new Error('Coin amount or script does not match its previous transaction');
  return { ...a, txid: row.tx_hash, vout: row.tx_pos, value: output.value, height: row.height, confirmations: row.height > 0 ? tip - row.height + 1 : 0, coinbase: tx.isCoinbase(), raw };
}
export async function syncWallet(rpc: Rpc, account: PublicAccount, cursor: AddressCursor, progress: (text: string) => void = () => {}): Promise<Snapshot> {
  validateCursor(cursor);
  const height = await tipHeight(rpc), addresses: WalletAddress[] = [], coins: Coin[] = [];
  const history = new Map<string, number>(), seen = new Set<string>(), rawCache = new Map<string, string>();
  const next = { ...cursor }, lastUsed = { receive: -1, change: -1 };
  for (const branch of [0, 1] as const) {
    const name = branch === 0 ? 'receive' : 'change';
    let unused = 0, complete = false;
    for (let index = 0; index < MAX_INDEX; index++) {
      const a = deriveAddress(account, branch, index); addresses.push(a);
      progress(`Scanning ${name} address ${index + 1}…`);
      const entries = await rpc.request('blockchain.scripthash.get_history', [a.scripthash]);
      if (!Array.isArray(entries) || entries.length > 2000) throw new Error('Invalid or oversized wallet history');
      for (const entry of entries) {
        if (!entry || !hash(entry.tx_hash) || !validHeight(entry.height, height)) throw new Error('Invalid transaction history');
        history.set(entry.tx_hash, entry.height);
      }
      if (history.size > 2000) throw new Error('Wallet history exceeds the 2,000-transaction mobile limit');
      const rows = await listUnspent(rpc, a, height);
      if (entries.length || rows.length) { unused = 0; next[name] = Math.max(next[name], index + 1); lastUsed[name] = index; } else unused++;
      for (const row of rows) {
        const key = `${row.tx_hash}:${row.tx_pos}`;
        if (seen.has(key) || coins.length >= 1000) throw new Error('Duplicate coin or wallet exceeds 1,000 coins');
        seen.add(key);
        let raw = rawCache.get(row.tx_hash);
        if (!raw) { raw = await rawTransaction(rpc, row.tx_hash); rawCache.set(row.tx_hash, raw); }
        coins.push(verifyCoin(a, row, raw, height));
      }
      if (unused >= GAP && index >= cursor[name] + GAP - 1) { complete = true; break; }
    }
    if (!complete) throw new Error('Address discovery reached 1,000 addresses without a full gap. Balance is incomplete; no payment was prepared.');
  }
  validateCursor(next);
  if (coins.reduce((n, c) => n + c.value, 0n) > MAX_MONEY) throw new Error('Invalid wallet balance');
  return { xpub: account.xpub, height, syncedAt: Date.now(), coins, addresses, next, lastUsed,
    history: [...history].map(([txid, h]) => ({ txid, height: h })).sort((a, b) => (b.height <= 0 ? Infinity : b.height) - (a.height <= 0 ? Infinity : a.height)) };
}
export function sats(text: string) {
  if (!/^[1-9][0-9]{0,15}$/.test(text) || BigInt(text) > MAX_MONEY) throw new Error('Enter a positive whole-satoshi amount');
  return BigInt(text);
}
export function feeRate(text: string): bigint {
  if (!/^(0|[1-9][0-9]{0,4})(\.[0-9]{1,3})?$/.test(text)) throw new Error('Fee rate needs up to three decimal places');
  const [whole, fraction = ''] = text.split('.');
  const rate = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (rate < 1n || rate > 10000000n) throw new Error('Fee rate must be 0.001–10,000 sat/vB');
  return rate;
}
export function recipientScript(destination: string) {
  let script: Uint8Array;
  try { script = address.toOutputScript(destination.trim(), networks.testnet); } catch { throw new Error('Enter a valid Testnet4 recipient address'); }
  if (!/^(76a914[0-9a-f]{40}88ac|a914[0-9a-f]{40}87|0014[0-9a-f]{40}|0020[0-9a-f]{64})$/.test(hex(script))) throw new Error('Device supports legacy and SegWit v0 recipients; Taproot is not supported');
  return script;
}
export function dust(script: Uint8Array) { return BigInt(script[0] === 0 ? (script.length === 22 ? 294 : 330) : (script.length === 23 ? 540 : 546)); }
export function estimatedVsize(inputs: number, scripts: Uint8Array[]) {
  // <=32 inputs/outputs: one-byte counts. Upper bound includes 73-byte signatures.
  const base = 10 + 41 * inputs + scripts.reduce((n, s) => n + 9 + s.length, 0);
  return Math.ceil((base * 4 + 2 + 109 * inputs) / 4);
}
export type Plan = { coins: Coin[]; destination: string; amount: bigint; fee: bigint; change: bigint; vsize: number; rate: string };
export function planPayment(available: Coin[], selected: string[] | null, destination: string, amountText: string, rateText: string, allowUnconfirmed = false): Plan {
  const output = recipientScript(destination), rate = feeRate(rateText);
  const eligible = available.filter(c => (!c.coinbase || c.confirmations >= 100) && (allowUnconfirmed || c.confirmations > 0));
  const keys = new Set(selected ?? []);
  if (selected && (keys.size !== selected.length || !selected.length)) throw new Error('Select at least one coin');
  const candidates = selected ? eligible.filter(c => keys.has(outpoint(c))) : [...eligible].sort((a, b) => a.value === b.value ? outpoint(a).localeCompare(outpoint(b)) : a.value > b.value ? -1 : 1);
  if (selected && candidates.length !== selected.length) throw new Error('A selected coin is unavailable, immature or unconfirmed');
  if (new Set(candidates.map(outpoint)).size !== candidates.length) throw new Error('Duplicate selected input');
  const maximum = amountText === 'max';
  const amount = maximum ? 0n : sats(amountText);
  if (!maximum && amount < dust(output)) throw new Error('Recipient amount is below the dust limit');
  const charge = (size: number) => (BigInt(size) * rate + 999n) / 1000n;
  const choose = (coins: Coin[]): Plan | null => {
    const total = coins.reduce((n, c) => n + c.value, 0n);
    const noChangeSize = estimatedVsize(coins.length, [output]), minimum = charge(noChangeSize);
    if (maximum) {
      if (total - minimum < dust(output)) return null;
      return { coins, destination: destination.trim(), amount: total - minimum, fee: minimum, change: 0n, vsize: noChangeSize, rate: rateText };
    }
    if (total < amount + minimum) return null;
    const changeSize = estimatedVsize(coins.length, [output, new Uint8Array(22)]), changeFee = charge(changeSize);
    const change = total - amount - changeFee;
    if (change >= 294n) return { coins, destination: destination.trim(), amount, fee: changeFee, change, vsize: changeSize, rate: rateText };
    return { coins, destination: destination.trim(), amount, fee: total - amount, change: 0n, vsize: noChangeSize, rate: rateText };
  };
  if (maximum || selected) {
    if (!candidates.length || candidates.length > 32) throw new Error('Choose between 1 and 32 spendable coins');
    const plan = choose(candidates); if (plan) return plan;
  } else {
    for (let count = 1; count <= Math.min(32, candidates.length); count++) { const plan = choose(candidates.slice(0, count)); if (plan) return plan; }
  }
  throw new Error('Insufficient selected funds including the fee (maximum 32 inputs)');
}
export async function checkUnspent(rpc: Rpc, coins: Coin[]) {
  const tip = await tipHeight(rpc), cache = new Map<string, Unspent[]>();
  for (const c of coins) {
    let rows = cache.get(c.scripthash);
    if (!rows) { rows = await listUnspent(rpc, c, tip); cache.set(c.scripthash, rows); }
    const current = rows.find(v => v.tx_hash === c.txid && v.tx_pos === c.vout);
    if (!current || BigInt(current.value) !== c.value) throw new Error('An input was spent or changed. Sync the wallet and rebuild the payment.');
    if ((c.coinbase && (current.height <= 0 || tip - current.height + 1 < 100)) || (c.confirmations > 0 && current.height <= 0)) throw new Error('An input lost confirmations. Sync and review again.');
  }
}
export function buildPsbt(account: PublicAccount, plan: Plan, change: WalletAddress, knownAddresses: WalletAddress[]): string {
  if (!plan.coins.length || plan.coins.length > 32) throw new Error('Invalid input count');
  const p = new Psbt({ network: networks.testnet }).setVersion(2).setLocktime(0);
  const derivation = (a: WalletAddress) => [{ masterFingerprint: Buffer.from(account.fingerprint, 'hex'), pubkey: Buffer.from(a.pubkey, 'hex'), path: a.path }];
  for (const c of plan.coins) {
    const expected = deriveAddress(account, c.branch, c.index);
    if (expected.script !== c.script || expected.pubkey !== c.pubkey || expected.path !== c.path) throw new Error('Foreign input derivation');
    verifyCoin(expected, { tx_hash: c.txid, tx_pos: c.vout, value: Number(c.value), height: c.height }, c.raw, c.height + c.confirmations - 1);
    p.addInput({ hash: c.txid, index: c.vout, sequence: 0xffffffff, nonWitnessUtxo: Buffer.from(c.raw, 'hex'), witnessUtxo: { script: Buffer.from(c.script, 'hex'), value: c.value }, sighashType: 1, bip32Derivation: derivation(expected) });
  }
  const script = recipientScript(plan.destination), own = knownAddresses.find(a => a.script === hex(script));
  p.addOutput({ script, value: plan.amount, ...(own ? { bip32Derivation: derivation(own) } : {}) });
  if (plan.change > 0n) {
    const expected = deriveAddress(account, 1, change.index);
    if (expected.script !== change.script || change.branch !== 1) throw new Error('Invalid change address');
    p.addOutput({ script: Buffer.from(expected.script, 'hex'), value: plan.change, bip32Derivation: derivation(expected) });
  }
  const result = p.toBase64(), review = reviewPsbt(result, account);
  if (BigInt(review.fee) !== plan.fee) throw new Error('Calculated transaction fee changed');
  return result;
}
export function finalizePayment(original: string, signed: string, account: PublicAccount) {
  const verified = verifySignedPsbt(original, signed, account);
  const p = Psbt.fromBase64(verified, { network: networks.testnet });
  p.finalizeAllInputs();
  const tx = p.extractTransaction(true), review = reviewPsbt(original, account);
  return { raw: tx.toHex(), txid: tx.getId(), vsize: tx.virtualSize(), fee: review.fee, feeRate: Number(review.fee) / tx.virtualSize(), review };
}
export async function transactionKnown(rpc: Rpc, txid: string): Promise<boolean> {
  try { await rawTransaction(rpc, txid); return true; }
  catch (e) {
    // Only an explicit missing-transaction reply means unknown. Transport errors
    // must not turn into permission to send a replacement payment.
    if (e instanceof Error && /^Electrs: /i.test(e.message) && /not found|no such|unknown transaction|invalid or non-wallet/i.test(e.message)) return false;
    throw e;
  }
}
export async function broadcastPayment(rpc: Rpc, original: string, signed: string, account: PublicAccount) {
  const final = finalizePayment(original, signed, account);
  const response = await rpc.request('blockchain.transaction.broadcast', [final.raw]);
  if (response !== final.txid) throw new Error('Broadcast result is uncertain. Check this transaction ID before retrying.');
  return final.txid;
}
export async function checkPsbtUnspent(rpc: Rpc, original: string, account: PublicAccount) {
  reviewPsbt(original, account);
  const p = Psbt.fromBase64(original, { network: networks.testnet }), tip = await tipHeight(rpc);
  for (let i = 0; i < p.inputCount; i++) {
    const d = p.data.inputs[i].bip32Derivation![0], parts = d.path.split('/');
    const a = deriveAddress(account, Number(parts[4]) as 0 | 1, Number(parts[5]));
    const txid = Buffer.from(p.txInputs[i].hash).reverse().toString('hex');
    const rows = await listUnspent(rpc, a, tip), row = rows.find(r => r.tx_hash === txid && r.tx_pos === p.txInputs[i].index);
    if (!row) throw new Error('An input is already spent. Check transaction history before preparing another payment.');
    const c = verifyCoin(a, row, hex(p.data.inputs[i].nonWitnessUtxo!), tip);
    if (c.coinbase && c.confirmations < 100) throw new Error('Coinbase input is not yet mature');
  }
}
