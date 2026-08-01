'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

/**
 * Client-side counterpart of OptionalEvmWalletProvider for use inside
 * WalletBoundary. Loads the EVM stack only when explicitly enabled.
 */
export function OptionalEvmWalletProviderClient({
  children,
}: {
  children: ReactNode;
}) {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_EVM_WALLETS === 'true';
  const [Provider, setProvider] = useState<ComponentType<{ children: ReactNode }> | null>(
    null
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void import('./evm-wallet-provider').then((mod) => {
      if (!cancelled) {
        setProvider(() => mod.EvmWalletProvider);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled || !Provider) {
    return <>{children}</>;
  }

  return <Provider>{children}</Provider>;
}
