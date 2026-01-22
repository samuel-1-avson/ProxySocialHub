import { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
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
            router.replace('/(auth)/login');
        } else if (isAuthenticated && inAuthGroup) {
            router.replace('/(app)/dashboard');
        } else if (isAuthenticated && (segments as string[]).length === 0) {
            router.replace('/(app)/dashboard');
        }
    }, [isAuthenticated, loading, segments]);

    return (
        <View className="flex-1 bg-background justify-center items-center">
            <View className="items-center">
                <View className="w-16 h-16 bg-primary/20 border-2 border-primary rounded-sm items-center justify-center mb-6">
                    <ActivityIndicator size="small" color="#059669" />
                </View>
                <Text className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.4em]">Synchronizing_Protocol...</Text>
            </View>
        </View>
    );
}
