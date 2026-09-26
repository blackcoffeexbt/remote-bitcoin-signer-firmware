import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from './bitcoin';
import { parseEndpoint } from './electrum';
import { validateCursor } from './wallet';
import type { AddressCursor } from './wallet';
import type { PublicAccount } from './protocol';
import { readRecovery, writeRecovery, clearRecovery } from './recovery';
import type { Journal, SavedPayment } from './recovery';
export type { SavedPayment } from './recovery';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const accountId = (account: PublicAccount) => hex(sha256(new TextEncoder().encode(account.xpub)));
export async function loadServer() { return (await SecureStore.getItemAsync('wallet.electrs.v1')) ?? ''; }
export async function saveServer(value: string) { await SecureStore.setItemAsync('wallet.electrs.v1', parseEndpoint(value).url, options); }
export async function loadCursor(account: PublicAccount): Promise<AddressCursor> {
  const raw = await SecureStore.getItemAsync(`wallet.cursor.${accountId(account)}`);
  return raw ? validateCursor(JSON.parse(raw)) : { receive: 0, change: 0 };
}
export async function saveCursor(account: PublicAccount, cursor: AddressCursor) {
  const old = await loadCursor(account);
  await SecureStore.setItemAsync(`wallet.cursor.${accountId(account)}`, JSON.stringify(validateCursor({ receive: Math.max(old.receive, cursor.receive), change: Math.max(old.change, cursor.change) })), options);
}
function journal(account: PublicAccount): Journal {
  const id = accountId(account), key = `wallet.payment.${id}`;
  const file = (slot: string) => new File(Paths.document, `payment-${id}${slot === 'legacy' ? '' : '-' + slot}.json`);
  return {
    readHead: () => SecureStore.getItemAsync(key),
    writeHead: value => value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value, options),
    read: async slot => { const f = file(slot); if (!f.exists) return null; if (f.size > 130000) throw new Error('Saved payment is too large'); return f.text(); },
    write: async (slot, text) => { const f = file(slot); f.create({ overwrite: true }); f.write(text); },
    remove: async slot => { const f = file(slot); if (f.exists) f.delete(); },
  };
}
export const loadPayment = (account: PublicAccount) => readRecovery(journal(account), account);
export const savePayment = (account: PublicAccount, payment: SavedPayment) => writeRecovery(journal(account), account, payment);
export const clearPayment = (account: PublicAccount) => clearRecovery(journal(account));
