import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.ts';
import { clearRecovery, readRecovery, writeRecovery } from '../src/recovery.ts';
import type { Journal, SavedPayment } from '../src/recovery.ts';
function setup() {
  const f = fixture(), files = new Map<string, string>();
  let pointer: string | null = null;
  const journal: Journal = {
    readHead: async () => pointer, writeHead: async value => { pointer = value; },
    read: async slot => files.get(slot) ?? null, write: async (slot, text) => { files.set(slot, text); },
    remove: async slot => { files.delete(slot); },
  };
  const payment: SavedPayment = { original: f.unsigned, signed: f.signed, state: 'ready', createdAt: 1 };
  return { ...f, journal, files, payment };
}
test('restores a verified signed payment through ready, unknown and submitted states', async () => {
  const f = setup(); assert.equal(await readRecovery(f.journal, f.account), null);
  for (const state of ['ready', 'unknown', 'submitted'] as const) {
    await writeRecovery(f.journal, f.account, { ...f.payment, state });
    assert.equal((await readRecovery(f.journal, f.account))?.state, state);
  }
  assert.equal(f.files.size, 2);
  await clearRecovery(f.journal); assert.equal(await readRecovery(f.journal, f.account), null);
});
test('disk-full or interrupted replacement retains the previous complete record', async () => {
  const f = setup(); await writeRecovery(f.journal, f.account, f.payment);
  const damaged: Journal = { ...f.journal, write: async (slot, value) => { f.files.set(slot, value.slice(0, 20)); throw new Error('disk full'); } };
  await assert.rejects(writeRecovery(damaged, f.account, { ...f.payment, state: 'unknown' }), /disk full/);
  assert.equal((await readRecovery(f.journal, f.account))?.state, 'ready');
  const failedPointer: Journal = { ...f.journal, writeHead: async () => { throw new Error('locked'); } };
  await assert.rejects(writeRecovery(failedPointer, f.account, { ...f.payment, state: 'unknown' }), /locked/);
  assert.equal((await readRecovery(f.journal, f.account))?.state, 'ready');
});
test('an interrupted first save blocks replacement rather than appearing empty', async () => {
  const f = setup();
  const failed: Journal = { ...f.journal, writeHead: async () => { throw new Error('storage failure'); } };
  await assert.rejects(writeRecovery(failed, f.account, f.payment));
  await assert.rejects(readRecovery(f.journal, f.account), /Interrupted/);
  await clearRecovery(f.journal); assert.equal(await readRecovery(f.journal, f.account), null);
});
test('tampered or missing recovery data is rejected on restart', async () => {
  const f = setup(); await writeRecovery(f.journal, f.account, f.payment);
  const slot = (await f.journal.readHead())!;
  f.files.set(slot, JSON.stringify({ ...f.payment, signed: f.unsigned }));
  await assert.rejects(readRecovery(f.journal, f.account));
  f.files.delete(slot); await assert.rejects(readRecovery(f.journal, f.account), /Missing/);
});
