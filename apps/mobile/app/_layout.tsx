import "../os-shim"; // Polyfills first
import { Slot, Stack } from 'expo-router';
import { AuthProvider } from '../src/context/AuthContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import "../global.css";

export default function RootLayout() {
    return (
        <SafeAreaProvider>
            <AuthProvider>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: 'white' },
                    }}
                />
            </AuthProvider>
        </SafeAreaProvider>
    );
}
