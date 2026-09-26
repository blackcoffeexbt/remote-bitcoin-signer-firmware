import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ColorValue, TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { walletError } from './presentation';
export const colors = { bg: '#101216', card: '#1b1e24', raised: '#242830', line: '#30353e', text: '#f7f7f8', muted: '#a1a8b3', accent: '#f6a84a', good: '#94d6b1' };
export function Icon({ name, color = colors.text, size = 24 }: { name: string; color?: ColorValue; size?: number }) {
  const paths: Record<string, string> = {
    wallet: 'M4 6h15v4M4 6v14h17V10H7a3 3 0 0 1 0-6h12v2M16 15h5',
    activity: 'M4 12h3l3-7 4 14 3-7h3', send: 'M6 18 18 6M6 6h12v12', receive: 'M18 6 6 18M6 6v12h12',
    settings: 'M4 7h16M4 17h16M9 4v6M15 14v6', chevron: 'm9 5 7 7-7 7', refresh: 'M20 10a8 8 0 1 0-1 7M20 4v6h-6',
    check: 'm5 12 4 4L19 6', device: 'M7 3h10v18H7zM10 17h4', copy: 'M9 8h11v13H9zM15 8V3H4v13h5',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z', coins: 'M4 8c0-5 16-5 16 0s-16 5-16 0M4 8v8c0 5 16 5 16 0V8M4 12c0 5 16 5 16 0',
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {name === 'qr' ? <><Rect x="3" y="3" width="7" height="7" /><Rect x="14" y="3" width="7" height="7" /><Rect x="3" y="14" width="7" height="7" /><Path d="M14 14h3v3h4v4h-7z" /></> : name === 'bitcoin' ? <><Circle cx="12" cy="12" r="10" /><Path d="M9 6v12M12 6v12M7 8h7c4 0 4 4 0 4H9m5 0c4 0 4 4 0 4H7" /></> : <Path d={paths[name] ?? paths.wallet} />}
  </Svg>;
}
export function Button({ title, onPress, disabled = false, secondary = false, icon, loading = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: string; loading?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || pressed || loading) && styles.dim]}>
    {loading ? <ActivityIndicator color={secondary ? colors.text : colors.bg} /> : icon ? <Icon name={icon} color={secondary ? colors.text : colors.bg} size={20} /> : null}
    <Text style={[styles.buttonText, secondary && styles.white]}>{title}</Text>
  </Pressable>;
}
export function Screen({ children, title, subtitle, tab = false }: { children: ReactNode; title?: string; subtitle?: string; tab?: boolean }) {
  return <SafeAreaView style={styles.safe} edges={tab ? ['top', 'left', 'right'] : ['left', 'right', 'bottom']}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    {title && <View style={styles.pageHeading}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{subtitle && <Text style={styles.muted}>{subtitle}</Text>}</View>}{children}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) { return <View style={{ gap: 8 }}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#747e8b" {...props} style={[styles.input, props.style]} /></View>; }
export function Row({ title, detail, icon, onPress, disabled }: { title: string; detail?: string; icon?: string; onPress?: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={disabled || !onPress} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.dim, disabled && styles.dim]}>
    {icon && <View style={styles.iconCircle}><Icon name={icon} color={colors.accent} size={21} /></View>}
    <View style={styles.flex}><Text style={styles.text}>{title}</Text>{detail && <Text style={styles.muted}>{detail}</Text>}</View>{onPress && <Icon name="chevron" size={18} color={colors.muted} />}
  </Pressable>;
}
export function Notice({ error }: { error: unknown }) { return error ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{walletError(error)}</Text></View> : null; }
export function Empty({ icon = 'wallet', title, description, children }: { icon?: string; title: string; description: string; children?: ReactNode }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Icon name={icon} color={colors.accent} size={30} /></View><Text style={[styles.heading, styles.center]}>{title}</Text><Text style={[styles.muted, styles.center]}>{description}</Text>{children}</View>;
}
export const styles = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: colors.bg }, content: { padding: 22, paddingBottom: 32, gap: 22, maxWidth: 620, width: '100%', alignSelf: 'center' },
  pageHeading: { gap: 8, paddingVertical: 8 }, title: { color: colors.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.8 }, heading: { color: colors.text, fontSize: 19, fontWeight: '600' },
  text: { color: colors.text, fontSize: 16, lineHeight: 24 }, muted: { color: colors.muted, fontSize: 13, lineHeight: 20 }, label: { color: '#c5cbd4', fontSize: 13, fontWeight: '600' },
  mono: { color: '#dce1e8', fontSize: 13, lineHeight: 22, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }, card: { padding: 20, borderRadius: 20, backgroundColor: colors.card, gap: 16 },
  input: { color: colors.text, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, padding: 16, borderRadius: 12, fontSize: 16, minHeight: 56 },
  button: { padding: 16, minHeight: 54, backgroundColor: colors.accent, borderRadius: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: colors.raised }, buttonText: { color: colors.bg, fontSize: 16, fontWeight: '700', textAlign: 'center' }, white: { color: colors.text }, dim: { opacity: 0.45 },
  error: { color: '#ffc3b9', fontSize: 14, lineHeight: 22 }, notice: { padding: 16, borderRadius: 14, backgroundColor: '#35242a' }, output: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16, gap: 8 },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }, iconCircle: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 28, paddingHorizontal: 18, gap: 16, alignItems: 'stretch' }, emptyIcon: { width: 68, height: 68, borderRadius: 24, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, center: { textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12 }, pill: { alignSelf: 'flex-start', backgroundColor: '#302a21', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 }, network: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  balance: { alignItems: 'center', gap: 12, paddingVertical: 24 }, amount: { color: colors.text, fontSize: 38, letterSpacing: -1.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: colors.line }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
