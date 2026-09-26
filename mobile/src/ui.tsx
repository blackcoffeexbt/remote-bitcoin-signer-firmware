import { Pressable, Text, StyleSheet } from 'react-native';

export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed) && styles.dim]}>
    <Text style={[styles.buttonText, secondary && styles.white]}>{title}</Text>
  </Pressable>;
}
export const styles = StyleSheet.create({
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
