/** Current firmware wire contract. Types alone do not authenticate relay input. */
export const PROTOCOL = 'bitcoin-signer' as const;
export const VERSION = 1 as const;
export const NETWORK = 'Testnet4' as const;
export const EVENT_KIND = 24134;
export const REQUEST_SECONDS = 150;
export const MAX_PSBT_BYTES = 32_768;
export type Method = 'pair' | 'get_account' | 'sign_psbt' | 'unlock';
export type Params = {
  pair: { token: string; label: string };
  get_account: Record<string, never>;
  sign_psbt: { session: string; psbt: string };
  unlock: { session: string; request_id: string; pin: string };
};
export type Binding<M extends Method = Method> = {
  protocol: typeof PROTOCOL; version: typeof VERSION; network: typeof NETWORK;
  id: string; method: M; psbt_hash: string;
};
export type Request = {
  [M in Method]: Binding<M> & { expires: number; params: Params[M] }
}[Method];
export type PublicAccount = {
  descriptor: string; xpub: string; fingerprint: string; path: string; session: string;
};
export type ProgressStatus =
  | 'Ready to sign' | 'PIN required' | 'Decrypting wallet'
  | 'Validating transaction' | 'Ready to sign — approve on device'
  | 'Automatically approved' | 'Signing' | 'Signing complete';
export type Response = Binding & (
  | { result: PublicAccount | { psbt: string } | Record<string, never>; error?: never; status?: never }
  | { error: string; result?: never; status?: never }
  | { status: ProgressStatus; sequence: number; result?: never; error?: never }
);
