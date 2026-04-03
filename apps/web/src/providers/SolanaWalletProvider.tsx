'use client';

import { FC, ReactNode, useMemo, useState, useEffect } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { clusterApiUrl } from '@solana/web3.js';

// Import default styles
import '@solana/wallet-adapter-react-ui/styles.css';

interface Props {
    children: ReactNode;
}

export const SolanaWalletProvider: FC<Props> = ({ children }) => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        // Prevent hydration mismatch
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMounted(true);
    }, []);

    // Use devnet for development, mainnet-beta for production
    const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet'
        ? 'mainnet-beta'
        : 'devnet';

    const endpoint = useMemo(() => {
        // Allow custom RPC endpoint via environment variable
        return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl(network);
    }, [network]);

    const wallets = useMemo(
        () => [
            // Phantom is automatically registered as a Standard Wallet as of wallet-adapter 0.9.x+
            new SolflareWalletAdapter(),
        ],
        []
    );

    if (!mounted) {
        return <>{children}</>;
    }

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect={false} onError={(err) => {
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
