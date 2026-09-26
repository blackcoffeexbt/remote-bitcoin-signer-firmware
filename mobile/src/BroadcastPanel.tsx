import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { PublicAccount } from './protocol';
import { ElectrumClient } from './electrum';
import { dialElectrum } from './electrum-native';
import { broadcastPayment, checkPsbtUnspent, finalizePayment, transactionKnown } from './wallet';
import { loadServer, loadPayment, savePayment } from './wallet-storage';
import type { SavedPayment } from './wallet-storage';
import { Button, styles } from './ui';

export function BroadcastPanel({ account, original, signed, disabled, onBusyChange }: { account: PublicAccount; original: string; signed: string; disabled: boolean; onBusyChange(value: boolean): void }) {
  const final = useMemo(() => finalizePayment(original, signed, account), [original, signed, account]);
  const [status, setStatus] = useState('Not broadcast by this app.'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false), working = useRef(false), alive = useRef(true), rpc = useRef<ElectrumClient | null>(null);
  useEffect(() => {
    alive.current = true;
    void loadPayment(account).then(p => {
      if (!alive.current || p?.signed !== signed) return;
      if (p.state === 'submitted') { setSubmitted(true); setStatus('Previously accepted by the server. Check status for current visibility; acceptance is not confirmation.'); }
      if (p.state === 'unknown') setStatus('Previous broadcast may have succeeded. Check this transaction before retrying the same bytes.');
    }).catch(() => { if (alive.current) setError('Could not read the recovery record. Broadcast will require a successful save.'); });
    return () => { alive.current = false; rpc.current?.close(); if (working.current) onBusyChange(false); };
    // A new signed transaction mounts a new panel keyed by its signed PSBT.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (broadcast: boolean) => {
    if (!alive.current || working.current || disabled) return;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const server = await loadServer(); if (!alive.current) return;
      if (!server) throw new Error('Set your Electrs server address in app settings first');
      const c = new ElectrumClient(); rpc.current = c; await c.connect(server, dialElectrum);
      const known = await transactionKnown(c, final.txid);
      if (!alive.current) return;
      const record: SavedPayment = { original, signed, createdAt: Date.now(), state: known ? 'submitted' : 'ready' };
      if (known) {
        await savePayment(account, record);
        if (alive.current) { setSubmitted(true); setStatus('Transaction is visible on the server. Sync wallet history for confirmations.'); }
        return;
      }
      if (!broadcast) { setSubmitted(false); setStatus('Server does not currently know this transaction. This does not prove it was never broadcast.'); return; }
      await checkPsbtUnspent(c, original, account);
      if (!alive.current) return;
      // Record uncertainty before sending. A timeout/restart never authorizes a new payment.
      await savePayment(account, { ...record, state: 'unknown' });
      if (!alive.current) return;
      await broadcastPayment(c, original, signed, account);
      await savePayment(account, { ...record, state: 'submitted' });
      if (alive.current) { setSubmitted(true); setStatus('Broadcast accepted. Confirmation is pending; sync wallet history to track it.'); }
    } catch (e) { if (alive.current) { setError((e as Error).message); if (broadcast) setStatus('Broadcast not confirmed by this app. Check the transaction ID before retrying; any retry sends the same transaction.'); } }
    finally { rpc.current?.close(); rpc.current = null; working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  };
  const confirm = () => Alert.alert('Broadcast Testnet4 transaction?', `Fee: ${final.fee} sats (${final.feeRate.toFixed(3)} sat/vB).\nWallet debit: ${final.review.debit} sats.\n\n${final.review.outputs.map(o => `${o.change ? 'Own output' : 'Recipient'}: ${o.sats} sats\n${o.address}`).join('\n\n')}\n\nThis sends the signed transaction to your Electrs server.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Broadcast', onPress: () => void run(true) },
  ]);
  return <View style={styles.card}><Text style={styles.heading}>Ready to broadcast</Text>
    <Text selectable style={styles.mono}>{final.txid}</Text><Text style={styles.text}>Final fee {final.fee} sats · {final.vsize} vB · {final.feeRate.toFixed(3)} sat/vB</Text>
    <Text accessibilityLiveRegion="polite" style={styles.text}>{status}</Text>
    <Button title="Check transaction status" secondary disabled={disabled || busy} onPress={() => void run(false)} />
    <Button title="Broadcast transaction" disabled={disabled || busy || submitted} onPress={confirm} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}
