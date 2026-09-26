import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, reducer } from '../src/demo.ts';

const id = '1'.repeat(32);
const paired = () => reducer(reducer(initialState, { type: 'pair', now: 0 }), { type: 'confirmPair', now: 1 });
const pending = () => reducer(paired(), { type: 'request', id, now: 10 });

test('cannot request unpaired or approve before PIN unlock', () => {
  assert.equal(reducer(initialState, { type: 'request', id, now: 0 }), initialState);
  const state = pending();
  assert.equal(reducer(state, { type: 'approve', id, now: 20 }), state);
});
test('pairing expires and requires fresh local confirmation', () => {
  const state = reducer(initialState, { type: 'pair', now: 0 });
  assert.equal(reducer(state, { type: 'confirmPair', now: 180_000 }).paired, false);
  assert.equal(reducer(state, { type: 'confirmPair', now: 179_999 }).paired, true);
});
test('complete manual journey needs unlock, approval and final completion', () => {
  let state = pending();
  for (const [type, stage] of [['unlock', 'review'], ['approve', 'signing'], ['finish', 'complete']] as const) {
    state = reducer(state, { type, id, now: 20 });
    assert.equal(state.stage, stage);
  }
  assert.equal(state.requestId, null);
});
test('stale callbacks and a second request cannot replace live review', () => {
  const state = reducer(pending(), { type: 'unlock', id, now: 20 });
  assert.equal(reducer(state, { type: 'approve', id: '2'.repeat(32), now: 30 }), state);
  assert.equal(reducer(state, { type: 'request', id: '2'.repeat(32), now: 30 }), state);
});
test('expiry wins even if display timer has not ticked', () => {
  const state = reducer(pending(), { type: 'unlock', id, now: 20 });
  assert.equal(reducer(state, { type: 'approve', id, now: 150_010 }).stage, 'expired');
  assert.equal(reducer(state, { type: 'approve', id, now: 150_009 }).stage, 'signing');
});
test('background/lock cancels and stale completion cannot revive request', () => {
  const state = reducer(pending(), { type: 'lock' });
  assert.equal(state.stage, 'locked');
  assert.equal(state.requestId, null);
  assert.equal(reducer(state, { type: 'finish', id, now: 50 }), state);
  assert.equal(reducer(state, { type: 'approve', id, now: 50 }), state);
});
test('rejection and revocation terminate the request', () => {
  const rejected = reducer(pending(), { type: 'reject', id, now: 50 });
  assert.equal(rejected.stage, 'rejected');
  assert.equal(rejected.requestId, null);
  assert.deepEqual(reducer(pending(), { type: 'revoke' }), initialState);
});
test('deadline applies while simulating signing too', () => {
  let state = reducer(pending(), { type: 'unlock', id, now: 20 });
  state = reducer(state, { type: 'approve', id, now: 30 });
  assert.equal(reducer(state, { type: 'finish', id, now: 150_010 }).stage, 'expired');
});
