import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Share, KeyboardAvoidingView, Platform } from 'react-native';
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
import { receiveAddress, reviewPsbt } from './src/bitcoin';
import type { Review } from './src/bitcoin';
import { loadIdentity, loadConnection, saveConnection, forgetConnection } from './src/storage';

function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && styles.dim]}>
    <Text style={[styles.buttonText, secondary && styles.white]}>{title}</Text>
  </Pressable>;
}
const initial: ClientState = { status: 'Pair your ESP32 signing device to begin.', connected: 0, pinRequired: false, deadline: 0 };
function ClientApp() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [identity, setIdentity] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const [now, setNow] = useState(Date.now());
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const service = useRef<SignerClient | null>(null);
  const epoch = useRef(0);
  const working = useRef(false);
  const scanningRef = useRef(false);
  const init = async () => {
    const secret = await loadIdentity();
    try { setIdentity(getPublicKey(secret)); } finally { secret.fill(0); }
    setConnection(await loadConnection()); setReady(true);
  };
  const stop = () => {
    epoch.current++; service.current?.close(); service.current = null;
    working.current = false; setBusy(false); setPin('');
    setState({ ...initial, status: 'Disconnected. Stopping this app does not cancel a request already on the ESP32.' });
  };
  useEffect(() => {
    let mounted = true;
    init().catch(() => { if (mounted) setError('Could not load secure client storage. Unlock the phone or reset the connection.'); });
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
    return () => { mounted = false; clearInterval(timer); sub.remove(); epoch.current++; service.current?.close(); };
  }, []);
  const run = async (work: (version: number) => Promise<void>) => {
    if (working.current) return;
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
    await saveConnection(saved); setConnection(saved); setAccount(a);
  });
  const reconnect = () => connection && void run(async version => {
    const c = await client(connection, version); const a = await c.getAccount();
    if (epoch.current !== version) return;
    const saved = { ...connection, xpub: a.xpub };
    await saveConnection(saved); setConnection(saved); setAccount(a);
  });
  const inspect = () => {
    try { if (!account) throw new Error('Reconnect to retrieve the public account first'); setReview(reviewPsbt(psbt.trim(), account)); setSigned(''); setError(''); }
    catch (e) { setReview(null); setError((e as Error).message); }
  };
  const sign = () => connection && void run(async version => {
    setSigned(''); const c = await client(connection, version);
    const result = await c.sign(psbt.trim());
    if (epoch.current === version) { setSigned(result); setAccount(c.account ?? null); }
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
      await Sharing.shareAsync(file.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Return signed PSBT to LNbits' });
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
    { text: 'Forget', style: 'destructive', onPress: () => { stop(); void forgetConnection().then(() => { setAccount(null); setConnection(null); setReview(null); setSigned(''); setPsbt(''); return init(); }).catch(() => setError('Could not clear secure storage')); } },
  ]);
  return <SafeAreaView style={styles.safe}><StatusBar style="light" /><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text style={styles.brand}>REMOTE SIGNER / CLIENT</Text><Text style={styles.network}>TESTNET4 · BITCOIN KEYS STAY ON THE ESP32</Text>
    {!foreground ? <Text style={styles.title}>Client paused</Text> : <>
      <Text style={styles.title}>Your signing device, connected.</Text>
      <Text accessibilityLiveRegion="polite" style={styles.text}>{state.status}</Text>
      <Text style={styles.muted}>{state.connected} relay connection{state.connected === 1 ? '' : 's'}{state.deadline ? ` · ${Math.max(0, Math.ceil((state.deadline - now) / 1000))}s remaining` : ''}</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <View style={styles.card}><Text style={styles.heading}>Phone identity</Text><Text selectable style={styles.mono}>{identity || 'Loading secure identity…'}</Text>
        <Text style={styles.muted}>Compare this key on the ESP32 when pairing. It is a Nostr transport identity, not a Bitcoin key.</Text>
      </View>
      {!busy && <View style={styles.card}><Text style={styles.heading}>{connection ? 'Device connection' : 'Pair your ESP32'}</Text>
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
        <Text style={styles.muted}>First receive address (index 0; not a fresh-address allocator)</Text><Text selectable style={styles.mono}>{receiveAddress(account)}</Text>
        <Button title="Share public account" secondary disabled={busy} onPress={() => void Share.share({ message: JSON.stringify({ descriptor: account.descriptor, xpub: account.xpub, fingerprint: account.fingerprint, path: account.path }, null, 2) }).catch(() => setError('Sharing failed'))} />
      </View>}
      {connection && <View style={styles.card}><Text style={styles.heading}>Sign a PSBT</Text><Text style={styles.text}>Prepare a Testnet4 payment in LNbits with full previous transactions, then import its unsigned PSBT here.</Text>
        <TextInput accessibilityLabel="Unsigned PSBT base64" editable={!busy} style={[styles.input, { minHeight: 100 }]} value={psbt} onChangeText={value => { setPsbt(value); setReview(null); setSigned(''); }} multiline autoCapitalize="none" autoCorrect={false} maxLength={43692} placeholder="Paste unsigned PSBT (base64)" placeholderTextColor="#839b90" />
        <Button title="Import PSBT file" secondary disabled={busy} onPress={() => void importFile()} />
        <Button title="Review transaction" disabled={busy || !account || !psbt} onPress={inspect} />
        {review && <><Text style={styles.heading}>{review.inputs} input(s) · Fee {review.fee} sats</Text>
          {review.outputs.map((output, i) => <View key={i} style={styles.output}><Text style={styles.text}>{output.change ? 'Verified own output' : 'Recipient'} · {output.sats} sats</Text><Text selectable style={styles.mono}>{output.address}</Text></View>)}
          <Text style={styles.text}>Wallet debit: {review.debit} sats</Text><Text style={styles.muted}>Final approval is on the ESP32, unless its configured policy allows automatic approval. This phone cannot change that policy.</Text>
          <Button title="Request signature from ESP32" disabled={busy} onPress={sign} />
        </>}
      </View>}
      {state.pinRequired && <View style={styles.card}><Text style={styles.heading}>Device wallet PIN required</Text><Text style={styles.text}>Sent only to the paired ESP32 inside the encrypted, request-bound Nostr message. Never enter your settings PIN here.</Text>
        <TextInput accessibilityLabel="Device wallet PIN" style={styles.input} secureTextEntry autoFocus keyboardType="number-pad" autoComplete="off" value={pin} onChangeText={setPin} maxLength={32} />
        <Button title="Unlock this signing request" onPress={() => void unlock()} disabled={!/^[0-9]{6,32}$/.test(pin)} />
      </View>}
      {busy && <Button title="Stop waiting / disconnect" secondary onPress={stop} />}
      {!!signed && <View style={styles.card}><Text style={styles.heading}>Signed PSBT verified</Text><Text style={styles.text}>The transaction is unchanged and every Bitcoin signature is valid. Return this PSBT to LNbits, review, and broadcast there explicitly.</Text>
        <Button title="Copy signed PSBT" onPress={() => void Clipboard.setStringAsync(signed).then(() => Alert.alert('Copied', 'Paste into LNbits to finalize and broadcast.')).catch(() => setError('Clipboard unavailable'))} />
        <Button title="Share signed PSBT file" secondary onPress={() => void shareSigned()} />
      </View>}
    </>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><ClientApp /></SafeAreaProvider>; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0c1614' }, content: { padding: 22, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  brand: { color: '#edf5ef', fontWeight: '800', letterSpacing: 2 }, network: { color: '#c5f5ab', fontSize: 11, letterSpacing: 1 },
  title: { color: '#edf5ef', fontSize: 32, fontWeight: '700' }, heading: { color: '#edf5ef', fontSize: 19, fontWeight: '600' },
  text: { color: '#d5e3d9', fontSize: 16, lineHeight: 24 }, muted: { color: '#abc1b2', fontSize: 13, lineHeight: 20 },
  mono: { color: '#d5e3d9', fontSize: 13, lineHeight: 21 }, card: { padding: 18, borderRadius: 16, backgroundColor: '#182920', gap: 14 },
  input: { color: '#fff', backgroundColor: '#0c1614', padding: 14, borderRadius: 8, fontSize: 15 },
  button: { padding: 16, minHeight: 52, backgroundColor: '#d5faab', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#304737' }, buttonText: { color: '#13220c', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  white: { color: '#edf5ef' }, dim: { opacity: 0.45 }, error: { color: '#ffb3a8', fontSize: 15, lineHeight: 23 },
  output: { borderTopWidth: 1, borderTopColor: '#405848', paddingTop: 12, gap: 8 },
});
