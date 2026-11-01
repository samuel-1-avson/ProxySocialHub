"use client";

import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { http, WagmiProvider } from 'wagmi';
import { mainnet, polygon, polygonAmoy, sepolia } from 'viem/chains';
import '@rainbow-me/rainbowkit/styles.css';

const supportedChains = {
    mainnet,
    polygon,
    polygonAmoy,
    sepolia,
};

const enableEvmWallets = process.env.NEXT_PUBLIC_ENABLE_EVM_WALLETS === 'true';
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || '';
const evmChainName = process.env.NEXT_PUBLIC_EVM_CHAIN?.trim() || 'sepolia';
const evmRpcUrl = process.env.NEXT_PUBLIC_EVM_RPC_URL?.trim() || '';
const selectedChain = supportedChains[evmChainName as keyof typeof supportedChains] ?? null;

if (enableEvmWallets && process.env.NODE_ENV !== 'test') {
    if (!selectedChain) {
        console.warn(`NEXT_PUBLIC_EVM_CHAIN \"${evmChainName}\" is not supported. Supported values: ${Object.keys(supportedChains).join(', ')}.`);
    }

    if (!evmRpcUrl) {
        console.warn('NEXT_PUBLIC_EVM_RPC_URL is not set. EVM wallets remain disabled until a browser-safe RPC endpoint is provided.');
    }

    if (!walletConnectProjectId) {
        console.warn('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. WalletConnect-backed EVM wallets remain disabled.');
    }
}

const config = enableEvmWallets && selectedChain && evmRpcUrl && walletConnectProjectId
    ? getDefaultConfig({
        appName: 'ProxyHubb',
        projectId: walletConnectProjectId,
        chains: [selectedChain],
        transports: {
            [selectedChain.id]: http(evmRpcUrl),
        },
        ssr: true,
    })
    : null;

export function EvmWalletProvider({ children }: { children: React.ReactNode }) {
    if (!config) {
        return <>{children}</>;
    }

    return (
        <WagmiProvider config={config}>
            <RainbowKitProvider
                theme={darkTheme({
                    accentColor: '#c5ef70',
                    accentColorForeground: '#182213',
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
