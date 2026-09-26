import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalStatus, formatBtc, formatSats, shorten, walletError } from '../src/presentation.ts';
test('wallet amounts retain exact satoshi precision when displayed as BTC', () => {
  assert.equal(formatBtc(1n), '0.00000001');
  assert.equal(formatBtc(2100000000000000n), '21,000,000.00000000');
  assert.equal(formatSats('123456789'), '123,456,789');
  assert.equal(formatBtc(0n), '0.00000000');
});
test('device progress is presented as a wallet action without echoing protocol internals', () => {
  assert.equal(approvalStatus('PIN required', true), 'Enter your device PIN');
  assert.equal(approvalStatus('Ready to sign — approve on device', false), 'Approve on your signing device');
  assert.equal(approvalStatus('Signing complete', false), 'Finishing your payment…');
  assert.equal(approvalStatus('internal relay details', false), 'Waiting for your signing device…');
});
test('backend errors never echo arbitrary details and preserve uncertain-payment guidance', () => {
  assert.equal(walletError(new Error('private debug payload abc123')), 'Could not complete this action. Check your connection and try again.');
  assert.match(walletError('Broadcast result is uncertain'), /payment status before/);
  assert.match(walletError('mempool.space unavailable (503)'), /custom fee/);
  assert.match(walletError('Server is not on Bitcoin Testnet4'), /different Bitcoin network/);
  assert.equal(walletError(''), '');
});
test('transaction previews shorten display without changing the source identifier', () => {
  const id = '12345678' + 'a'.repeat(48) + '87654321';
  assert.equal(shorten(id), '12345678…87654321'); assert.equal(id.length, 64);
  assert.equal(shorten('short'), 'short');
});
