import { Slot, Stack } from 'expo-router';
import { AuthProvider } from '../src/context/AuthContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import "../global.css";

// Import polyfills at the top level
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Setup global polyfills
if (typeof global.Buffer === 'undefined') {
    global.Buffer = Buffer;
}

if (typeof global.process === 'undefined') {
    global.process = require('process');
}

// Ensure crypto polyfill
if (typeof global.crypto === 'undefined') {
    global.crypto = require('expo-crypto');
}

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
