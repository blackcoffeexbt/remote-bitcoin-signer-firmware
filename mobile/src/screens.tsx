import { useState } from 'react';
import { Alert, Pressable, Share, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useClient } from './ClientProvider';
import { useWallet } from './WalletProvider';
import { BroadcastPanel } from './BroadcastPanel';
import { Button, colors, Empty, Field, Icon, Notice, Row, Screen, styles } from './ui';
import { approvalStatus, formatBtc, formatSats, shorten } from './presentation';
import { outpoint } from './wallet';
import type { HistoryEntry } from './wallet';

function PendingPayment() {
  const c = useClient();
  return c.review || c.signed || c.recovery === 'error' ? <View style={styles.card}><Row icon="send" title={c.signed ? 'Your latest payment' : c.recovery === 'error' ? 'Payment needs attention' : 'Payment in progress'} detail="Review payment details and status" onPress={() => router.push('/review')} /></View> : null;
}
function WalletAccess() {
  const c = useClient();
  return <Empty title={c.connection ? 'Open your wallet' : 'Welcome to your wallet'} description={c.connection ? 'Connect to your signing device to load your wallet.' : 'Add your signing device in Settings to get started.'}>
    {c.connection ? <Button title="Connect wallet" loading={c.busy} onPress={c.reconnect} disabled={c.chainBusy} /> : <Button title="Open Settings" onPress={() => router.push('/settings')} />}
    <Notice error={c.error} />
  </Empty>;
}
function ActivityRow({ tx, height }: { tx: HistoryEntry; height: number }) {
  const [expanded, setExpanded] = useState(false);
  return <View><Row icon="bitcoin" title={tx.height > 0 ? 'Confirmed transaction' : 'Pending transaction'} detail={shorten(tx.txid)} onPress={() => setExpanded(!expanded)} />
    {expanded && <View style={{ gap: 10, paddingBottom: 16 }}><Text selectable style={styles.mono}>{tx.txid}</Text><Text style={styles.muted}>{tx.height > 0 ? `${height - tx.height + 1} confirmations` : 'Waiting for confirmation'}</Text><Button title="Copy transaction ID" secondary icon="copy" onPress={() => void Clipboard.setStringAsync(tx.txid).catch(() => Alert.alert('Copy failed', 'Please try again.'))} /></View>}
  </View>;
}
export function HomeScreen() {
  const c = useClient(), w = useWallet();
  const total = w.snapshot?.coins.reduce((n, coin) => n + coin.value, 0n);
  return <Screen tab><View style={styles.between}><Text style={styles.title}>Wallet</Text><View style={styles.pill}><Text style={styles.network}>Testnet4</Text></View></View>
    {!c.account ? <WalletAccess /> : <>
      <View style={styles.balance}><View style={styles.iconCircle}><Icon name="bitcoin" color={colors.accent} /></View><Text style={styles.muted}>Total balance</Text><Text adjustsFontSizeToFit numberOfLines={1} style={styles.amount}>{total === undefined ? '—' : formatBtc(total)}</Text><Text style={styles.muted}>BTC{total === undefined ? '' : `  ·  ${formatSats(total)} sats`}</Text>
        <Text style={styles.muted}>{w.snapshot ? `Updated ${new Date(w.snapshot.syncedAt).toLocaleTimeString()}` : 'Refresh to see your balance'}</Text>
      </View>
      <View style={styles.actions}><View style={styles.flex}><Button title="Receive" icon="receive" secondary disabled={c.busy || c.chainBusy} onPress={() => router.push('/receive')} /></View><View style={styles.flex}><Button title="Send" icon="send" disabled={c.busy || c.chainBusy || !!c.signed} onPress={() => router.push('/send')} /></View></View>
      <PendingPayment />
      {!w.savedServer ? <View style={styles.card}><Row title="Connect a wallet server" detail="Add your server in Settings to see your balance." icon="settings" onPress={() => router.push('/server')} /></View> : <Button title={w.busy ? 'Updating wallet…' : 'Refresh balance'} secondary icon="refresh" disabled={w.lock} onPress={() => void w.sync()} />}
      <Notice error={w.error || c.error} />
      <View style={styles.between}><Text style={styles.heading}>Recent activity</Text><Pressable accessibilityRole="button" onPress={() => router.push('/activity')}><Text style={{ color: colors.accent }}>View all</Text></Pressable></View>
      {w.snapshot?.history.length ? <View style={styles.card}>{w.snapshot.history.slice(0, 3).map(tx => <ActivityRow key={tx.txid} tx={tx} height={w.snapshot!.height} />)}</View> : <Empty icon="activity" title="No activity yet" description={w.snapshot ? 'Your payments will appear here.' : 'Refresh your wallet to see recent payments.'} />}
    </>}
  </Screen>;
}
export function ActivityScreen() {
  const c = useClient(), w = useWallet(), [visible, setVisible] = useState(30);
  return <Screen tab title="Activity" subtitle="Your Bitcoin transactions"><PendingPayment />
    {!c.account ? <WalletAccess /> : <><Button title={w.busy ? 'Updating…' : 'Refresh activity'} secondary icon="refresh" disabled={w.lock || !w.savedServer} onPress={() => void w.sync()} /><Notice error={w.error} />
      {w.snapshot?.history.length ? <View style={styles.card}>{w.snapshot.history.slice(0, visible).map(tx => <ActivityRow key={tx.txid} tx={tx} height={w.snapshot!.height} />)}{w.snapshot.history.length > visible && <Button title="Show more" secondary onPress={() => setVisible(v => v + 30)} />}</View> : <Empty icon="activity" title="No transactions to show" description="Received and sent payments will appear here after your wallet updates." />}
    </>}
  </Screen>;
}
export function SettingsScreen() {
  const c = useClient(), w = useWallet();
  return <Screen tab title="Settings"><View style={styles.card}>
    <Row icon="device" title="Signing device" detail={c.connection ? 'Paired device' : 'Add a device'} onPress={() => router.push('/signer')} />
    <View style={styles.divider} /><Row icon="settings" title="Wallet server" detail={w.savedServer ? 'Custom Electrs server' : 'Not configured'} onPress={() => router.push('/server')} />
    <View style={styles.divider} /><Row icon="coins" title="Advanced tools" detail="Import transactions and view wallet details" onPress={() => router.push('/advanced')} />
  </View><View style={styles.card}><View style={styles.between}><Text style={styles.text}>Bitcoin network</Text><View style={styles.pill}><Text style={styles.network}>Testnet4</Text></View></View><Text style={styles.muted}>Use Testnet4 coins with this wallet.</Text></View></Screen>;
}
export function SignerScreen() {
  const c = useClient(), [adding, setAdding] = useState(false), lock = c.busy || c.chainBusy;
  return <Screen title="Signing device" subtitle="Your device approves each payment.">
    {c.connection && <View style={styles.card}><Row icon="device" title="Paired signing device" detail={shorten(c.connection.pubkey)} /><Button title="Connect device" secondary disabled={lock} loading={c.busy} onPress={c.reconnect} /><Button title="Pair another device" secondary disabled={lock} onPress={() => setAdding(!adding)} /></View>}
    {(!c.connection || adding) && <View style={styles.card}><Text style={styles.heading}>Pair your device</Text><Text style={styles.text}>On your signing device, open Settings → Pair a browser. Scan the code shown there.</Text>
      <Button title="Scan pairing code" icon="qr" disabled={lock || !c.ready} onPress={() => void c.scan()} />
      {c.scanning && <><CameraView style={{ height: 260, borderRadius: 16 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => c.acceptCode(data)} /><Button title="Close camera" secondary onPress={c.closeScanner} /></>}
      <Field label="Pairing code" editable={!lock} value={c.code} onChangeText={c.setCode} multiline autoCorrect={false} autoCapitalize="none" maxLength={2048} placeholder="Or paste a pairing code" />
      <Field label="Phone name" editable={!lock} value={c.label} onChangeText={c.setLabel} maxLength={40} placeholder="My phone" />
      <Button title="Pair device" disabled={lock || !c.ready || !c.code} onPress={c.pair} />
    </View>}
    {(c.code || c.busy || adding) && <View style={styles.card}><Text style={styles.heading}>Verify on your device</Text><Text style={styles.muted}>Check that this code matches the one on your signing device, then approve the connection.</Text><Text selectable style={styles.mono}>{c.identity}</Text></View>}
    {c.busy && <><Text style={styles.text}>Waiting for your device…</Text><Button title="Stop waiting" secondary onPress={c.stop} /></>}
    <Notice error={c.error} />
    {c.connection && <Button title="Remove device" secondary disabled={lock} onPress={c.forget} />}
  </Screen>;
}
export function ServerScreen() {
  const w = useWallet();
  return <Screen title="Wallet server" subtitle="Connect to your Testnet4 Electrs server."><Field label="Server address" editable={!w.lock && w.settingsReady} value={w.server} onChangeText={value => { w.setServer(value); w.invalidate(); }} autoCorrect={false} autoCapitalize="none" maxLength={240} placeholder="ssl://your-server:50002" />
    <Text style={styles.muted}>Use ssl://host:port for an encrypted connection, or tcp://host:port for a local server.</Text>
    {w.server.startsWith('tcp:') && <Text style={styles.muted}>This connection is not encrypted. Use it only on a trusted network.</Text>}
    <Button title="Save server" disabled={w.lock || !w.settingsReady || !w.server} onPress={() => void w.saveSettings().then(ok => { if (ok) Alert.alert('Saved', 'Your wallet server has been updated.'); })} />
    <Text style={styles.muted}>Your server can see your wallet activity. Choose one you trust.</Text><Notice error={w.error} />
  </Screen>;
}
function NeedBalance() { const w = useWallet(); return <Empty title="Update your wallet" description="Refresh your balance before receiving or sending.">{w.savedServer ? <Button title="Refresh balance" disabled={w.lock} onPress={() => void w.sync()} /> : <Button title="Set up wallet server" onPress={() => router.push('/server')} />}<Notice error={w.error} /></Empty>; }
export function ReceiveScreen() {
  const c = useClient(), w = useWallet();
  return <Screen title="Receive Bitcoin" subtitle="Only send Testnet4 coins to this address.">
    {!c.account ? <WalletAccess /> : !w.snapshot ? <NeedBalance /> : <>
      {w.receive ? <><View style={{ backgroundColor: '#fff', padding: 24, borderRadius: 24, alignItems: 'center', alignSelf: 'center' }}><QRCode value={w.receive} size={224} backgroundColor="#fff" color="#101216" /></View><View style={styles.card}><Text selectable style={[styles.mono, styles.center]}>{w.receive}</Text><Button title="Copy address" icon="copy" onPress={() => void Clipboard.setStringAsync(w.receive).then(() => Alert.alert('Copied', 'Address copied.')).catch(() => Alert.alert('Copy failed', 'Please try again.'))} /><Button title="Share address" secondary onPress={() => void Share.share({ message: w.receive }).catch(() => Alert.alert('Sharing failed', 'Please try again.'))} /></View></> : <Empty icon="receive" title="Your receiving address" description="Create an address and share it to receive Bitcoin." />}
      <Button title={w.receive ? 'Get a new address' : 'Create receive address'} secondary={!!w.receive} disabled={w.lock} onPress={() => void w.freshAddress()} /><Notice error={w.error} />
    </>}
  </Screen>;
}
export function SendScreen() {
  const c = useClient(), w = useWallet();
  return <Screen title="Send Bitcoin" subtitle="Choose who to pay and how much to send.">
    {!c.account ? <WalletAccess /> : c.signed ? <><PendingPayment /><Text style={styles.muted}>Finish reviewing your saved payment before starting another.</Text></> : !w.snapshot ? <NeedBalance /> : <>
      <Field label="Recipient address" value={w.destination} editable={!w.lock} onChangeText={v => { w.setDestination(v); w.invalidate(); }} autoCapitalize="none" autoCorrect={false} maxLength={100} placeholder="Paste a Bitcoin address" />
      <Field label="Amount (sats)" editable={!w.lock && !w.maximum} value={w.amount} onChangeText={v => { w.setAmount(v); w.invalidate(); }} keyboardType="number-pad" maxLength={16} placeholder={w.maximum ? 'Available balance minus fee' : '0'} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: w.maximum, disabled: w.lock }} disabled={w.lock} onPress={() => { w.setMaximum(!w.maximum); w.invalidate(); }} style={styles.between}><Text style={styles.text}>Send maximum</Text><Icon name={w.maximum ? 'check' : 'coins'} color={w.maximum ? colors.accent : colors.muted} /></Pressable>
      <View style={styles.card}><Row title="Network fee" detail={w.rate ? `${w.rate} sat/vB${w.plan ? ` · ${formatSats(w.plan.fee)} sats total` : ''}` : 'Choose a fee'} icon="activity" onPress={() => router.push('/fees')} disabled={w.lock} /><View style={styles.divider} /><Row title="Coin control" detail={w.manual ? `${w.selected.length} coins selected` : 'Automatic selection'} icon="coins" onPress={() => router.push('/coins')} disabled={w.lock} /></View>
      {w.plan && <View style={styles.card}><View style={styles.between}><Text style={styles.muted}>Amount</Text><Text style={styles.text}>{formatSats(w.plan.amount)} sats</Text></View><View style={styles.between}><Text style={styles.muted}>Network fee</Text><Text style={styles.text}>{formatSats(w.plan.fee)} sats</Text></View><View style={styles.divider} /><View style={styles.between}><Text style={styles.text}>Total</Text><Text style={styles.heading}>{formatSats(w.plan.amount + w.plan.fee)} sats</Text></View></View>}
      <Notice error={w.error || w.planError} /><Button title="Review payment" disabled={w.lock || !w.plan} onPress={() => void (async () => { if (await w.prepare()) router.push('/review'); })()} />
    </>}
  </Screen>;
}
export function FeesScreen() {
  const w = useWallet(), [custom, setCustom] = useState(!w.estimated && !!w.rate);
  return <Screen title="Network fee" subtitle="Higher fees may confirm sooner."><Button title={w.busy ? 'Getting estimates…' : 'Get fee estimates'} secondary icon="refresh" disabled={w.lock} onPress={w.updateFees} />
    {w.fees && <><View style={styles.card}>{([['Priority', '~30 minutes', 'halfHourFee'], ['Standard', '~1 hour', 'hourFee'], ['Economy', 'When the network is quieter', 'economyFee']] as const).map(([name, time, key]) => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ selected: w.estimated && w.feeTarget === key }} disabled={w.lock} onPress={() => { w.setRate(String(w.fees![key])); w.setFeeTarget(key); w.setEstimated(true); setCustom(false); w.invalidate(); }} style={styles.row}><View style={styles.flex}><Text style={styles.text}>{name}</Text><Text style={styles.muted}>{time}</Text></View><Text style={{ color: colors.accent }}>{w.fees![key]} sat/vB</Text>{w.estimated && w.feeTarget === key && <Icon name="check" color={colors.accent} size={18} />}</Pressable>)}</View><Text style={styles.muted}>Estimates from mempool.space · Updated {new Date(w.fees.fetchedAt).toLocaleTimeString()}. Confirmation times may vary.</Text></>}
    <Row title="Custom fee" detail="Set a rate in sat/vB" onPress={() => setCustom(!custom)} />
    {(custom || !w.fees) && <Field label="Fee rate (sat/vB)" value={w.rate} editable={!w.lock} onChangeText={v => { w.setRate(v); w.setEstimated(false); w.invalidate(); }} keyboardType="decimal-pad" maxLength={10} placeholder="e.g. 2" />}
    <Notice error={w.error} /><Button title="Done" disabled={w.lock || !w.rate} onPress={() => router.back()} />
  </Screen>;
}
export function CoinsScreen() {
  const w = useWallet(), [visible, setVisible] = useState(30);
  return <Screen title="Coin control" subtitle="Choose which coins to spend."><View style={styles.between}><Text style={styles.text}>Select coins manually</Text><Switch accessibilityLabel="Select coins manually" disabled={w.lock} value={w.manual} onValueChange={v => { w.setManual(v); w.setSelected([]); w.invalidate(); }} trackColor={{ true: colors.accent }} /></View>
    <Text style={styles.muted}>{w.manual ? 'Only the coins you select will be used.' : 'Your wallet will choose available coins for this payment.'}</Text>
    {w.manual && w.snapshot?.coins.slice(0, visible).map(coin => <View key={outpoint(coin)} style={styles.card}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: w.selected.includes(outpoint(coin)), disabled: w.lock || (coin.coinbase && coin.confirmations < 100) || (!w.unconfirmed && !coin.confirmations) }} disabled={w.lock || (coin.coinbase && coin.confirmations < 100) || (!w.unconfirmed && !coin.confirmations)} onPress={() => { w.setSelected(v => v.includes(outpoint(coin)) ? v.filter(k => k !== outpoint(coin)) : [...v, outpoint(coin)]); w.invalidate(); }} style={styles.between}><View style={styles.flex}><Text style={styles.heading}>{formatSats(coin.value)} sats</Text><Text style={styles.muted}>{coin.coinbase && coin.confirmations < 100 ? 'Not available yet' : coin.confirmations ? `${coin.confirmations} confirmations` : 'Unconfirmed'}</Text></View><Icon name={w.selected.includes(outpoint(coin)) ? 'check' : 'coins'} color={colors.accent} /></Pressable><Text selectable style={styles.mono}>{outpoint(coin)}</Text></View>)}
    {w.manual && w.snapshot && w.snapshot.coins.length > visible && <Button title="Show more coins" secondary onPress={() => setVisible(v => v + 30)} />}
    <View style={styles.between}><Text style={styles.text}>Allow unconfirmed coins</Text><Switch accessibilityLabel="Allow unconfirmed coins" disabled={w.lock} value={w.unconfirmed} onValueChange={v => { w.setUnconfirmed(v); w.setSelected([]); w.invalidate(); }} trackColor={{ true: colors.accent }} /></View><Text style={styles.muted}>Unconfirmed coins may become unavailable before your payment is sent.</Text><Button title="Done" disabled={w.lock} onPress={() => router.back()} />
  </Screen>;
}
export function ReviewScreen() {
  const c = useClient();
  return <Screen title={c.signed ? 'Payment details' : 'Review payment'} subtitle="Testnet4">
    {c.review ? <>
      <View style={styles.card}>{c.review.outputs.map((output, index) => <View key={index} style={index ? styles.output : { gap: 8 }}><View style={styles.between}><Text style={styles.muted}>{output.change ? 'Your wallet' : 'Recipient'}</Text><Text style={styles.heading}>{formatSats(output.sats)} sats</Text></View><Text selectable style={styles.mono}>{output.address}</Text></View>)}<View style={styles.divider} /><View style={styles.between}><Text style={styles.muted}>Network fee</Text><Text style={styles.text}>{formatSats(c.review.fee)} sats</Text></View><View style={styles.between}><Text style={styles.text}>Total leaving wallet</Text><Text style={styles.heading}>{formatSats(c.review.debit)} sats</Text></View></View>
      {c.busy && <View style={styles.card}><Text accessibilityLiveRegion="polite" style={styles.heading}>{approvalStatus(c.state.status, c.state.pinRequired)}</Text>{c.state.deadline > 0 && <Text style={styles.muted}>{Math.max(0, Math.ceil((c.state.deadline - c.now) / 1000))} seconds remaining</Text>}
        {c.state.pinRequired && <><Text style={styles.muted}>Enter your signing device’s wallet PIN.</Text><Field label="Device wallet PIN" secureTextEntry autoFocus keyboardType="number-pad" autoComplete="off" value={c.pin} onChangeText={c.setPin} maxLength={32} /><Button title="Continue" disabled={!/^[0-9]{6,32}$/.test(c.pin)} onPress={() => void c.unlock()} /></>}
        <Button title="Stop waiting" secondary onPress={() => Alert.alert('Stop waiting?', 'Your device may still finish this payment. Check it before trying again.', [{ text: 'Keep waiting', style: 'cancel' }, { text: 'Stop waiting', onPress: c.stop }])} />
      </View>}
      {!c.signed && !c.busy && <><Text style={styles.muted}>Your signing device will ask you to approve this payment. You’ll confirm sending it here afterwards.</Text><Button title="Approve with device" icon="device" disabled={c.chainBusy || c.recovery !== 'ready'} onPress={c.sign} /></>}
      {!!c.signed && c.account && !c.busy && <BroadcastPanel key={c.signed} account={c.account} original={c.psbt.trim()} signed={c.signed} disabled={c.chainBusy} onBusyChange={c.setChainBusy} />}
    </> : <Empty icon="send" title="No payment to review" description="Create a payment from the Send screen."><Button title="Create payment" onPress={() => router.replace('/send')} /></Empty>}
    <Notice error={c.error} />{(c.signed || c.recovery === 'error') && <Button title="Start a new payment" secondary disabled={c.busy || c.chainBusy} onPress={c.clearSaved} />}
  </Screen>;
}
export function AdvancedScreen() {
  const c = useClient(), [details, setDetails] = useState(false);
  return <Screen title="Advanced tools"><View style={styles.card}><Row title="Import transaction" detail="Open an unsigned PSBT" onPress={() => router.push('/import')} /><View style={styles.divider} /><Row title="Wallet details" detail="View your public wallet information" onPress={() => setDetails(!details)} /></View>
    {details && c.account && <View style={styles.card}><Text style={styles.label}>Fingerprint</Text><Text selectable style={styles.mono}>{c.account.fingerprint}</Text><Text style={styles.label}>Account path</Text><Text selectable style={styles.mono}>{c.account.path}</Text><Text style={styles.label}>Public key</Text><Text selectable style={styles.mono}>{c.account.xpub}</Text><Button title="Share public wallet" secondary onPress={() => void Share.share({ message: JSON.stringify({ descriptor: c.account!.descriptor, xpub: c.account!.xpub, fingerprint: c.account!.fingerprint, path: c.account!.path }, null, 2) }).catch(() => Alert.alert('Sharing failed', 'Please try again.'))} /></View>}
    {details && !c.account && <Text style={styles.muted}>Connect your signing device to view wallet details.</Text>}
    {!!c.signed && <View style={styles.card}><Text style={styles.heading}>Export signed transaction</Text><Button title="Copy signed PSBT" secondary onPress={() => void Clipboard.setStringAsync(c.signed).catch(() => Alert.alert('Copy failed', 'Please try again.'))} /><Button title="Share PSBT file" secondary onPress={() => void c.shareSigned()} /></View>}<Notice error={c.error} />
  </Screen>;
}
export function ImportScreen() {
  const c = useClient(), lock = c.busy || c.chainBusy || !!c.signed || c.recovery !== 'ready';
  return <Screen title="Import transaction" subtitle="Import an unsigned PSBT to approve with your device."><Field label="Unsigned PSBT" editable={!lock} value={c.psbt} onChangeText={v => { c.invalidate(); c.setPsbt(v); }} multiline autoCorrect={false} autoCapitalize="none" maxLength={43692} placeholder="Paste transaction" style={{ minHeight: 140 }} /><Button title="Choose file" secondary disabled={lock} onPress={() => void c.importFile()} /><Button title="Review transaction" disabled={lock || !c.psbt || !c.account} onPress={() => { if (c.inspect()) router.push('/review'); }} /><Notice error={c.error} /></Screen>;
}
