import { Buffer } from 'buffer';
import { Psbt, Transaction, address, networks, payments } from 'bitcoinjs-lib';
import { HDKey } from '@scure/bip32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { PublicAccount } from './protocol.ts';

export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const equal = (a: Uint8Array, b: Uint8Array) => hex(a) === hex(b);
const versions = { public: 0x043587cf, private: 0x04358394 };
export function accountKey(account: PublicAccount) {
  const key = HDKey.fromExtendedKey(account.xpub, versions);
  if (key.privateKey || key.depth !== 3 || key.index !== 0x80000000) throw new Error('Unsupported public account');
  return key;
}
export function validateAccount(value: unknown): PublicAccount {
  if (!value || typeof value !== 'object') throw new Error('Invalid public account');
  const a = value as PublicAccount;
  if (typeof a.fingerprint !== 'string' || typeof a.session !== 'string' || a.path !== "m/84'/1'/0'" || !/^[0-9a-f]{8}$/.test(a.fingerprint) ||
    !/^[0-9a-f]{32}$/.test(a.session) || typeof a.xpub !== 'string' || a.xpub.length > 120 ||
    typeof a.descriptor !== 'string' || a.descriptor.length > 1024) throw new Error('Unsupported signer account');
  accountKey(a);
  const descriptor = `wpkh([${a.fingerprint}/84h/1h/0h]${a.xpub}/<0;1>/*)`;
  if (!a.descriptor.startsWith(descriptor + '#') || !/^[a-z0-9]{8}$/.test(a.descriptor.slice(descriptor.length + 1))) {
    throw new Error('Descriptor does not match public account');
  }
  return { descriptor: a.descriptor, xpub: a.xpub, fingerprint: a.fingerprint, path: a.path, session: a.session };
}
export function receiveAddress(account: PublicAccount, index = 0) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) throw new Error('Invalid address index');
  return payments.p2wpkh({ pubkey: accountKey(account).deriveChild(0).deriveChild(index).publicKey!, network: networks.testnet }).address!;
}
export function psbtBytes(text: string, max = 32768): Uint8Array {
  if (!text || text.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('Invalid or oversized base64 PSBT');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > max || bytes.toString('base64') !== text || hex(bytes.subarray(0, 5)) !== '70736274ff') throw new Error('Invalid or oversized PSBT');
  return bytes;
}
export function psbtHash(text: string) { return hex(sha256(psbtBytes(text))); }
function ownedScript(account: PublicAccount, derivation: { path: string; pubkey: Uint8Array; masterFingerprint: Uint8Array }) {
  if (hex(derivation.masterFingerprint) !== account.fingerprint) throw new Error('Foreign wallet fingerprint');
  const match = /^m\/84'\/1'\/0'\/([01])\/(0|[1-9][0-9]*)$/.exec(derivation.path);
  if (!match || Number(match[2]) >= 0x80000000) throw new Error('Unsupported key derivation');
  const publicKey = accountKey(account).deriveChild(Number(match[1])).deriveChild(Number(match[2])).publicKey!;
  if (!equal(publicKey, derivation.pubkey)) throw new Error('Public key does not match the paired account');
  return payments.p2wpkh({ pubkey: publicKey, network: networks.testnet }).output!;
}
export type Review = { outputs: { address: string; sats: string; change: boolean }[]; fee: string; debit: string; inputs: number };
export function reviewPsbt(text: string, account: PublicAccount): Review {
  const p = Psbt.fromBuffer(psbtBytes(text), { network: networks.testnet });
  if (p.version !== 2 || p.locktime !== 0 || p.inputCount < 1 || p.inputCount > 32 || p.txOutputs.length < 1 || p.txOutputs.length > 32) throw new Error('Unsupported transaction: use PSBT v0, version 2, zero locktime and at most 32 inputs/outputs');
  let total = 0n;
  const spent = new Set<string>();
  p.data.inputs.forEach((input, i) => {
    if (input.partialSig?.length || input.finalScriptSig || input.finalScriptWitness || input.tapKeySig || input.redeemScript || input.witnessScript || (input.sighashType !== undefined && input.sighashType !== 1)) throw new Error('Only unsigned native SegWit SIGHASH_ALL inputs are supported');
    const txInput = p.txInputs[i];
    if (txInput.sequence !== 0xffffffff || !input.nonWitnessUtxo || input.bip32Derivation?.length !== 1) throw new Error('Each input needs its full previous transaction and account derivation');
    const outpoint = `${hex(txInput.hash)}:${txInput.index}`;
    if (spent.has(outpoint)) throw new Error('Duplicate transaction input');
    spent.add(outpoint);
    const previous = Transaction.fromBuffer(input.nonWitnessUtxo);
    const output = previous.outs[txInput.index];
    if (!equal(previous.getHash(), txInput.hash) || !output) throw new Error('Invalid previous transaction');
    if (!equal(output.script, ownedScript(account, input.bip32Derivation[0]))) throw new Error('Input does not belong to the paired device');
    if (input.witnessUtxo && (input.witnessUtxo.value !== output.value || !equal(input.witnessUtxo.script, output.script))) throw new Error('Conflicting input amount or script');
    total += output.value;
  });
  let outputTotal = 0n, recipients = 0n;
  const outputs = p.txOutputs.map((output, i) => {
    const scriptHex = hex(output.script);
    if (!/^(76a914[0-9a-f]{40}88ac|a914[0-9a-f]{40}87|0014[0-9a-f]{40}|0020[0-9a-f]{64})$/.test(scriptHex)) throw new Error('Unsupported recipient script');
    let change = false;
    const derivations = p.data.outputs[i].bip32Derivation;
    if (derivations?.length) {
      if (derivations.length !== 1) throw new Error('Ambiguous output derivation');
      change = equal(ownedScript(account, derivations[0]), output.script);
      if (!change) throw new Error('False change output');
    }
    outputTotal += output.value;
    if (!change) recipients += output.value;
    return { address: address.fromOutputScript(output.script, networks.testnet), sats: output.value.toString(), change };
  });
  if (outputTotal > total || total > 2100000000000000n) throw new Error('Invalid transaction amounts');
  return { outputs, fee: (total - outputTotal).toString(), debit: (recipients + total - outputTotal).toString(), inputs: p.inputCount };
}
export function verifySignedPsbt(original: string, signed: string, account: PublicAccount): string {
  reviewPsbt(original, account);
  const a = Psbt.fromBuffer(psbtBytes(original), { network: networks.testnet });
  const b = Psbt.fromBuffer(psbtBytes(signed, 45000), { network: networks.testnet });
  if (!equal(a.data.globalMap.unsignedTx.toBuffer(), b.data.globalMap.unsignedTx.toBuffer())) throw new Error('Device returned a different transaction');
  // Only accept added partial signatures: revalidate them using ORIGINAL UTXOs.
  b.data.inputs.forEach((input, i) => {
    if (input.finalScriptSig || input.finalScriptWitness || input.partialSig?.length !== 1) throw new Error('Missing or unsupported device signatures');
    const signature = input.partialSig[0];
    if (!equal(signature.pubkey, a.data.inputs[i].bip32Derivation![0].pubkey) || signature.signature.at(-1) !== 1) throw new Error('Unexpected signing key or sighash');
    a.updateInput(i, { partialSig: [signature] });
  });
  if (!a.validateSignaturesOfAllInputs((pubkey, hash, signature) => secp256k1.verify(signature, hash, pubkey, { prehash: false, lowS: true }))) throw new Error('Invalid Bitcoin signature');
  // Return the original maps plus verified signatures, never untrusted metadata.
  return a.toBase64();
}
