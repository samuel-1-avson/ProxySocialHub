import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../src/context/AuthContext';
import { phantomWallet } from '../../src/lib/wallet';

export default function WalletCallback() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const { walletLogin } = useAuth();

    useEffect(() => {
        const handleWalletCallback = async () => {
            try {
                // Check for errors
                if (params.errorCode) {
                    console.error('Wallet error:', params.errorCode, params.errorMessage);
                    router.replace('/auth/login?error=wallet_error');
                    return;
                }

                // Handle successful connection
                if (params.phantom_encryption_public_key && params.data && params.nonce) {
                    // The wallet connector will handle the response
                    console.log('Wallet connection successful');
                    
                    // Generate message to sign for authentication
                    const message = `Sign this message to authenticate with ProxyHub.\nTimestamp: ${Date.now()}`;
                    
                    try {
                        // Get the signature
                        const signature = await phantomWallet.signMessage(message);
                        const publicKey = await phantomWallet.getPublicKey();
                        
                        // Complete wallet login
                        await walletLogin(publicKey, signature, message);
                        
                        // Navigate to app
                        router.replace('/(app)');
                    } catch (signError) {
                        console.error('Wallet signing error:', signError);
                        router.replace('/auth/login?error=wallet_sign_failed');
                    }
                    return;
                }

                // Handle signing response
                if (params.signature) {
                    // This is handled by the wallet connector
                    console.log('Message signed successfully');
                    return;
                }

                // Default case - redirect to login
                router.replace('/auth/login');
            } catch (error) {
                console.error('Wallet callback error:', error);
                router.replace('/auth/login?error=wallet_callback_failed');
            }
        };

        handleWalletCallback();
    }, [params, router, walletLogin]);

    return (
        <View style={styles.container}>
            <ActivityIndicator size="large" color="#9945FF" />
            <Text style={styles.text}>Processing wallet authentication...</Text>
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