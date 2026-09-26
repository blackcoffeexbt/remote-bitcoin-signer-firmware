import { useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { demoTransaction as tx, DEMO_PEER, initialState, isActive, reducer } from './src/demo';
import type { Stage } from './src/demo';

const copy: Record<Stage, [string, string]> = {
  unpaired: ['Your phone. Your approval.', 'Explore the remote signer flow before connecting a real wallet.'],
  pairing: ['Pair a browser', 'Compare the full browser identity before allowing access to your public account.'],
  ready: ['Ready for a request', 'In the live MVP, LNbits will prepare the payment and send it over Nostr.'],
  pin: ['Waiting for wallet PIN', 'The existing protocol asks for the PIN in LNbits. This demo uses no PIN or wallet.'],
  review: ['Review the payment', 'Check each recipient, the change and the fee before approving.'],
  signing: ['Simulating the return', 'In the live flow, Bitcoin keys are cleared before the signed PSBT is sent.'],
  complete: ['Demo complete', 'Next: LNbits verifies the signed PSBT. Broadcasting is a separate action there. No signature was created or sent here.'],
  rejected: ['Request rejected', 'The demo request is closed. A new request needs a new review.'],
  expired: ['Request expired', 'Approval is no longer available. In the live flow, check the LNbits payment before retrying.'],
  locked: ['Signer locked', 'The active demo request was cancelled. Start a fresh request to continue.'],
};

function Button({ title, onPress, secondary = false }: {
  title: string; onPress: () => void; secondary?: boolean;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text>
  </Pressable>;
}

function Demo() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [now, setNow] = useState(Date.now());
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const requestCounter = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      dispatch({ type: 'tick', now: time });
    }, 500);
    const subscription = AppState.addEventListener('change', next => {
      setForeground(next === 'active');
      if (next !== 'active') dispatch({ type: 'lock' });
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => {
    if (state.stage !== 'signing' || !state.requestId) return;
    const id = state.requestId;
    const timer = setTimeout(() => dispatch({ type: 'finish', id, now: Date.now() }), 900);
    return () => clearTimeout(timer);
  }, [state.stage, state.requestId]);

  const act = (type: 'unlock' | 'approve' | 'reject') => {
    if (foreground && state.requestId) dispatch({ type, id: state.requestId, now: Date.now() });
  };
  const start = () => {
    // Deterministic demo ID; live protocol MUST replace this with 16 CSPRNG bytes.
    requestCounter.current += 1;
    dispatch({ type: 'request', id: requestCounter.current.toString(16).padStart(32, '0'), now: Date.now() });
  };
  const [title, description] = copy[state.stage];
  const active = isActive(state);

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.brand}>REMOTE / SIGNER</Text>
        <Text style={styles.network}>TESTNET4</Text>
      </View>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>INTERACTIVE DEMO · PHASE 0</Text>
        <Text style={styles.muted}>No wallet keys, relay connection or real signing.</Text>
      </View>
      {!foreground ? <Text style={styles.title}>Signer locked</Text> : <>
        <Text style={styles.eyebrow}>{state.paired ? 'DEMO BROWSER PAIRED' : 'GET STARTED'}</Text>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.description}>{description}</Text>
        {active && <Text style={styles.timer}>
          {Math.max(0, Math.ceil((state.deadline - now) / 1000))} seconds remaining
        </Text>}

        {state.stage === 'pairing' && <View style={styles.card}>
          <Text style={styles.cardTitle}>{tx.client}</Text>
          <Text style={styles.muted}>Fixture Nostr public key · not a real identity</Text>
          <Text selectable style={styles.mono}>{DEMO_PEER}</Text>
          <Button title="Approve demo pairing" onPress={() => dispatch({ type: 'confirmPair', now: Date.now() })} />
          <Button title="Cancel pairing" secondary onPress={() => dispatch({ type: 'cancelPair' })} />
        </View>}

        {state.stage === 'pin' && <View style={styles.card}>
          <Text style={styles.cardTitle}>Request from {tx.client}</Text>
          <Text style={styles.muted}>Simulate an authenticated, request-bound unlock from LNbits and successful transaction validation.</Text>
          <Button title="Simulate PIN unlock" onPress={() => act('unlock')} />
          <Button title="Reject request" secondary onPress={() => act('reject')} />
        </View>}

        {state.stage === 'review' && <View style={styles.card}>
          <Text style={styles.eyebrow}>RECIPIENT · FIXTURE ADDRESS</Text>
          <Text style={styles.amount}>{tx.amount.toLocaleString()} <Text style={styles.unit}>sats</Text></Text>
          <Text selectable style={styles.mono}>{tx.recipient}</Text>
          <View style={styles.divider} />
          <Text style={styles.cardTitle}>Change · {tx.changeAmount.toLocaleString()} sats</Text>
          <Text selectable style={styles.mono}>{tx.change}</Text>
          <Text style={styles.muted}>Addresses are intentionally invalid demo placeholders.</Text>
          <View style={styles.divider} />
          <Text style={styles.row}>Input total: {tx.inputAmount.toLocaleString()} sats</Text>
          <Text style={styles.row}>Network fee: {tx.fee.toLocaleString()} sats</Text>
          <Text style={styles.row}>Wallet debit: {(tx.amount + tx.fee).toLocaleString()} sats</Text>
          <Text style={styles.muted}>Manual approval · {tx.client}</Text>
          <Button title="Approve demo payment" onPress={() => act('approve')} />
          <Button title="Reject request" secondary onPress={() => act('reject')} />
        </View>}

        {!active && <Button title={state.paired ? 'Start demo payment' : 'Try demo pairing'}
          onPress={state.paired ? start : () => dispatch({ type: 'pair', now: Date.now() })} />}
        {active && <Button title="Lock and cancel" secondary onPress={() => dispatch({ type: 'lock' })} />}
        {state.paired && !active && <Button title="Forget demo browser" secondary onPress={() => dispatch({ type: 'revoke' })} />}
        <View style={styles.footer}>
          <Text style={styles.cardTitle}>First live milestone</Text>
          <Text style={styles.muted}>Restore a disposable Testnet4 wallet → pair LNbits → review and sign → broadcast in LNbits.</Text>
          <Text style={styles.footnote}>Keep the app open during review. Leaving the app cancels the demo request.</Text>
        </View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><Demo /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0C1614' },
  content: { padding: 24, gap: 18, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingVertical: 10 },
  brand: { color: '#EDF5EF', fontWeight: '800', letterSpacing: 2, fontSize: 13 },
  network: { color: '#BFF2A7', fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  banner: { padding: 16, borderRadius: 12, backgroundColor: '#24342C', gap: 6 },
  bannerTitle: { color: '#CFF5A8', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  eyebrow: { color: '#A6BCAD', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginTop: 10 },
  title: { color: '#F0F5EF', fontSize: 36, lineHeight: 42, fontWeight: '700' },
  description: { color: '#B9C8BD', fontSize: 17, lineHeight: 26 },
  timer: { color: '#E9D49C', fontVariant: ['tabular-nums'], fontSize: 14 },
  card: { padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#3A4B40', backgroundColor: '#14231C', gap: 16 },
  cardTitle: { color: '#EDF5EF', fontSize: 16, fontWeight: '600' },
  muted: { color: '#B6C9BC', fontSize: 14, lineHeight: 22 },
  mono: { color: '#E0EBE3', fontFamily: 'monospace', fontSize: 14, lineHeight: 23 },
  amount: { color: '#D5FAAB', fontSize: 38, fontWeight: '700' },
  unit: { fontSize: 18, fontWeight: '400' },
  divider: { height: 1, backgroundColor: '#3A4B40' },
  row: { color: '#EDF5EF', fontSize: 16 },
  button: { minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: '#D5FAAB', borderRadius: 14, padding: 16 },
  secondary: { backgroundColor: '#25382B' },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#14230D', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondaryText: { color: '#E7EEE8' },
  footer: { marginTop: 12, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#3A4B40', gap: 10 },
  footnote: { color: '#B1BEB5', fontSize: 12, lineHeight: 19 },
});
