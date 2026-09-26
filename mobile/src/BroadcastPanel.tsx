import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Text, View } from 'react-native';
import type { PublicAccount } from './protocol';
import { ElectrumClient } from './electrum';
import { dialElectrum } from './electrum-native';
import { broadcastPayment, checkPsbtUnspent, finalizePayment, transactionKnown } from './wallet';
import { loadServer, loadPayment, savePayment } from './wallet-storage';
import type { SavedPayment } from './wallet-storage';
import { Button, Notice, Row, styles } from './ui';

export function BroadcastPanel({ account, original, signed, disabled, onBusyChange }: { account: PublicAccount; original: string; signed: string; disabled: boolean; onBusyChange(value: boolean): void }) {
  const final = useMemo(() => finalizePayment(original, signed, account), [original, signed, account]);
  const [status, setStatus] = useState('Approved by your device. Ready to send.'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false), working = useRef(false), alive = useRef(true), rpc = useRef<ElectrumClient | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const lifecycleGeneration = generation;
    alive.current = true;
    void loadPayment(account).then(p => {
      if (!alive.current || p?.signed !== signed) return;
      if (p.state === 'submitted') { setSubmitted(true); setStatus('Payment sent. Check its status for an update.'); }
      if (p.state === 'unknown') setStatus('Your payment may already have been sent. Check its status before trying again.');
    }).catch(() => { if (alive.current) setError('Could not read your saved payment. Please check your phone storage.'); });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { alive.current = false; lifecycleGeneration.current++; rpc.current?.close(); rpc.current = null; working.current = false; setBusy(false); onBusyChange(false); }
      else alive.current = true;
    });
    return () => { alive.current = false; lifecycleGeneration.current++; rpc.current?.close(); subscription.remove(); if (working.current) onBusyChange(false); };
    // A new signed transaction mounts a new panel keyed by its signed PSBT.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (broadcast: boolean) => {
    if (!alive.current || working.current || disabled) return;
    const version = ++generation.current;
    const active = () => alive.current && version === generation.current;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const server = await loadServer(); if (!active()) return;
      if (!server) throw new Error('Set your Electrs server address in app settings first');
      const c = new ElectrumClient(); rpc.current = c; await c.connect(server, dialElectrum);
      const known = await transactionKnown(c, final.txid);
      if (!active()) return;
      const record: SavedPayment = { original, signed, createdAt: Date.now(), state: known ? 'submitted' : 'ready' };
      if (known) {
        await savePayment(account, record);
        if (active()) { setSubmitted(true); setStatus('Payment sent. Refresh Activity to see confirmations.'); }
        return;
      }
      if (!broadcast) { setSubmitted(false); setStatus('This payment is not visible yet. Wait and check again before trying to send it.'); return; }
      await checkPsbtUnspent(c, original, account);
      if (!active()) return;
      // Record uncertainty before sending. A timeout/restart never authorizes a new payment.
      await savePayment(account, { ...record, state: 'unknown' });
      if (!active()) return;
      await broadcastPayment(c, original, signed, account);
      await savePayment(account, { ...record, state: 'submitted' });
      if (active()) { setSubmitted(true); setStatus('Payment sent. Waiting for confirmation.'); }
    } catch (e) { if (active()) { setError((e as Error).message); if (broadcast) setStatus('We couldn’t confirm whether your payment was sent. Check its status before trying again.'); } }
    finally { if (active()) { rpc.current?.close(); rpc.current = null; working.current = false; setBusy(false); onBusyChange(false); } }
  };
  const confirm = () => Alert.alert('Send this payment?', `Fee: ${final.fee} sats (${final.feeRate.toFixed(3)} sat/vB).\nTotal leaving wallet: ${final.review.debit} sats.\n\n${final.review.outputs.map(o => `${o.change ? 'Your wallet' : 'Recipient'}: ${o.sats} sats\n${o.address}`).join('\n\n')}\n\nThis sends your payment to the Testnet4 network.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Send payment', onPress: () => void run(true) },
  ]);
  return <View style={styles.card}><Text style={styles.heading}>{submitted ? 'Payment sent' : 'Ready to send'}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{status}</Text>
    <Button title="Check payment status" secondary disabled={disabled || busy} onPress={() => void run(false)} />
    {!submitted && <Button title="Send payment" disabled={disabled || busy} onPress={confirm} />}
    <Row title="Network fee" detail={`${final.fee} sats · ${final.feeRate.toFixed(3)} sat/vB`} />
    <Text style={styles.label}>Transaction ID</Text><Text selectable style={styles.mono}>{final.txid}</Text>
    <Notice error={error} />
  </View>;
}
