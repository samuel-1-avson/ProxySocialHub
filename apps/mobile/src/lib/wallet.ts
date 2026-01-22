import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

export interface WalletConnection {
    publicKey: string;
    address: string;
    signature?: string;
    encryptionPublicKey?: string;
}

export interface WalletConnector {
    connect: () => Promise<WalletConnection>;
    disconnect: () => Promise<void>;
    signMessage: (message: string) => Promise<string>;
    getPublicKey: () => Promise<string>;
    isConnected: () => boolean;
}

class PhantomWalletConnector implements WalletConnector {
    private connection: WalletConnection | null = null;
    private dappKeyPair: nacl.BoxKeyPair;

    constructor() {
        this.dappKeyPair = nacl.box.keyPair();
    }

    async connect(): Promise<WalletConnection> {
        try {
            // Generate connection parameters
            const params = new URLSearchParams({
                dapp_encryption_public_key: bs58.encode(this.dappKeyPair.publicKey),
                cluster: 'mainnet-beta',
                app_url: 'https://proxyhub.app',
                redirect_link: Linking.createURL('/auth/wallet-callback'),
            });

            // Create Phantom deep link
            const connectUrl = `phantom://v1/connect?${params.toString()}`;
            
            // Try deep link first
            const canOpen = await Linking.canOpenURL(connectUrl);
            if (canOpen) {
                await Linking.openURL(connectUrl);
            } else {
                // Fallback to browser
                const browserUrl = `https://phantom.app/ul/browse/${encodeURIComponent(connectUrl)}`;
                await WebBrowser.openBrowserAsync(browserUrl);
            }

            // Return a promise that resolves when the wallet responds
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Wallet connection timeout'));
                }, 60000); // 60 second timeout

                const handleDeepLink = (event: { url: string }) => {
                    clearTimeout(timeout);
                    this.handleWalletResponse(event.url)
                        .then(resolve)
                        .catch(reject);
                };

                const subscription = Linking.addEventListener('url', handleDeepLink);
                
                // Clean up on timeout
                setTimeout(() => {
                    subscription?.remove();
                }, 60000);
            });
        } catch (error) {
            console.error('Wallet connection error:', error);
            throw new Error('Failed to connect to Phantom wallet');
        }
    }

    private async handleWalletResponse(url: string): Promise<WalletConnection> {
        try {
            const urlObj = new URL(url);
            const params = urlObj.searchParams;

            const errorCode = params.get('errorCode');
            if (errorCode) {
                throw new Error(`Wallet error: ${errorCode} - ${params.get('errorMessage')}`);
            }

            const phantomEncryptionPublicKey = params.get('phantom_encryption_public_key');
            const nonce = params.get('nonce');
            const data = params.get('data');

            if (!phantomEncryptionPublicKey || !nonce || !data) {
                throw new Error('Invalid wallet response');
            }

            // Decrypt the response
            const decryptedData = this.decryptPayload(
                data,
                nonce,
                phantomEncryptionPublicKey
            );

            const response = JSON.parse(decryptedData);
            
            this.connection = {
                publicKey: response.public_key,
                address: response.public_key,
                encryptionPublicKey: phantomEncryptionPublicKey,
            };

            return this.connection;
        } catch (error) {
            console.error('Error handling wallet response:', error);
            throw new Error('Failed to process wallet response');
        }
    }

    async signMessage(message: string): Promise<string> {
        if (!this.connection) {
            throw new Error('Wallet not connected');
        }

        try {
            // Create sign message request
            const payload = {
                message: Buffer.from(message).toString('base64'),
            };

            const [nonce, encryptedPayload] = this.encryptPayload(
                JSON.stringify(payload),
                this.connection.encryptionPublicKey!
            );

            const params = new URLSearchParams({
                dapp_encryption_public_key: bs58.encode(this.dappKeyPair.publicKey),
                nonce: bs58.encode(nonce),
                redirect_link: Linking.createURL('/auth/wallet-callback'),
                payload: encryptedPayload,
            });

            const signUrl = `phantom://v1/signMessage?${params.toString()}`;
            
            const canOpen = await Linking.canOpenURL(signUrl);
            if (canOpen) {
                await Linking.openURL(signUrl);
            } else {
                const browserUrl = `https://phantom.app/ul/browse/${encodeURIComponent(signUrl)}`;
                await WebBrowser.openBrowserAsync(browserUrl);
            }

            // Return promise that resolves with signature
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Message signing timeout'));
                }, 60000);

                const handleDeepLink = (event: { url: string }) => {
                    clearTimeout(timeout);
                    this.handleSignResponse(event.url)
                        .then(resolve)
                        .catch(reject);
                };

                const subscription = Linking.addEventListener('url', handleDeepLink);
                
                setTimeout(() => {
                    subscription?.remove();
                }, 60000);
            });
        } catch (error) {
            console.error('Message signing error:', error);
            throw new Error('Failed to sign message');
        }
    }

    private async handleSignResponse(url: string): Promise<string> {
        try {
            const urlObj = new URL(url);
            const params = urlObj.searchParams;

            const errorCode = params.get('errorCode');
            if (errorCode) {
                throw new Error(`Signing error: ${errorCode} - ${params.get('errorMessage')}`);
            }

            const nonce = params.get('nonce');
            const data = params.get('data');

            if (!nonce || !data) {
                throw new Error('Invalid signing response');
            }

            const decryptedData = this.decryptPayload(
                data,
                nonce,
                this.connection!.encryptionPublicKey!
            );

            const response = JSON.parse(decryptedData);
            return response.signature;
        } catch (error) {
            console.error('Error handling sign response:', error);
            throw new Error('Failed to process signing response');
        }
    }

    async disconnect(): Promise<void> {
        this.connection = null;
    }

    async getPublicKey(): Promise<string> {
        if (!this.connection) {
            throw new Error('Wallet not connected');
        }
        return this.connection.publicKey;
    }

    isConnected(): boolean {
        return this.connection !== null;
    }

    private encryptPayload(payload: string, sharedSecretDapp: string): [Uint8Array, string] {
        const nonce = nacl.randomBytes(24);
        const sharedSecret = bs58.decode(sharedSecretDapp);
        const encrypted = nacl.box.after(
            Buffer.from(payload),
            nonce,
            sharedSecret
        );
        return [nonce, bs58.encode(encrypted)];
    }

    private decryptPayload(data: string, nonce: string, sharedSecretDapp: string): string {
        const sharedSecret = bs58.decode(sharedSecretDapp);
        const decrypted = nacl.box.open.after(
            bs58.decode(data),
            bs58.decode(nonce),
            sharedSecret
        );
        
        if (!decrypted) {
            throw new Error('Failed to decrypt payload');
        }
        
        return Buffer.from(decrypted).toString();
    }
}

// Export singleton instance
export const phantomWallet = new PhantomWalletConnector();