import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Psbt, networks } from 'bitcoinjs-lib';
import { fixture } from './fixtures.ts';
import { reviewPsbt, verifySignedPsbt, validateAccount, receiveAddress, psbtBytes } from '../src/bitcoin.ts';

test('real BIP84 PSBT review, public account and signature round trip', () => {
  const f = fixture();
  assert.equal(validateAccount(f.account).xpub, f.account.xpub);
  assert.match(receiveAddress(f.account), /^tb1q/);
  assert.equal(reviewPsbt(f.unsigned, f.account).fee, '1000');
  const result = verifySignedPsbt(f.unsigned, f.signed, f.account);
  assert.equal(Psbt.fromBase64(result).data.inputs[0].partialSig?.length, 1);
});
test('reject changed transactions and invalid Bitcoin signatures', () => {
  const f = fixture();
  const different = f.psbt.clone().addOutput({ script: f.psbt.txOutputs[0].script, value: 1n }).signAllInputs(f.signer);
  assert.throws(() => verifySignedPsbt(f.unsigned, different.toBase64(), f.account), /different transaction/);
  const bad = Psbt.fromBase64(f.signed, { network: networks.testnet });
  bad.data.inputs[0].partialSig![0].signature[8] ^= 1;
  assert.throws(() => verifySignedPsbt(f.unsigned, bad.toBase64(), f.account));
});
test('returned metadata cannot change original UTXO amounts', () => {
  const f = fixture(); const modified = Psbt.fromBase64(f.signed);
  modified.data.inputs[0].witnessUtxo!.value = 1n;
  const result = Psbt.fromBase64(verifySignedPsbt(f.unsigned, modified.toBase64(), f.account));
  assert.equal(result.data.inputs[0].witnessUtxo!.value, 100000n);
});
test('reject foreign account, conflicting UTXO, missing signatures and pre-signed input', () => {
  const f = fixture();
  assert.throws(() => reviewPsbt(f.unsigned, { ...f.account, fingerprint: '00000000' }), /fingerprint/);
  const conflict = f.psbt.clone(); conflict.data.inputs[0].witnessUtxo!.value = 1n;
  assert.throws(() => reviewPsbt(conflict.toBase64(), f.account), /Conflicting/);
  assert.throws(() => verifySignedPsbt(f.unsigned, f.unsigned, f.account), /signatures/);
  assert.throws(() => reviewPsbt(f.signed, f.account), /unsigned/);
});
test('reject malformed/oversized PSBT and unsupported account', () => {
  for (const v of ['', 'AAAA', 'A'.repeat(44000)]) assert.throws(() => psbtBytes(v));
  const f = fixture();
  assert.throws(() => validateAccount({ ...f.account, path: "m/84'/0'/0'" }));
  assert.throws(() => validateAccount({ ...f.account, descriptor: 'bogus' }));
});
