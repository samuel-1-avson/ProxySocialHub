import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';

export default function Index() {
    const { isAuthenticated, loading } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    useEffect(() => {
        if (loading) return;

        const inAuthGroup = segments[0] === '(auth)';

        if (!isAuthenticated && !inAuthGroup) {
            // Redirect to login if not authenticated
            router.replace('/(auth)/login');
        } else if (isAuthenticated && inAuthGroup) {
            // Redirect to app dashboard if authenticated
            router.replace('/(app)/dashboard');
        } else if (isAuthenticated && segments.length === 0) {
            router.replace('/(app)/dashboard');
        }
    }, [isAuthenticated, loading, segments]);

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#007AFF" />
        </View>
    );
}
