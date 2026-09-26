import * as SecureStore from 'expo-secure-store';
import { generateSecretKey } from 'nostr-tools/pure';
import { Buffer } from 'buffer';
import type { Connection } from './client';
import { parsePairing } from './client';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const keyName = 'signer-client.identity.v1';
const connectionName = 'signer-client.connection.v1';
export async function loadIdentity(): Promise<Uint8Array> {
  const saved = await SecureStore.getItemAsync(keyName);
  if (saved !== null) {
    if (!/^[0-9a-f]{64}$/.test(saved)) throw new Error('Damaged client identity. Reset the connection to pair again.');
    return new Uint8Array(Buffer.from(saved, 'hex'));
  }
  const secret = generateSecretKey();
  await SecureStore.setItemAsync(keyName, Buffer.from(secret).toString('hex'), options);
  return secret;
}
export async function loadConnection(): Promise<Connection | null> {
  const saved = await SecureStore.getItemAsync(connectionName);
  if (!saved) return null;
  const value = JSON.parse(saved);
  const parsed = parsePairing(JSON.stringify({ ...value, protocol: 'bitcoin-signer', version: 1, token: '0'.repeat(32) }));
  if (value.xpub !== undefined && (typeof value.xpub !== 'string' || value.xpub.length > 120)) throw new Error('Invalid saved public account');
  return { pubkey: parsed.pubkey, relays: parsed.relays, ...(value.xpub ? { xpub: value.xpub } : {}) };
}
export async function saveConnection(value: Connection) {
  // Never persist the pairing token, PIN, PSBT or Bitcoin private material.
  await SecureStore.setItemAsync(connectionName, JSON.stringify({ pubkey: value.pubkey, relays: value.relays, xpub: value.xpub }), options);
}
export async function forgetConnection() {
  await SecureStore.deleteItemAsync(connectionName);
  await SecureStore.deleteItemAsync(keyName);
}
