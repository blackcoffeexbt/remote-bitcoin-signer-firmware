import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import type { Event } from 'nostr-tools/core';
import { hex, psbtHash, reviewPsbt, validateAccount, verifySignedPsbt } from './bitcoin.ts';
import type { Method, PublicAccount, ProgressStatus } from './protocol.ts';

export type Connection = { pubkey: string; relays: string[]; xpub?: string };
export function parsePairing(text: string): Connection & { token: string } {
  if (text.length > 2048) throw new Error('Pairing code is too long');
  const v = JSON.parse(text);
  if (!v || v.protocol !== 'bitcoin-signer' || v.version !== 1 ||
      typeof v.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(v.pubkey) ||
      typeof v.token !== 'string' || !/^[0-9a-f]{32}$/.test(v.token) ||
      !Array.isArray(v.relays) || !v.relays.length || v.relays.length > 3) throw new Error('Invalid device pairing code');
  const relays: string[] = v.relays.map((relay: unknown) => {
    if (typeof relay !== 'string' || relay.length > 200) throw new Error('Invalid relay URL');
    const url = new URL(relay);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('Use secure relay URLs on port 443');
    return url.href;
  });
  return { pubkey: v.pubkey, token: v.token, relays: [...new Set(relays)] };
}
export type Socket = {
  readyState: number; send(data: string): void; close(): void;
  onopen: (() => void) | null; onclose: (() => void) | null;
  onerror: (() => void) | null; onmessage: ((event: { data: unknown }) => void) | null;
};
export type ClientState = { status: string; pinRequired: boolean; deadline: number; connected: number };
const statuses: Record<string, number> = {
  'Ready to sign': 1, 'PIN required': 2, 'Decrypting wallet': 3,
  'Validating transaction': 4, 'Ready to sign — approve on device': 5,
  'Automatically approved': 5, 'Signing': 6, 'Signing complete': 7,
};
type Pending = {
  method: Method; hash: string; expires: number; wire: string; parent?: string;
  sequence: number; status?: ProgressStatus; resolve(value: unknown): void; reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>; retry: ReturnType<typeof setInterval>;
};
export class SignerClient {
  readonly clientKey: string;
  account?: PublicAccount;
  private secret: Uint8Array;
  private sockets = new Set<Socket>();
  private reconnects = new Set<ReturnType<typeof setTimeout>>();
  private pending = new Map<string, Pending>();
  private closed = false;
  private started = false;
  private busy = false;
  private state: ClientState = { status: 'Disconnected', pinRequired: false, deadline: 0, connected: 0 };
  private options: {
    secret: Uint8Array; connection: Connection; onState?: (state: ClientState) => void;
    socket?: (url: string) => Socket; now?: () => number; random?: (length: number) => Uint8Array;
    requestSeconds?: number;
  };
  constructor(options: SignerClient['options']) {
    this.options = options;
    this.secret = options.secret.slice();
    this.clientKey = getPublicKey(this.secret);
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private emit(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    this.options.onState?.({ ...this.state });
  }
  connect() {
    if (this.closed) throw new Error('Client closed; reconnect first');
    if (this.started) return;
    this.started = true;
    this.emit({ status: 'Connecting to relays' });
    this.options.connection.relays.forEach(url => this.open(url));
  }
  private open(url: string) {
    if (this.closed) return;
    const retry = () => {
      if (this.closed) return;
      const t = setTimeout(() => { this.reconnects.delete(t); this.open(url); }, 5000);
      this.reconnects.add(t);
    };
    let socket: Socket;
    try { socket = this.options.socket?.(url) ?? new WebSocket(url) as unknown as Socket; }
    catch { retry(); return; }
    this.sockets.add(socket);
    const send = (wire: string) => { try { socket.send(wire); } catch { socket.close(); } };
    socket.onopen = () => {
      if (this.closed) return;
      send(JSON.stringify(['REQ', 'bitcoin-v1', { kinds: [24134], authors: [this.options.connection.pubkey], '#p': [this.clientKey], since: Math.floor(this.now() / 1000) - 180 }]));
      this.emit({ connected: [...this.sockets].filter(s => s.readyState === 1).length });
      for (const p of this.pending.values()) if (this.now() < p.expires) send(p.wire);
    };
    socket.onmessage = event => this.receive(event.data);
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.sockets.delete(socket);
      this.emit({ connected: [...this.sockets].filter(s => s.readyState === 1).length });
      retry();
    };
  }
  private receive(wire: unknown) {
    try {
      if (this.closed || typeof wire !== 'string' || wire.length > 100000) return;
      const envelope = JSON.parse(wire);
      if (!Array.isArray(envelope) || envelope.length !== 3 || envelope[0] !== 'EVENT') return;
      const event = envelope[2] as Event;
      const now = Math.floor(this.now() / 1000);
      if (!event || event.pubkey !== this.options.connection.pubkey || event.kind !== 24134 ||
        !Number.isInteger(event.created_at) || event.created_at > now + 30 || event.created_at < now - 180 ||
        JSON.stringify(event.tags) !== JSON.stringify([['p', this.clientKey]]) || !verifyEvent(event)) return;
      const key = nip44.utils.getConversationKey(this.secret, event.pubkey);
      let clear: string;
      try { clear = nip44.decrypt(event.content, key); } finally { key.fill(0); }
      const r = JSON.parse(clear); clear = '';
      const p = r && this.pending.get(r.id);
      if (!p || this.now() >= p.expires || r.protocol !== 'bitcoin-signer' || r.version !== 1 ||
        r.network !== 'Testnet4' || r.method !== p.method || r.psbt_hash !== p.hash) return;
      const variants = ['result', 'error', 'status'].filter(k => Object.prototype.hasOwnProperty.call(r, k));
      if (variants.length !== 1) return;
      if (r.status !== undefined) {
        if (p.method !== 'sign_psbt' || typeof r.status !== 'string' || !statuses[r.status] ||
          statuses[r.status] !== r.sequence || r.sequence <= p.sequence) return;
        p.sequence = r.sequence; p.status = r.status;
        this.emit({ status: r.status, pinRequired: r.status === 'PIN required' && ![...this.pending.values()].some(v => v.parent === r.id), deadline: p.expires });
        return;
      }
      if (r.error !== undefined && (typeof r.error !== 'string' || !r.error.length || r.error.length > 500)) return;
      if (r.result !== undefined && (!r.result || typeof r.result !== 'object' || Array.isArray(r.result))) return;
      this.settle(r.id, r.error ? new Error(r.error) : undefined, r.result);
    } catch { /* Ignore malformed, unrelated or unauthenticated relay data. */ }
  }
  private settle(id: string, error?: Error, result?: unknown) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer); clearInterval(p.retry); this.pending.delete(id);
    if (p.method === 'sign_psbt') {
      for (const [child, value] of this.pending) if (value.parent === id) this.settle(child, error, {});
      this.emit({ pinRequired: false, deadline: 0 });
    }
    if (error) p.reject(error); else p.resolve(result);
  }
  private request(method: Method, params: Record<string, unknown> = {}, hash = '', parent?: string) {
    if (this.closed) return Promise.reject(new Error('Disconnected'));
    const now = Math.floor(this.now() / 1000);
    const id = hex(this.options.random?.(16) ?? globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const expires = parent ? this.pending.get(parent)!.expires : (now + (this.options.requestSeconds ?? 150)) * 1000;
    const key = nip44.utils.getConversationKey(this.secret, this.options.connection.pubkey);
    let event: Event;
    try {
      event = finalizeEvent({ kind: 24134, created_at: now, tags: [['p', this.options.connection.pubkey]],
        content: nip44.encrypt(JSON.stringify({ protocol: 'bitcoin-signer', version: 1, network: 'Testnet4', id, method, expires: Math.floor(expires / 1000), psbt_hash: hash, params }), key) }, this.secret);
    } finally { key.fill(0); if (method === 'unlock') params.pin = ''; }
    const wire = JSON.stringify(['EVENT', event]);
    return new Promise<unknown>((resolve, reject) => {
      const publish = () => {
        if (this.closed || this.now() >= expires) return;
        for (const socket of this.sockets) if (socket.readyState === 1) {
          try { socket.send(wire); } catch { socket.close(); }
        }
      };
      const timer = setTimeout(() => this.settle(id, new Error('Request timed out. Check the device and LNbits before retrying; it may already have signed.')), Math.max(0, expires - this.now()));
      const retry = setInterval(publish, 5000);
      this.pending.set(id, { method, hash, expires, wire, parent, sequence: 0, resolve, reject, timer, retry });
      this.emit({ deadline: expires }); publish();
    });
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('A request is already active');
    this.busy = true;
    try { this.connect(); return await work(); }
    finally { this.busy = false; this.emit({ pinRequired: false, deadline: 0 }); }
  }
  private acceptAccount(value: unknown) {
    const account = validateAccount(value);
    if (this.options.connection.xpub && this.options.connection.xpub !== account.xpub) throw new Error('Device account changed. Forget and pair again after checking the device.');
    this.options.connection.xpub = account.xpub; this.account = account;
    return account;
  }
  pair(token: string, label: string) {
    if (!/^[0-9a-f]{32}$/.test(token) || !/^[\x20-\x7e]{1,40}$/.test(label)) return Promise.reject(new Error('Use a valid pairing token and a 1–40 character plain-text label'));
    return this.exclusive(async () => {
      this.emit({ status: 'Compare this phone’s public key and approve pairing on the ESP32' });
      const account = this.acceptAccount(await this.request('pair', { token, label }));
      this.emit({ status: 'Device paired' }); return account;
    });
  }
  getAccount() {
    return this.exclusive(async () => {
      this.emit({ status: 'Retrieving public account' });
      const account = this.acceptAccount(await this.request('get_account'));
      this.emit({ status: 'Device connected' }); return account;
    });
  }
  sign(psbt: string) {
    return this.exclusive(async () => {
      const hash = psbtHash(psbt);
      this.emit({ status: 'Refreshing device session' });
      const account = this.acceptAccount(await this.request('get_account'));
      reviewPsbt(psbt, account);
      this.emit({ status: 'Requesting device signature' });
      const result = await this.request('sign_psbt', { psbt, session: account.session }, hash) as { psbt?: unknown };
      if (typeof result.psbt !== 'string') throw new Error('Missing signed PSBT');
      this.emit({ status: 'Verifying Bitcoin signatures' });
      const verified = verifySignedPsbt(psbt, result.psbt, account);
      this.emit({ status: 'Signed PSBT verified. Return it to LNbits for broadcast.' });
      return verified;
    });
  }
  async submitPin(pin: string) {
    if (!/^[0-9]{6,32}$/.test(pin)) throw new Error('Use a wallet PIN of 6–32 digits');
    const entry = [...this.pending].find(([, p]) => p.method === 'sign_psbt');
    if (!entry || entry[1].status !== 'PIN required' || [...this.pending.values()].some(p => p.parent === entry[0])) throw new Error('No active PIN request');
    this.emit({ pinRequired: false });
    try {
      const reply = this.request('unlock', { pin, request_id: entry[0], session: this.account!.session }, entry[1].hash, entry[0]);
      pin = '';
      await reply;
    }
    catch (error) {
      if (this.pending.get(entry[0])?.status === 'PIN required') this.emit({ pinRequired: true });
      throw error;
    }
    finally { pin = ''; }
  }
  close() {
    this.closed = true;
    for (const t of this.reconnects) clearTimeout(t);
    this.reconnects.clear();
    for (const socket of this.sockets) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.close(); }
    this.sockets.clear();
    for (const id of [...this.pending.keys()]) this.settle(id, new Error('Stopped waiting. This does not cancel signing on the device; check it before retrying.'));
    this.secret.fill(0); this.account = undefined;
    this.emit({ connected: 0, pinRequired: false, deadline: 0 });
  }
}
