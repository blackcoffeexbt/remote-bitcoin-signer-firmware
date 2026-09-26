export const FEE_URL = 'https://mempool.space/testnet4/api/v1/fees/recommended';
export type Fees = { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number; fetchedAt: number };
export function validateFees(value: unknown, now = Date.now()): Fees {
  if (!value || typeof value !== 'object') throw new Error('Invalid mempool.space fee response');
  const v = value as Fees;
  for (const key of ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee', 'minimumFee'] as const) {
    if (typeof v[key] !== 'number' || !Number.isFinite(v[key]) || v[key] <= 0 || v[key] > 10000) throw new Error('Invalid mempool.space fee response');
  }
  if (v.fastestFee < v.halfHourFee || v.halfHourFee < v.hourFee || v.hourFee < v.economyFee || v.economyFee < v.minimumFee) throw new Error('Inconsistent fee estimates');
  return { fastestFee: v.fastestFee, halfHourFee: v.halfHourFee, hourFee: v.hourFee, economyFee: v.economyFee, minimumFee: v.minimumFee, fetchedAt: now };
}
export async function fetchFees(fetcher: typeof fetch = fetch): Promise<Fees> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(FEE_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`mempool.space unavailable (${response.status}). Retry or enter a fee rate manually.`);
    const body = await response.text();
    if (body.length > 4096) throw new Error('Fee response too large');
    return validateFees(JSON.parse(body));
  } finally { clearTimeout(timer); }
}
