import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import { Psbt, Transaction, networks, payments } from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import type { PublicAccount } from '../src/protocol.ts';
const versions = { public: 0x043587cf, private: 0x04358394 };
// Disposable deterministic test-only Bitcoin keys; never imported by the app.
export function fixture() {
  const root = HDKey.fromMasterSeed(new Uint8Array(32).fill(7), versions);
  const accountKey = root.derive("m/84'/1'/0'");
  const child = accountKey.deriveChild(0).deriveChild(0);
  const fingerprint = Buffer.alloc(4); fingerprint.writeUInt32BE(root.fingerprint);
  const xpub = accountKey.publicExtendedKey;
  const account: PublicAccount = { xpub, fingerprint: fingerprint.toString('hex'), path: "m/84'/1'/0'", session: 'b'.repeat(32), descriptor: `wpkh([${fingerprint.toString('hex')}/84h/1h/0h]${xpub}/<0;1>/*)#aaaaaaaa` };
  const own = payments.p2wpkh({ pubkey: child.publicKey!, network: networks.testnet });
  const previous = new Transaction(); previous.addInput(new Uint8Array(32), 0xffffffff); previous.addOutput(own.output!, 100000n);
  const psbt = new Psbt({ network: networks.testnet }).setVersion(2).setLocktime(0);
  psbt.addInput({ hash: previous.getHash(), index: 0, sequence: 0xffffffff, nonWitnessUtxo: previous.toBuffer(), witnessUtxo: { value: 100000n, script: own.output! }, bip32Derivation: [{ path: "m/84'/1'/0'/0/0", pubkey: child.publicKey!, masterFingerprint: fingerprint }] });
  psbt.addOutput({ script: payments.p2wpkh({ pubkey: secp256k1.getPublicKey(new Uint8Array(32).fill(8)), network: networks.testnet }).output!, value: 99000n });
  const signer = { publicKey: child.publicKey!, sign: (hash: Uint8Array) => secp256k1.sign(hash, child.privateKey!, { prehash: false }) };
  const unsigned = psbt.toBase64();
  const signed = psbt.clone().signAllInputs(signer).toBase64();
  return { account, psbt, unsigned, signed, signer };
}
