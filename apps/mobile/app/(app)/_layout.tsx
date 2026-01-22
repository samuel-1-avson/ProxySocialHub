import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function AppLayout() {
    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#2563EB',
                tabBarInactiveTintColor: '#6B7280',
                tabBarStyle: {
                    borderTopWidth: 1,
                    borderTopColor: '#F3F4F6',
                    height: 60,
                    paddingBottom: 8,
                    paddingTop: 8,
                },
            }}
        >
            <Tabs.Screen
                name="dashboard"
                options={{
                    title: 'Home',
                    tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="proxy"
                options={{
                    title: 'Proxy',
                    tabBarIcon: ({ color, size }) => <Ionicons name="globe" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="agents"
                options={{
                    title: 'Agents',
                    tabBarIcon: ({ color, size }) => <Ionicons name="hardware-chip" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="wallet"
                options={{
                    title: 'Wallet',
                    tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: 'Settings',
                    tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
                }}
            />
        </Tabs>
    );
}

