'use client';

import { useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuth } from '@/lib/auth';
import { clearSolanaWalletAdapterSession } from '@/lib/solana-wallet-session';

function playwrightTestWalletActive(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET === '1') return true;
  if (typeof window !== 'undefined' && window.__PLAYWRIGHT_SOLANA_TEST_WALLET__) return true;
  return false;
}

/**
 * Keeps the Solana wallet adapter bound to the authenticated user.
 *
 * - Do NOT disconnect while logged out (login needs a connected wallet).
 * - Clear on explicit logout / auth→unauth transition / user-id switch.
 * - Do NOT auto-disconnect on linked-wallet mismatch — that fights Phantom
 *   account switching and leaves the adapter stuck disconnected. Vote UI
 *   already blocks Confirm until adapter pubkey === linked wallet.
 */
export function WalletAuthSync() {
  const { user, isAuthenticated } = useAuth();
  const { connected, disconnect } = useWallet();
  const prevUserIdRef = useRef<string | null>(null);
  const wasAuthenticatedRef = useRef(false);

  useEffect(() => {
    if (playwrightTestWalletActive()) return;
    const onClear = () => {
      clearSolanaWalletAdapterSession();
      if (connected) {
        void disconnect().catch(() => undefined);
      }
    };
    window.addEventListener('proxyhubb:wallet-session-clear', onClear);
    window.addEventListener('proxyhubb:auth-logout', onClear);
    return () => {
      window.removeEventListener('proxyhubb:wallet-session-clear', onClear);
      window.removeEventListener('proxyhubb:auth-logout', onClear);
    };
  }, [connected, disconnect]);

  useEffect(() => {
    if (playwrightTestWalletActive()) return;

    const userId = user?.id ?? null;
    const authenticated = Boolean(isAuthenticated && userId);

    // Transition authenticated → logged out: clear adapter (logout path).
    if (wasAuthenticatedRef.current && !authenticated) {
      clearSolanaWalletAdapterSession();
      if (connected) {
        void disconnect().catch(() => undefined);
      }
      prevUserIdRef.current = null;
      wasAuthenticatedRef.current = false;
      return;
    }

    if (!authenticated) {
      // Stay idle on login/register so the user can connect + sign.
      wasAuthenticatedRef.current = false;
      prevUserIdRef.current = null;
      return;
    }

    wasAuthenticatedRef.current = true;

    const prev = prevUserIdRef.current;
    if (prev && prev !== userId) {
      // Different account logged in — drop the previous adapter session.
      clearSolanaWalletAdapterSession();
      if (connected) {
        void disconnect().catch(() => undefined);
      }
      prevUserIdRef.current = userId;
      return;
    }
    prevUserIdRef.current = userId;
  }, [isAuthenticated, user?.id, connected, disconnect]);

  return null;
}
