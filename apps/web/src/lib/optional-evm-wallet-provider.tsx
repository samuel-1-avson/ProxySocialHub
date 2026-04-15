import type { ReactNode } from 'react';

export async function OptionalEvmWalletProvider({ children }: { children: ReactNode }) {
    if (process.env.NEXT_PUBLIC_ENABLE_EVM_WALLETS !== 'true') {
        return <>{children}</>;
    }

    const { EvmWalletProvider } = await import('./evm-wallet-provider');
    return <EvmWalletProvider>{children}</EvmWalletProvider>;
}