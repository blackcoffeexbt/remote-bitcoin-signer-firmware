import { finalizePayment } from './wallet.ts';
import type { PublicAccount } from './protocol.ts';
export type SavedPayment = { original: string; signed: string; state: 'ready' | 'unknown' | 'submitted'; createdAt: number };
export interface Journal {
  readHead(): Promise<string | null>;
  writeHead(value: string | null): Promise<void>;
  read(slot: string): Promise<string | null>;
  write(slot: string, value: string): Promise<void>;
  remove(slot: string): Promise<void>;
}
export function decodePayment(text: string, account: PublicAccount): SavedPayment {
  if (text.length > 130000) throw new Error('Saved payment is too large');
  const p = JSON.parse(text) as SavedPayment;
  if (!p || typeof p.original !== 'string' || typeof p.signed !== 'string' || !['ready', 'unknown', 'submitted'].includes(p.state) || !Number.isSafeInteger(p.createdAt)) throw new Error('Invalid saved payment');
  finalizePayment(p.original, p.signed, account);
  return p;
}
async function head(journal: Journal) {
  const value = await journal.readHead();
  if (value !== null && value !== 'a' && value !== 'b') throw new Error('Invalid payment recovery pointer');
  return value;
}
export async function readRecovery(journal: Journal, account: PublicAccount): Promise<SavedPayment | null> {
  const active = await head(journal);
  if (active) {
    const text = await journal.read(active);
    if (text === null) throw new Error('Missing payment recovery record');
    return decodePayment(text, account);
  }
  // Read the initial v0.3 single-file format, but never ignore an interrupted
  // first journal write and silently authorize a replacement payment.
  const legacy = await journal.read('legacy');
  if (legacy !== null) return decodePayment(legacy, account);
  if (await journal.read('a') !== null || await journal.read('b') !== null) throw new Error('Interrupted payment save. Check transaction state before clearing recovery.');
  return null;
}
export async function writeRecovery(journal: Journal, account: PublicAccount, payment: SavedPayment) {
  const text = JSON.stringify(payment); decodePayment(text, account);
  const previous = await head(journal), target = previous === 'a' ? 'b' : 'a';
  // Never overwrite the active record. Only switch the secure pointer after
  // the inactive slot is completely written and verified by reading it back.
  await journal.write(target, text);
  const written = await journal.read(target);
  if (written !== text) throw new Error('Could not preserve the payment for recovery');
  decodePayment(written, account);
  await journal.writeHead(target);
  if (await head(journal) !== target) throw new Error('Could not commit payment recovery');
}
export async function clearRecovery(journal: Journal) {
  for (const slot of ['a', 'b', 'legacy']) await journal.remove(slot);
  await journal.writeHead(null);
}
