import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type { PublicAccount } from './protocol';
import { ElectrumClient, parseEndpoint } from './electrum';
import { dialElectrum } from './electrum-native';
import { fetchFees } from './fees';
import type { Fees } from './fees';
import { buildPsbt, checkUnspent, deriveAddress, GAP, planPayment, syncWallet } from './wallet';
import type { Plan, Snapshot } from './wallet';
import { loadCursor, loadServer, saveCursor, saveServer } from './wallet-storage';
import { useClient } from './ClientProvider';

type Props = { account: PublicAccount | null; disabled: boolean; paymentPending: boolean; onBusyChange(busy: boolean): void; onPrepared(psbt: string): void; onInvalidate(): void };
function useWalletState({ account, disabled, paymentPending, onBusyChange, onPrepared, onInvalidate }: Props) {
  const [server, setServer] = useState(''), [savedServer, setSavedServer] = useState('');
  const [settingsReady, setSettingsReady] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [receive, setReceive] = useState('');
  const [destination, setDestination] = useState(''), [amount, setAmount] = useState(''), [maximum, setMaximum] = useState(false);
  const [feeTarget, setFeeTarget] = useState('hourFee');
  const [rate, setRate] = useState(''), [fees, setFees] = useState<Fees | null>(null), [estimated, setEstimated] = useState(false);
  const [manual, setManual] = useState(false), [selected, setSelected] = useState<string[]>([]), [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false), working = useRef(false), alive = useRef(true), rpc = useRef<ElectrumClient | null>(null);
  const generation = useRef(0);
  const lock = disabled || busy;
  useEffect(() => {
    const lifecycleGeneration = generation;
    let mounted = true;
    alive.current = true;
    void loadServer().then(value => { if (mounted) { setServer(value); setSavedServer(value); setSettingsReady(true); } }).catch(() => { if (mounted) setError('Could not load server preference'); });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { alive.current = false; lifecycleGeneration.current++; rpc.current?.close(); rpc.current = null; working.current = false; setBusy(false); onBusyChange(false); }
      else alive.current = true;
    });
    return () => { mounted = false; alive.current = false; lifecycleGeneration.current++; rpc.current?.close(); subscription.remove(); if (working.current) onBusyChange(false); };
    // Parent callbacks are stable for the lifetime of this keyed account panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (work: (active: () => boolean) => Promise<void>) => {
    if (!alive.current || working.current || disabled) return;
    const version = ++generation.current;
    const active = () => alive.current && version === generation.current;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try { await work(active); return active(); } catch (e) { if (active()) setError((e as Error).message); }
    finally { if (version === generation.current) { rpc.current?.close(); rpc.current = null; working.current = false; setBusy(false); onBusyChange(false); } }
  };
  const connect = async (active: () => boolean) => {
    if (!savedServer || server.trim() !== savedServer) throw new Error('Save your Electrs server address first');
    const client = new ElectrumClient(); rpc.current = client;
    await client.connect(savedServer, dialElectrum);
    if (!active()) { client.close(); throw new Error('Wallet interrupted'); }
    return client;
  };
  const invalidate = () => { onInvalidate(); setError(''); };
  const updateFees = () => void run(async active => {
    const result = await fetchFees();
    if (!active()) return;
    setFees(result); setStatus('Fees updated.');
    if (!rate || estimated) { setRate(String(result.hourFee)); setFeeTarget('hourFee'); setEstimated(true); invalidate(); }
  });
  const sync = () => account && run(async active => {
    invalidate(); setSnapshot(null); setSelected([]);
    const c = await connect(active), cursor = await loadCursor(account);
    const wallet = await syncWallet(c, account, cursor, text => { if (active()) setStatus(text); });
    if (!active()) return;
    await saveCursor(account, wallet.next);
    if (active()) { setSnapshot(wallet); setStatus(`Updated ${new Date(wallet.syncedAt).toLocaleTimeString()}`); }
  });
  const freshAddress = () => account && snapshot && run(async active => {
    const cursor = await loadCursor(account), index = cursor.receive;
    if (index - snapshot.lastUsed.receive > GAP) throw new Error('20 unused receive addresses have been issued. Use one and sync before requesting more.');
    const a = deriveAddress(account, 0, index);
    await saveCursor(account, { ...cursor, receive: index + 1 });
    if (active()) setReceive(a.address);
  });
  let plan: Plan | null = null, planError = '';
  if (snapshot && destination && (amount || maximum) && rate) {
    try { plan = planPayment(snapshot.coins, manual ? selected : null, destination, maximum ? 'max' : amount, rate, unconfirmed); }
    catch (e) { planError = (e as Error).message; }
  }
  const prepare = () => account && snapshot && plan && !paymentPending && run(async active => {
    if (Date.now() - snapshot.syncedAt > 300000) throw new Error('Wallet snapshot is over five minutes old. Sync again before preparing a payment.');
    if (estimated && (!fees || Date.now() - fees.fetchedAt > 300000)) throw new Error('Fee estimates are over five minutes old. Refresh or enter a manual rate.');
    const c = await connect(active); await checkUnspent(c, plan.coins);
    const cursor = await loadCursor(account), change = deriveAddress(account, 1, cursor.change);
    const original = buildPsbt(account, plan, change, snapshot.addresses);
    if (!active()) return;
    if (plan.change) {
      if (cursor.change - snapshot.lastUsed.change > GAP) throw new Error('20 unused change addresses are reserved. Complete an existing payment and sync before creating more.');
      await saveCursor(account, { ...cursor, change: cursor.change + 1 });
    }
    if (active()) { onPrepared(original); setStatus('Ready to review.'); }
  });
  const saveSettings = () => run(async active => {
    const parsed = parseEndpoint(server.trim()); await saveServer(parsed.url);
    if (active()) { setServer(parsed.url); setSavedServer(parsed.url); setSnapshot(null); setReceive(''); invalidate(); setStatus('Server saved.'); }
  });
  return { server, setServer, savedServer, settingsReady, status, error, setError, snapshot, receive, destination, setDestination,
    feeTarget, setFeeTarget, amount, setAmount, maximum, setMaximum, rate, setRate, fees, estimated, setEstimated, manual, setManual, selected, setSelected,
    unconfirmed, setUnconfirmed, busy, lock, invalidate, updateFees, sync, freshAddress, prepare, plan, planError, saveSettings };
}
const Context = createContext<ReturnType<typeof useWalletState> | null>(null);
function Session({ children }: { children: ReactNode }) {
  const c = useClient();
  const value = useWalletState({ account: c.account, disabled: c.busy || c.chainBusy || (!!c.account && c.recovery !== 'ready'),
    paymentPending: !!c.signed, onBusyChange: c.setChainBusy, onPrepared: c.prepare, onInvalidate: c.invalidate });
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const c = useClient();
  return <Session key={c.account?.xpub ?? 'unpaired'}>{children}</Session>;
}
export function useWallet() { const value = useContext(Context); if (!value) throw new Error('Missing wallet session'); return value; }
