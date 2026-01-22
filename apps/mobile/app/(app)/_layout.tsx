import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function AppLayout() {
    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: '#059669', // Primary emerald
                tabBarInactiveTintColor: '#71717A',
                tabBarStyle: {
                    borderTopWidth: 2,
                    borderTopColor: '#E4E4E7',
                    height: 85,
                    paddingBottom: 25,
                    paddingTop: 10,
                    backgroundColor: '#FDFBF7', // Retro paper
                },
                tabBarLabelStyle: {
                    fontFamily: 'monospace',
                    fontSize: 10,
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
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
                name="marketplace"
                options={{
                    title: 'Market',
                    tabBarIcon: ({ color, size }) => <Ionicons name="cart" size={size} color={color} />,
                }}
            />
            <Tabs.Screen
                name="feed"
                options={{
                    title: 'Community',
                    tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
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

