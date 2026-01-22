import { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

export default function AuthCallback() {
    const router = useRouter();
    const params = useLocalSearchParams();

    useEffect(() => {
        // If the deep link brings us here, the URL params (from hash or query) should be available
        // Supabase usually puts tokens in the hash #access_token=...&refresh_token=...
        // Expo Router parses these into params

        console.log("Auth Callback Params:", params);

        const handleSession = async () => {
            try {
                const { access_token, refresh_token, error, error_description } = params;

                if (error) {
                    console.error("Auth Error:", error, error_description);
                    router.replace('/(auth)/login');
                    return;
                }

                if (access_token && refresh_token) {
                    const { error: sessionError } = await supabase.auth.setSession({
                        access_token: access_token as string,
                        refresh_token: refresh_token as string,
                    });

                    if (sessionError) throw sessionError;

                    // Success! Context will update and redirect, but let's be safe
                    router.replace('/(app)/dashboard');
                } else {
                    // If no tokens found, maybe check if we just need to refresh or getSession?
                    // Or maybe we arrived here without params?
                    // Try getting session from URL if supabase supports it, but we disabled validaiton.
                    router.replace('/(auth)/login');
                }
            } catch (e) {
                console.error("Callback Exception:", e);
                router.replace('/(auth)/login');
            }
        };

        handleSession();
    }, [params]);

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#0000ff" />
            <Text style={{ marginTop: 20 }}>Verifying Session...</Text>
        </View>
    );
}
