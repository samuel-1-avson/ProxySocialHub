'use client';

import { FC, ReactNode, useMemo, useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import {
    BaseMessageSignerWalletAdapter,
    WalletName,
    WalletReadyState,
} from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl, Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

// Import default styles
import '@solana/wallet-adapter-react-ui/styles.css';

interface Props {
    children: ReactNode;
}

class PlaywrightSolanaTestWalletAdapter extends BaseMessageSignerWalletAdapter<'Playwright Devnet Wallet'> {
    name = 'Playwright Devnet Wallet' as WalletName<'Playwright Devnet Wallet'>;
    url = 'https://proxyhubb.local/e2e-wallet';
    icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzEwYjk4MSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1mYW1pbHk9Im1vbm9zcGFjZSIgZm9udC1zaXplPSIxNCIgZm9udC13ZWlnaHQ9IjcwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzAwMCI+UEg8L3RleHQ+PC9zdmc+';
    readyState = WalletReadyState.Loadable;
    supportedTransactionVersions = null;
    connecting = false;
    private keypair: Keypair;
    private walletPublicKey: PublicKey | null = null;

    constructor(secret: string) {
        super();
        this.keypair = Keypair.fromSecretKey(parsePlaywrightSecretKey(secret));
        // E2E: expose pubkey and connect immediately so useWallet() exposes signMessage/signTransaction.
        this.walletPublicKey = this.keypair.publicKey;
        this.readyState = WalletReadyState.Installed;
        void this.connect();
    }

    get publicKey() {
        return this.walletPublicKey;
    }

    async connect() {
        if (!this.walletPublicKey) {
            this.walletPublicKey = this.keypair.publicKey;
        }
        this.emit('connect', this.keypair.publicKey);
    }

    async disconnect() {
        this.walletPublicKey = null;
        this.emit('disconnect');
    }

    async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
        if (transaction instanceof VersionedTransaction) {
            transaction.sign([this.keypair]);
            return transaction;
        }
        transaction.partialSign(this.keypair);
        return transaction;
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        const { signAsync } = await import('@noble/ed25519');
        return signAsync(message, this.keypair.secretKey.slice(0, 32));
    }
}

function parsePlaywrightSecretKey(raw: string): Uint8Array {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        return Uint8Array.from(JSON.parse(trimmed) as number[]);
    }

    const binary = atob(trimmed);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export const SolanaWalletProvider: FC<Props> = ({ children }) => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Prevent hydration mismatch
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);

    const rawNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const network = rawNetwork === 'mainnet' || rawNetwork === 'mainnet-beta'
        ? 'mainnet-beta'
        : rawNetwork === 'testnet'
            ? 'testnet'
            : 'devnet';

    const endpoint = useMemo(() => {
        // Allow custom RPC endpoint via environment variable
        return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl(network);
    }, [network]);

    const enableTestWallet = process.env.NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET === '1';
    const testWalletSecret = process.env.NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET;
    const wallets = useMemo(() => {
        if (enableTestWallet && testWalletSecret) {
            return [new PlaywrightSolanaTestWalletAdapter(testWalletSecret)];
        }
        if (!mounted) return [];
        return [];
    }, [enableTestWallet, mounted, testWalletSecret]);

    useEffect(() => {
        if (!enableTestWallet || wallets.length === 0) return;
        const adapter = wallets[0];
        if (adapter.connected) return;
        void adapter.connect().catch((err) => {
            console.error('Playwright test wallet connect failed:', err);
        });
    }, [enableTestWallet, wallets]);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect={enableTestWallet} onError={(err) => {
                // Suppress "source not authorized" errors from autoConnect which are expected if user declined
                if (err.message?.includes('not authorized') || err.message?.includes('The source')) {
                    console.log('Wallet auto-connect declined or not authorized yet.');
                } else if (err.name === 'WalletConnectionError' && err.message?.includes('The source')) {
                    console.log('Wallet connection waiting for user approval.');
                } else {
                    console.error('Wallet Error:', err);
                }
            }}>
                <WalletModalProvider>
                    {children}
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};
