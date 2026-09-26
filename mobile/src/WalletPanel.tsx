import { useEffect, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { PublicAccount } from './protocol';
import { ElectrumClient, parseEndpoint } from './electrum';
import { dialElectrum } from './electrum-native';
import { fetchFees } from './fees';
import type { Fees } from './fees';
import { buildPsbt, checkUnspent, deriveAddress, GAP, outpoint, planPayment, syncWallet } from './wallet';
import type { Plan, Snapshot } from './wallet';
import { loadCursor, loadServer, saveCursor, saveServer } from './wallet-storage';
import { Button, styles } from './ui';

type Props = { account: PublicAccount | null; disabled: boolean; paymentPending: boolean; onBusyChange(busy: boolean): void; onPrepared(psbt: string): void; onInvalidate(): void };
export function WalletPanel({ account, disabled, paymentPending, onBusyChange, onPrepared, onInvalidate }: Props) {
  const [server, setServer] = useState(''), [savedServer, setSavedServer] = useState('');
  const [settingsReady, setSettingsReady] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [receive, setReceive] = useState('');
  const [destination, setDestination] = useState(''), [amount, setAmount] = useState(''), [maximum, setMaximum] = useState(false);
  const [rate, setRate] = useState(''), [fees, setFees] = useState<Fees | null>(null), [estimated, setEstimated] = useState(false);
  const [manual, setManual] = useState(false), [selected, setSelected] = useState<string[]>([]), [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false), working = useRef(false), alive = useRef(true), rpc = useRef<ElectrumClient | null>(null);
  const lock = disabled || busy;
  useEffect(() => {
    alive.current = true;
    void loadServer().then(value => { if (alive.current) { setServer(value); setSavedServer(value); setSettingsReady(true); } }).catch(() => { if (alive.current) setError('Could not load server preference'); });
    return () => { alive.current = false; rpc.current?.close(); if (working.current) onBusyChange(false); };
    // Parent callbacks are stable for the lifetime of this keyed account panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (!alive.current || working.current || disabled) return;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try { await work(); } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { rpc.current?.close(); rpc.current = null; working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  };
  const connect = async () => {
    if (!savedServer || server.trim() !== savedServer) throw new Error('Save your Electrs server address first');
    const client = new ElectrumClient(); rpc.current = client;
    await client.connect(savedServer, dialElectrum);
    if (!alive.current) { client.close(); throw new Error('Wallet interrupted'); }
    return client;
  };
  const invalidate = () => { onInvalidate(); setError(''); };
  const updateFees = () => void run(async () => {
    const result = await fetchFees();
    if (!alive.current) return;
    setFees(result); setStatus('Fee estimates refreshed from mempool.space Testnet4.');
    if (!rate || estimated) { setRate(String(result.hourFee)); setEstimated(true); invalidate(); }
  });
  const sync = () => account && void run(async () => {
    invalidate(); setSnapshot(null); setSelected([]);
    const c = await connect(), cursor = await loadCursor(account);
    const wallet = await syncWallet(c, account, cursor, text => { if (alive.current) setStatus(text); });
    if (!alive.current) return;
    await saveCursor(account, wallet.next);
    if (alive.current) { setSnapshot(wallet); setStatus(`Synced at block ${wallet.height} · ${new Date(wallet.syncedAt).toLocaleTimeString()}`); }
  });
  const freshAddress = () => account && snapshot && void run(async () => {
    const cursor = await loadCursor(account), index = cursor.receive;
    if (index - snapshot.lastUsed.receive > GAP) throw new Error('20 unused receive addresses have been issued. Use one and sync before requesting more.');
    const a = deriveAddress(account, 0, index);
    await saveCursor(account, { ...cursor, receive: index + 1 });
    if (alive.current) setReceive(a.address);
  });
  let plan: Plan | null = null, planError = '';
  if (snapshot && destination && (amount || maximum) && rate) {
    try { plan = planPayment(snapshot.coins, manual ? selected : null, destination, maximum ? 'max' : amount, rate, unconfirmed); }
    catch (e) { planError = (e as Error).message; }
  }
  const prepare = () => account && snapshot && plan && void run(async () => {
    if (Date.now() - snapshot.syncedAt > 300000) throw new Error('Wallet snapshot is over five minutes old. Sync again before preparing a payment.');
    if (estimated && (!fees || Date.now() - fees.fetchedAt > 300000)) throw new Error('Fee estimates are over five minutes old. Refresh or enter a manual rate.');
    const c = await connect(); await checkUnspent(c, plan.coins);
    const cursor = await loadCursor(account), change = deriveAddress(account, 1, cursor.change);
    const original = buildPsbt(account, plan, change, snapshot.addresses);
    if (!alive.current) return;
    if (plan.change) {
      if (cursor.change - snapshot.lastUsed.change > GAP) throw new Error('20 unused change addresses are reserved. Complete an existing payment and sync before creating more.');
      await saveCursor(account, { ...cursor, change: cursor.change + 1 });
    }
    if (alive.current) { onPrepared(original); setStatus('Payment prepared. Review below, then request the ESP32 signature.'); }
  });
  return <>
    <View style={styles.card}><Text style={styles.heading}>App settings · Electrs server</Text>
      <Text style={styles.text}>Connect to your Testnet4 Electrs server using its Electrum address.</Text>
      <TextInput accessibilityLabel="Electrs server address" editable={!lock && settingsReady} style={styles.input} autoCorrect={false} autoCapitalize="none" value={server} onChangeText={value => { setServer(value); setSnapshot(null); setReceive(''); invalidate(); }} maxLength={240} placeholder="ssl://electrs.example.com:50002" placeholderTextColor="#839b90" />
      <Text style={styles.muted}>TLS: ssl://host:port with a trusted certificate. Local TCP: tcp://192.168.1.10:50001. Plain TCP exposes wallet queries to the network. This is not an Esplora HTTP URL.</Text>
      <Button title="Save server preference" disabled={lock || !settingsReady || !server} secondary onPress={() => void run(async () => {
        const parsed = parseEndpoint(server.trim()); await saveServer(parsed.url);
        if (alive.current) { setServer(parsed.url); setSavedServer(parsed.url); setSnapshot(null); setReceive(''); invalidate(); setStatus('Server saved. Sync to check the Testnet4 network.'); }
      })} />
      <Text style={styles.muted}>The server sees wallet script hashes and broadcasts. Its balance, history and confirmation reports are trusted; this app is not a full node.</Text>
    </View>
    <View style={styles.card}><Text style={styles.heading}>Fee estimates</Text>
      <Text style={styles.muted}>mempool.space · Testnet4 · sat/vB. Confirmation times are estimates.</Text>
      <Button title="Refresh fee estimates" secondary disabled={lock} onPress={updateFees} />
      {fees && <><Text style={styles.muted}>Fetched {new Date(fees.fetchedAt).toLocaleTimeString()} · minimum {fees.minimumFee} sat/vB</Text>
        {([['Fastest', 'fastestFee'], ['~30 minutes', 'halfHourFee'], ['~1 hour', 'hourFee'], ['Economy', 'economyFee']] as const).map(([label, key]) => <Button key={key} title={`${label} · ${fees[key]} sat/vB`} secondary disabled={lock} onPress={() => { setRate(String(fees[key])); setEstimated(true); invalidate(); }} />)}
      </>}
      <TextInput accessibilityLabel="Fee rate in satoshis per virtual byte" editable={!lock} style={styles.input} value={rate} onChangeText={v => { setRate(v); setEstimated(false); invalidate(); }} keyboardType="decimal-pad" placeholder="Manual fee rate (sat/vB)" placeholderTextColor="#839b90" maxLength={10} />
      <Text style={styles.muted}>{estimated ? 'Using a mempool.space estimate; refresh after five minutes.' : 'Manual rate. No mainnet fee fallback is used.'}</Text>
    </View>
    {account && <View style={styles.card}><Text style={styles.heading}>Wallet · receive and send</Text>
      <Button title="Sync wallet" disabled={lock || !savedServer} onPress={sync} />
      {snapshot && <>
        <Text style={styles.heading}>{snapshot.coins.reduce((n, c) => n + c.value, 0n).toString()} sats</Text>
        <Text style={styles.muted}>Confirmed: {snapshot.coins.filter(c => c.confirmations > 0).reduce((n, c) => n + c.value, 0n).toString()} sats · Unconfirmed: {snapshot.coins.filter(c => !c.confirmations).reduce((n, c) => n + c.value, 0n).toString()} sats. Immature coinbase outputs cannot be spent.</Text>
        <Button title="New receive address" secondary disabled={lock} onPress={freshAddress} />
        {!!receive && <><Text selectable style={styles.mono}>{receive}</Text><Button title="Copy receive address" secondary disabled={lock} onPress={() => void Clipboard.setStringAsync(receive).then(() => Alert.alert('Copied', 'Testnet4 receive address copied.')).catch(() => setError('Clipboard unavailable'))} /></>}
        <TextInput accessibilityLabel="Recipient address" editable={!lock} style={styles.input} value={destination} onChangeText={v => { setDestination(v); invalidate(); }} autoCapitalize="none" autoCorrect={false} placeholder="Testnet4 recipient address" placeholderTextColor="#839b90" maxLength={100} />
        <TextInput accessibilityLabel="Amount in satoshis" editable={!lock && !maximum} style={styles.input} value={amount} onChangeText={v => { setAmount(v); invalidate(); }} keyboardType="number-pad" placeholder={maximum ? 'Maximum minus fee' : 'Amount (sats)'} placeholderTextColor="#839b90" maxLength={16} />
        <Button title={maximum ? '✓ Send maximum selected funds' : 'Send maximum selected funds'} secondary disabled={lock} onPress={() => { setMaximum(!maximum); invalidate(); }} />
        <Text style={styles.heading}>Coin control</Text>
        <Button title={manual ? 'Manual selection · switch to automatic' : 'Automatic selection · choose coins myself'} secondary disabled={lock} onPress={() => { setManual(!manual); setSelected([]); invalidate(); }} />
        <Button title={unconfirmed ? '✓ Allow unconfirmed coins' : 'Confirmed coins only · allow unconfirmed'} secondary disabled={lock} onPress={() => { setUnconfirmed(!unconfirmed); setSelected([]); invalidate(); }} />
        <Text style={styles.muted}>Automatic selection uses the largest eligible coins first. Manual selection spends exactly the checked coins. Unconfirmed inputs may disappear or conflict.</Text>
        {manual && snapshot.coins.map(c => <View key={outpoint(c)} style={styles.output}>
          <Text selectable style={styles.mono}>{outpoint(c)}</Text><Text selectable style={styles.muted}>{c.address}</Text>
          <Button title={`${selected.includes(outpoint(c)) ? '✓ ' : ''}${c.value} sats · ${c.confirmations} confirmations${c.coinbase && c.confirmations < 100 ? ' · immature' : ''}`} secondary disabled={lock || (c.coinbase && c.confirmations < 100) || (!unconfirmed && !c.confirmations)} onPress={() => { setSelected(v => v.includes(outpoint(c)) ? v.filter(k => k !== outpoint(c)) : [...v, outpoint(c)]); invalidate(); }} />
        </View>)}
        {!!planError && <Text style={styles.error}>{planError}</Text>}
        {plan && <><Text style={styles.text}>{plan.coins.length} inputs · send {plan.amount.toString()} sats{plan.change ? ` · change ${plan.change} sats` : ''}</Text><Text style={styles.text}>Fee: {plan.fee.toString()} sats · up to {plan.vsize} vB · effective estimate {(Number(plan.fee) / plan.vsize).toFixed(3)} sat/vB</Text><Text style={styles.muted}>Any remainder below the change dust limit is included in this displayed fee.</Text></>}
        <Button title="Prepare and review payment" disabled={lock || !plan || paymentPending} onPress={prepare} />
        <Text style={styles.heading}>Transaction history</Text>
        {!snapshot.history.length && <Text style={styles.muted}>No transactions found.</Text>}
        {snapshot.history.slice(0, 50).map(tx => <View key={tx.txid} style={styles.output}><Text selectable style={styles.mono}>{tx.txid}</Text><Text style={styles.muted}>{tx.height > 0 ? `${snapshot.height - tx.height + 1} confirmations` : 'Unconfirmed'}</Text></View>)}
        {snapshot.history.length > 50 && <Text style={styles.muted}>Showing the latest 50 of {snapshot.history.length} transactions.</Text>}
      </>}
    </View>}
    {!!status && <Text accessibilityLiveRegion="polite" style={styles.text}>{status}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </>;
}
