import test from 'node:test';
import assert from 'node:assert/strict';
import { FEE_URL, fetchFees, validateFees } from '../src/fees.ts';
const good = { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 };
test('requests only the Testnet4 mempool.space fee endpoint and timestamps estimates', async () => {
  let requested = '';
  const fetcher: typeof fetch = async input => { requested = String(input); return new Response(JSON.stringify(good)); };
  const fees = await fetchFees(fetcher);
  assert.equal(requested, FEE_URL); assert.equal(fees.hourFee, 1); assert.ok(fees.fetchedAt > 0);
});
test('unavailable or malformed fee estimates fail with no mainnet fallback', async () => {
  await assert.rejects(fetchFees(async () => new Response('', { status: 503 })), /503/);
  await assert.rejects(fetchFees(async () => new Response('x'.repeat(4097))), /too large/);
  for (const v of [null, {}, { ...good, hourFee: '1' }, { ...good, fastestFee: NaN }, { ...good, minimumFee: 0 }, { ...good, fastestFee: 10001 }, { ...good, fastestFee: 1 }]) assert.throws(() => validateFees(v));
});
