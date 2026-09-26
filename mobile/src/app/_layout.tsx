import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClientProvider, useClient } from '../ClientProvider';
import { WalletProvider } from '../WalletProvider';
import { colors, Icon } from '../ui';
function Navigation() {
  const c = useClient();
  return <View style={{ flex: 1, backgroundColor: colors.bg }}><StatusBar style="light" /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerShadowVisible: false, contentStyle: { backgroundColor: colors.bg }, headerBackTitle: 'Back', headerTitle: '' }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
  </Stack>{!c.foreground && <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}><Icon name="wallet" color={colors.accent} size={38} /><Text style={{ color: colors.text, fontSize: 20 }}>Wallet paused</Text></View>}</View>;
}
export default function RootLayout() { return <SafeAreaProvider><ClientProvider><WalletProvider><Navigation /></WalletProvider></ClientProvider></SafeAreaProvider>; }
