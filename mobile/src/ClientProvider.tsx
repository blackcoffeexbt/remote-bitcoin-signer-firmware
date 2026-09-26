import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import { useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getPublicKey } from 'nostr-tools/pure';
import { Buffer } from 'buffer';
import { SignerClient, parsePairing } from './client';
import type { ClientState, Connection } from './client';
import type { PublicAccount } from './protocol';
import { reviewPsbt } from './bitcoin';
import type { Review } from './bitcoin';
import { loadIdentity, loadConnection, saveConnection, forgetConnection } from './storage';
import { loadPayment, savePayment, clearPayment } from './wallet-storage';

const initial: ClientState = { status: 'Connect a signing device in Settings.', connected: 0, pinRequired: false, deadline: 0 };
function useClientState() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [identity, setIdentity] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chainBusy, setChainBusy] = useState(false);
  const [recovery, setRecovery] = useState<'loading' | 'ready' | 'error'>('loading');
  const [state, setState] = useState(initial);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('My phone');
  const [psbt, setPsbt] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [signed, setSigned] = useState('');
  const [pin, setPin] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [now, setNow] = useState(() => Date.now());
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const service = useRef<SignerClient | null>(null);
  const epoch = useRef(0);
  const working = useRef(false);
  const scanningRef = useRef(false);
  const init = async () => {
    const secret = await loadIdentity();
    let pubkey: string;
    try { pubkey = getPublicKey(secret); } finally { secret.fill(0); }
    return { pubkey, connection: await loadConnection() };
  };
  const stop = () => {
    epoch.current++; service.current?.close(); service.current = null;
    working.current = false; setBusy(false); setPin('');
    setState({ ...initial, status: 'Disconnected. Stopping this app does not cancel a request already on the signing device.' });
  };
  useEffect(() => {
    let mounted = true;
    init().then(value => { if (mounted) { setIdentity(value.pubkey); setConnection(value.connection); setReady(true); } }).catch(() => { if (mounted) setError('Could not load wallet settings. Unlock the phone or reset the connection.'); });
    const timer = setInterval(() => setNow(Date.now()), 500);
    const sub = AppState.addEventListener('change', next => {
      setForeground(next === 'active');
      if (next !== 'active') {
        epoch.current++; service.current?.close(); service.current = null;
        working.current = false; setBusy(false); setPin(''); setCode('');
        scanningRef.current = false; setScanning(false);
        setState({ ...initial, status: 'Disconnected while away. Reconnect to the device before a new request.' });
      }
    });
    // Invalidate current operations rather than capturing an obsolete epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted = false; clearInterval(timer); sub.remove(); epoch.current++; service.current?.close(); };
  }, []);
  const restorePayment = async (a: PublicAccount, version: number) => {
    setRecovery('loading');
    try {
      const saved = await loadPayment(a);
      if (epoch.current !== version) return;
      if (saved) { setPsbt(saved.original); setReview(reviewPsbt(saved.original, a)); setSigned(saved.signed); }
      setRecovery('ready');
    } catch {
      if (epoch.current === version) { setRecovery('error'); setError('Saved payment could not be verified. Do not create a replacement until you have checked the device and transaction history.'); }
    }
  };
  const clearSaved = () => account && Alert.alert('Start a new payment?', 'This removes the saved payment from this phone. It won’t cancel a payment that has already been sent. Check its status before continuing.', [
    { text: 'Keep payment', style: 'cancel' }, { text: 'Clear saved payment', style: 'destructive', onPress: () => void (async () => {
      setChainBusy(true);
      try { await clearPayment(account); setSigned(''); setPsbt(''); setReview(null); setRecovery('ready'); setError(''); }
      catch { setError('Could not clear saved payment'); }
      finally { setChainBusy(false); }
    })() },
  ]);
  const run = async (work: (version: number) => Promise<void>) => {
    if (working.current || chainBusy) return;
    working.current = true; setBusy(true); setError('');
    const version = ++epoch.current;
    try { await work(version); }
    catch (e) { if (epoch.current === version) setError(e instanceof Error ? e.message : 'Request failed'); }
    finally { if (epoch.current === version) { working.current = false; setBusy(false); setPin(''); } }
  };
  const client = async (config: Connection, version: number) => {
    service.current?.close();
    const secret = await loadIdentity();
    try {
      if (epoch.current !== version) throw new Error('Operation interrupted');
      const value = new SignerClient({ secret, connection: { ...config }, onState: s => { if (epoch.current === version) setState(s); } });
      service.current = value; return value;
    } finally { secret.fill(0); }
  };
  const pair = () => void run(async version => {
    const parsed = parsePairing(code.trim());
    const config: Connection = { pubkey: parsed.pubkey, relays: parsed.relays };
    setCode(''); setAccount(null); setReview(null); setSigned('');
    await saveConnection(config); setConnection(config);
    const c = await client(config, version);
    const a = await c.pair(parsed.token, label.trim());
    if (epoch.current !== version) return;
    const saved = { ...config, xpub: a.xpub };
    await saveConnection(saved); setConnection(saved); setAccount(a); await restorePayment(a, version);
  });
  const reconnect = () => connection && void run(async version => {
    const c = await client(connection, version); const a = await c.getAccount();
    if (epoch.current !== version) return;
    const saved = { ...connection, xpub: a.xpub };
    await saveConnection(saved); setConnection(saved); setAccount(a); await restorePayment(a, version);
  });
  const inspect = () => {
    try { if (!account) throw new Error('Reconnect to retrieve the public account first'); setReview(reviewPsbt(psbt.trim(), account)); setSigned(''); setError(''); return true; }
    catch (e) { setReview(null); setError((e as Error).message); return false; }
  };
  const sign = () => connection && void run(async version => {
    setSigned(''); const c = await client(connection, version);
    const result = await c.sign(psbt.trim());
    if (epoch.current === version && c.account) {
      setSigned(result); setAccount(c.account);
      await savePayment(c.account, { original: psbt.trim(), signed: result, state: 'ready', createdAt: Date.now() });
    }
  });
  const unlock = async () => {
    const current = service.current, version = epoch.current;
    let value = pin;
    setPin(''); setError('');
    try { const reply = current?.submitPin(value); value = ''; await reply; }
    catch (e) { if (epoch.current === version) setError((e as Error).message); }
  };
  const importFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0]; const file = new File(asset.uri);
      try {
        if (file.size > 45000) throw new Error('PSBT file is too large');
        const bytes = await file.bytes();
        setPsbt(Buffer.from(bytes.subarray(0, 5)).toString('hex') === '70736274ff' ? Buffer.from(bytes).toString('base64') : new TextDecoder().decode(bytes).trim());
        setReview(null); setSigned(''); setError('');
      } finally { if (file.exists && file.uri.startsWith(Paths.cache.uri)) file.delete(); }
    } catch (e) { setError((e as Error).message); }
  };
  const shareSigned = async () => {
    const file = new File(Paths.cache, 'signed-testnet4.psbt');
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('File sharing unavailable. Use Copy signed PSBT.');
      file.create({ overwrite: true }); file.write(Buffer.from(signed, 'base64'));
      await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Export verified signed PSBT' });
    } catch (e) { setError((e as Error).message); }
    finally { if (file.exists) file.delete(); }
  };
  const scan = async () => {
    const result = permission?.granted ? permission : await requestPermission();
    if (!result.granted) { setError('Camera access denied. Paste the pairing code instead.'); return; }
    scanningRef.current = true; setScanning(true);
  };
  const forget = () => Alert.alert('Forget this device?', 'This removes this phone’s connection and pairing information. Remove this phone from Paired browsers on your signing device as well.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget', style: 'destructive', onPress: () => { stop(); void forgetConnection().then(() => { setAccount(null); setConnection(null); setReview(null); setSigned(''); setPsbt(''); return init().then(value => { setIdentity(value.pubkey); setConnection(value.connection); setReady(true); }); }).catch(() => setError('Could not clear wallet settings')); } },
  ]);
  const acceptCode = (data: string) => {
    if (!scanningRef.current) return;
    scanningRef.current = false; setScanning(false);
    try { parsePairing(data); setCode(data); setError(''); } catch { setError('This is not a valid pairing code'); }
  };
  const prepare = (value: string) => { if (account) { setPsbt(value); setReview(reviewPsbt(value, account)); setSigned(''); setError(''); } };
  const invalidate = () => { if (!signed) { setReview(null); setPsbt(''); } };
  return { connection, account, identity, ready, busy, chainBusy, setChainBusy, recovery, state, error, setError,
    code, setCode, label, setLabel, psbt, setPsbt, review, signed, pin, setPin, scanning, now, foreground,
    stop, clearSaved, pair, reconnect, inspect, sign, unlock, importFile, shareSigned, scan, forget, acceptCode,
    closeScanner: () => { scanningRef.current = false; setScanning(false); }, prepare, invalidate };
}
const Context = createContext<ReturnType<typeof useClientState> | null>(null);
export function ClientProvider({ children }: { children: ReactNode }) {
  const value = useClientState();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useClient() { const value = useContext(Context); if (!value) throw new Error('Missing wallet provider'); return value; }
