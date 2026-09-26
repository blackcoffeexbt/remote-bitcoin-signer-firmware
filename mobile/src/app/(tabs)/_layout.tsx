import { Tabs } from 'expo-router';
import { colors, Icon } from '../../ui';
export default function TabsLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Wallet', tabBarIcon: ({ color }) => <Icon name="wallet" color={color} /> }} />
    <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <Icon name="activity" color={color} /> }} />
    <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color }) => <Icon name="settings" color={color} /> }} />
  </Tabs>;
}
