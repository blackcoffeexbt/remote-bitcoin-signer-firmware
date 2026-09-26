import { getRandomValues } from 'expo-crypto';
// Must run before nostr-tools/noble imports. Never fall back to Math.random.
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: {} });
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: getRandomValues, configurable: true });
}
