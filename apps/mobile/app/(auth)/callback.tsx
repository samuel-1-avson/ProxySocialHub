import { useEffect } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

export default function AuthCallback() {
    const params = useLocalSearchParams();
    const router = useRouter();

    useEffect(() => {
        handleSession();
    }, [params]);

    const handleSession = async () => {
        try {
            // Check for tokens
            // Note: Hash params might not be parsed by useLocalSearchParams automatically in all cases
            // but for deep links they often come as query params depending on how Supabase redirects.
            // Implicit flow uses #, PKCE uses code. Supabase usually uses # for implicit.

            // If we are here, we might have parameters.

            // For OAuth with PKCE (recommended), we exchange code.
            // For Implicit (default in some Supabase setups), we get access_token.

            // In the login.tsx we used openAuthSessionAsync which handles the return.
            // This file is a fallback if the app is opened via deep link directly.

            const { access_token, refresh_token, code } = params;

            if (access_token && refresh_token) {
                await supabase.auth.setSession({
                    access_token: access_token as string,
                    refresh_token: refresh_token as string,
                });
                router.replace('/(app)/dashboard');
            } else if (code) {
                // If using PKCE exchange
                // Not standard in the current supabase-js setup without helper, but good to handle
            } else {
                // If no tokens, maybe just redirect to dashboard to check session or login
                // It helps if the user manually re-opened the app
                const { data } = await supabase.auth.getSession();
                if (data.session) {
                    router.replace('/(app)/dashboard');
                } else {
                    router.replace('/(auth)/login');
                }
            }
        } catch (e) {
            console.error(e);
            router.replace('/(auth)/login');
        }
    };

    return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text>Finalizing Login...</Text>
        </View>
    );
}
