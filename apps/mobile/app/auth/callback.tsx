import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

export default function AuthCallback() {
    const router = useRouter();
    const params = useLocalSearchParams();

    useEffect(() => {
        const handleAuthCallback = async () => {
            try {
                // Handle OAuth callback
                if (params.code) {
                    const { data, error } = await supabase.auth.exchangeCodeForSession(String(params.code));
                    
                    if (error) {
                        console.error('OAuth callback error:', error);
                        router.replace('/auth/login?error=oauth_failed');
                        return;
                    }

                    if (data.session) {
                        console.log('OAuth login successful');
                        router.replace('/(app)');
                        return;
                    }
                }

                // Handle error cases
                if (params.error) {
                    console.error('OAuth error:', params.error);
                    router.replace('/auth/login?error=' + params.error);
                    return;
                }

                // Default redirect to login
                router.replace('/auth/login');
            } catch (error) {
                console.error('Auth callback error:', error);
                router.replace('/auth/login?error=callback_failed');
            }
        };

        handleAuthCallback();
    }, [params, router]);

    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.text}>Completing authentication...</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    text: {
        marginTop: 16,
        fontSize: 16,
        color: '#666',
    },
});