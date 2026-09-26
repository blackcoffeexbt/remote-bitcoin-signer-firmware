import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, Text, TextInput, View, Share, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getPublicKey } from 'nostr-tools/pure';
import { Buffer } from 'buffer';
import { SignerClient, parsePairing } from './src/client';
import type { ClientState, Connection } from './src/client';
import type { PublicAccount } from './src/protocol';
import { reviewPsbt } from './src/bitcoin';
import type { Review } from './src/bitcoin';
import { loadIdentity, loadConnection, saveConnection, forgetConnection } from './src/storage';
import { Button, styles } from './src/ui';
import { WalletPanel } from './src/WalletPanel';
import { BroadcastPanel } from './src/BroadcastPanel';
import { loadPayment, savePayment, clearPayment } from './src/wallet-storage';

const initial: ClientState = { status: 'Pair your ESP32 signing device to begin.', connected: 0, pinRequired: false, deadline: 0 };
function ClientApp() {
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
  const [label, setLabel] = useState('Mobile client');
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
    setState({ ...initial, status: 'Disconnected. Stopping this app does not cancel a request already on the ESP32.' });
  };
  useEffect(() => {
    let mounted = true;
    init().then(value => { if (mounted) { setIdentity(value.pubkey); setConnection(value.connection); setReady(true); } }).catch(() => { if (mounted) setError('Could not load secure client storage. Unlock the phone or reset the connection.'); });
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
  const clearSaved = () => account && Alert.alert('Clear this payment from the phone?', 'This does not cancel a signature or a broadcast. Check its transaction ID and history before sending another payment. Save a copy if you still need it.', [
    { text: 'Keep payment', style: 'cancel' }, { text: 'Clear local payment', style: 'destructive', onPress: () => void (async () => {
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
    try { if (!account) throw new Error('Reconnect to retrieve the public account first'); setReview(reviewPsbt(psbt.trim(), account)); setSigned(''); setError(''); }
    catch (e) { setReview(null); setError((e as Error).message); }
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
    if (!result.granted) { setError('Camera access denied. Paste the device pairing JSON instead.'); return; }
    scanningRef.current = true; setScanning(true);
  };
  const forget = () => Alert.alert('Forget this device?', 'This removes this phone’s connection and transport identity. Revoke the old phone key in ESP32 Settings → Paired browsers as well.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget', style: 'destructive', onPress: () => { stop(); void forgetConnection().then(() => { setAccount(null); setConnection(null); setReview(null); setSigned(''); setPsbt(''); return init().then(value => { setIdentity(value.pubkey); setConnection(value.connection); setReady(true); }); }).catch(() => setError('Could not clear secure storage')); } },
  ]);
  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.brand}>REMOTE SIGNER / CLIENT</Text><Text style={styles.network}>TESTNET4 · BITCOIN KEYS STAY ON THE ESP32</Text>
    {!foreground ? <Text style={styles.title}>Client paused</Text> : <>
      <Text style={styles.title}>Your Bitcoin wallet. Your signing device.</Text>
      <Text accessibilityLiveRegion="polite" style={styles.text}>{state.status}</Text>
      <Text style={styles.muted}>{state.connected} relay connection{state.connected === 1 ? '' : 's'}{state.deadline ? ` · ${Math.max(0, Math.ceil((state.deadline - now) / 1000))}s remaining` : ''}</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <View style={styles.card}><Text style={styles.heading}>Phone identity</Text><Text selectable style={styles.mono}>{identity || 'Loading secure identity…'}</Text>
        <Text style={styles.muted}>Compare this key on the ESP32 when pairing. It is a Nostr transport identity, not a Bitcoin key.</Text>
      </View>
      {!busy && !chainBusy && <View style={styles.card}><Text style={styles.heading}>{connection ? 'Device connection' : 'Pair your ESP32'}</Text>
        {connection && <><Text selectable style={styles.mono}>{connection.pubkey}</Text><Text style={styles.muted}>{connection.relays.join('\n')}</Text><Button title="Reconnect / refresh account" onPress={reconnect} disabled={!ready} /></>}
        <Text style={styles.text}>On the ESP32, open Settings → Pair a browser. Scan its QR or paste the pairing JSON, then approve on the device.</Text>
        <Button title="Scan pairing QR" secondary onPress={() => void scan()} disabled={!ready} />
        {scanning && <><CameraView style={{ height: 260 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => {
          if (!scanningRef.current) return; scanningRef.current = false; setScanning(false);
          try { parsePairing(data); setCode(data); setError(''); } catch { setError('This is not a valid signer pairing QR'); }
        }} /><Button title="Close scanner" secondary onPress={() => { scanningRef.current = false; setScanning(false); }} /></>}
        <TextInput accessibilityLabel="Device pairing JSON" style={styles.input} multiline value={code} onChangeText={setCode} placeholder="Paste device pairing JSON" placeholderTextColor="#839b90" autoCapitalize="none" autoCorrect={false} maxLength={2048} />
        <TextInput accessibilityLabel="Client label" style={styles.input} value={label} onChangeText={setLabel} maxLength={40} placeholder="Name shown on ESP32" placeholderTextColor="#839b90" />
        <Button title="Request pairing" onPress={pair} disabled={!ready || !code} />
        <Button title="Forget connection" secondary onPress={forget} />
      </View>}
      {account && <View style={styles.card}><Text style={styles.heading}>Device public account</Text><Text style={styles.text}>Fingerprint {account.fingerprint} · {account.path}</Text>
        <Button title="Share public account" secondary disabled={busy || chainBusy} onPress={() => void Share.share({ message: JSON.stringify({ descriptor: account.descriptor, xpub: account.xpub, fingerprint: account.fingerprint, path: account.path }, null, 2) }).catch(() => setError('Sharing failed'))} />
      </View>}
      <WalletPanel key={account?.xpub ?? 'unpaired'} account={account} disabled={busy || chainBusy || (!!account && recovery !== 'ready')} paymentPending={!!signed} onBusyChange={setChainBusy}
        onInvalidate={() => { if (!signed) { setReview(null); setPsbt(''); } }} onPrepared={value => { if (account) { setPsbt(value); setReview(reviewPsbt(value, account)); setSigned(''); setError(''); } }} />
      {account && (signed || recovery === 'error') && <Button title="Clear saved payment / start another" secondary disabled={busy || chainBusy} onPress={clearSaved} />}
      {connection && <View style={styles.card}><Text style={styles.heading}>Transaction review / PSBT import</Text><Text style={styles.text}>Prepare a payment above, or optionally import a PSBT with full previous transactions. Review below before requesting a device signature.</Text>
        <TextInput accessibilityLabel="Unsigned PSBT base64" editable={!busy && !chainBusy && !signed && recovery === 'ready'} style={[styles.input, { minHeight: 100 }]} value={psbt} onChangeText={value => { setPsbt(value); setReview(null); setSigned(''); }} multiline autoCapitalize="none" autoCorrect={false} maxLength={43692} placeholder="Paste unsigned PSBT (base64)" placeholderTextColor="#839b90" />
        <Button title="Import PSBT file" secondary disabled={busy || chainBusy || !!signed || recovery !== 'ready'} onPress={() => void importFile()} />
        <Button title="Review transaction" disabled={busy || chainBusy || !!signed || !account || !psbt || recovery !== 'ready'} onPress={inspect} />
        {review && <><Text style={styles.heading}>{review.inputs} input(s) · Fee {review.fee} sats</Text>
          {review.outputs.map((output, i) => <View key={i} style={styles.output}><Text style={styles.text}>{output.change ? 'Verified own output' : 'Recipient'} · {output.sats} sats</Text><Text selectable style={styles.mono}>{output.address}</Text></View>)}
          <Text style={styles.text}>Wallet debit: {review.debit} sats</Text><Text style={styles.muted}>Final approval is on the ESP32, unless its configured policy allows automatic approval. This phone cannot change that policy.</Text>
          <Button title="Request signature from ESP32" disabled={busy || chainBusy || !!signed || recovery !== 'ready'} onPress={sign} />
        </>}
      </View>}
      {state.pinRequired && <View style={styles.card}><Text style={styles.heading}>Device wallet PIN required</Text><Text style={styles.text}>Sent only to the paired ESP32 inside the encrypted, request-bound Nostr message. Never enter your settings PIN here.</Text>
        <TextInput accessibilityLabel="Device wallet PIN" style={styles.input} secureTextEntry autoFocus keyboardType="number-pad" autoComplete="off" value={pin} onChangeText={setPin} maxLength={32} />
        <Button title="Unlock this signing request" onPress={() => void unlock()} disabled={!/^[0-9]{6,32}$/.test(pin)} />
      </View>}
      {busy && <Button title="Stop waiting / disconnect" secondary onPress={stop} />}
      {!!signed && <View style={styles.card}><Text style={styles.heading}>Signed PSBT verified</Text><Text style={styles.text}>The transaction is unchanged and every Bitcoin signature is valid. Review the final transaction and broadcast below when ready. A signature does not send coins.</Text>
        <Button title="Copy signed PSBT" onPress={() => void Clipboard.setStringAsync(signed).then(() => Alert.alert('Copied', 'Verified signed PSBT copied.')).catch(() => setError('Clipboard unavailable'))} />
        <Button title="Share signed PSBT file" secondary onPress={() => void shareSigned()} />
      </View>}
      {!!signed && account && !busy && <BroadcastPanel key={signed} account={account} original={psbt.trim()} signed={signed} disabled={busy || chainBusy} onBusyChange={setChainBusy} />}
    </>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><ClientApp /></SafeAreaProvider>; }
