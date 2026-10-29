'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';

/**
 * Lazy-loads Solana wallet providers only for routes that
 * need signing. Public marketing/explorer pages stay free of chain JS.
 *
 * Reconstruction plan §1.4 / §25.2 / §26.3
 */
const SolanaWalletProvider = dynamic(
  () =>
    import('@/providers/SolanaWalletProvider').then((m) => m.SolanaWalletProvider),
  { ssr: false, loading: () => <div className="ui-loading" role="status">Loading wallet support…</div> }
);

export function WalletBoundary({ children }: { children: ReactNode }) {
  return <SolanaWalletProvider>{children}</SolanaWalletProvider>;
}
