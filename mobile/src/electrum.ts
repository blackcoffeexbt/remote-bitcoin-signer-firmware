import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';

// Bitcoin Core's Testnet4 genesis. Addresses alone cannot distinguish test networks.
export const TESTNET4_GENESIS = '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043';
export type Endpoint = { url: string; host: string; port: number; tls: boolean };
export function parseEndpoint(text: string): Endpoint {
  if (text.length > 240 || /\s/.test(text)) throw new Error('Use ssl://host:port or tcp://host:port');
  let u: URL;
  try { u = new URL(text); } catch { throw new Error('Use ssl://host:port or tcp://host:port'); }
  if (!['ssl:', 'tcp:'].includes(u.protocol) || !u.hostname || !u.port || u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) throw new Error('Electrs needs an Electrum TCP/TLS address, including its port');
  const port = Number(u.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');
  return { url: `${u.protocol}//${u.host}`, host: u.hostname.replace(/^\[|\]$/g, ''), port, tls: u.protocol === 'ssl:' };
}
export interface Rpc { request(method: string, params?: unknown[]): Promise<unknown> }
export type Wire = { write(data: string): void; close(): void };
export type Dial = (endpoint: Endpoint, ready: () => void, data: (chunk: string) => void, failed: (error: Error) => void) => Wire;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
export class ElectrumClient implements Rpc {
  private wire?: Wire;
  private pending = new Map<number, Pending>();
  private counter = 0;
  private buffer = '';
  private closed = false;
  private verified = false;
  private connectingReject?: (error: Error) => void;
  private timeoutMs: number;
  constructor(timeoutMs = 15000) { this.timeoutMs = timeoutMs; }
  async connect(address: string, dial: Dial) {
    if (this.wire || this.closed) throw new Error('Create a new server connection');
    const endpoint = parseEndpoint(address);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => this.close(new Error('Electrs connection timed out')), this.timeoutMs);
        this.connectingReject = error => { clearTimeout(timer); reject(error); };
        try {
          this.wire = dial(endpoint, () => { clearTimeout(timer); this.connectingReject = undefined; resolve(); },
            chunk => this.receive(chunk), error => this.close(error));
          if (this.closed) this.wire.close();
        } catch (e) { this.close(e instanceof Error ? e : new Error('Could not connect to Electrs')); }
      });
      const version = await this.call('server.version', ['RemoteSigner/0.3', '1.4']);
      if (!Array.isArray(version) || typeof version[1] !== 'string' || !/^1\.4(?:\.|$)/.test(version[1])) throw new Error('Electrs must support Electrum protocol 1.4');
      const header = await this.call('blockchain.block.header', [0]);
      if (typeof header !== 'string' || !/^[0-9a-fA-F]{160}$/.test(header) ||
        Buffer.from(sha256(sha256(Buffer.from(header, 'hex')))).reverse().toString('hex') !== TESTNET4_GENESIS) throw new Error('Server is not on Bitcoin Testnet4');
      this.verified = true;
    } catch (e) { this.close(); throw e; }
  }
  request(method: string, params: unknown[] = []) {
    if (!this.verified) return Promise.reject(new Error('Connect to a verified Testnet4 server first'));
    return this.call(method, params);
  }
  private call(method: string, params: unknown[]) {
    if (this.closed || !this.wire) return Promise.reject(new Error('Electrs is disconnected'));
    if (this.pending.size >= 16) return Promise.reject(new Error('Too many Electrs requests'));
    const id = ++this.counter;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('Electrs request timed out; a broadcast may still have been accepted')), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.wire!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }
      catch { this.close(new Error('Electrs connection failed')); }
    });
  }
  private receive(chunk: string) {
    if (this.closed) return;
    if (chunk.length > 2100000 || this.buffer.length + chunk.length > 2100000) { this.close(new Error('Electrs response too large')); return; }
    this.buffer += chunk;
    for (let end = this.buffer.indexOf('\n'); end !== -1; end = this.buffer.indexOf('\n')) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        if (!Number.isSafeInteger(message.id)) continue; // unsolicited notifications
        const p = this.pending.get(message.id);
        if (!p) continue;
        const result = Object.hasOwn(message, 'result'), error = message.error != null;
        if (result === error) throw new Error();
        clearTimeout(p.timer); this.pending.delete(message.id);
        if (error) p.reject(new Error(`Electrs: ${typeof message.error.message === 'string' ? message.error.message.slice(0, 180) : 'Request refused'}`));
        else p.resolve(message.result);
      } catch { this.close(new Error('Malformed Electrs response')); return; }
    }
  }
  close(error = new Error('Electrs disconnected')) {
    if (this.closed) return;
    this.closed = true; this.verified = false;
    this.connectingReject?.(error); this.connectingReject = undefined;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.buffer = ''; this.wire?.close();
  }
}
