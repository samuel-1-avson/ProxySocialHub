"use client";

import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { polygonAmoy, sepolia, mainnet, polygon } from 'wagmi/chains';
import '@rainbow-me/rainbowkit/styles.css';

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || '';

if (!walletConnectProjectId && process.env.NODE_ENV !== 'test') {
    console.warn('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. WalletConnect will be unavailable.');
}

const config = walletConnectProjectId
    ? getDefaultConfig({
        appName: 'ProxyHub',
        projectId: walletConnectProjectId,
        chains: [polygonAmoy, sepolia, mainnet, polygon],
        ssr: true,
    })
    : null;

export function Web3Provider({ children }: { children: React.ReactNode }) {
    if (!config) {
        return <>{children}</>;
    }

    return (
        <WagmiProvider config={config}>
            <RainbowKitProvider
                theme={darkTheme({
                    accentColor: '#f97316', // Orange-500
                    accentColorForeground: 'white',
                    borderRadius: 'medium',
                    fontStack: 'system',
                    overlayBlur: 'small',
                })}
            >
                {children}
            </RainbowKitProvider>
        </WagmiProvider>
    );
}
