'use client';

import { useEffect, useState } from 'react';
import type { PublicKey } from '@solana/web3.js';

export function useSolanaBalances(opts: {
  connected: boolean;
  publicKey: PublicKey | null;
  linkedAddress: string | null | undefined;
}) {
  const { connected, publicKey, linkedAddress } = opts;
  const [linkedWalletBalance, setLinkedWalletBalance] = useState<number | null>(null);

  // Real-time balance when wallet adapter is connected
  useEffect(() => {
    if (connected && publicKey) {
      const fetchExternalBalance = async () => {
        try {
          const { getConnection } = await import('@/lib/solana');
          const connection = getConnection();
          const balance = await connection.getBalance(publicKey);
          const sol = balance / 1e9;
          setLinkedWalletBalance(sol);
        } catch (e) {
          console.error('Failed to fetch external balance:', e);
        }
      };
      fetchExternalBalance();
      const id = setInterval(fetchExternalBalance, 10000);
      return () => clearInterval(id);
    }
  }, [connected, publicKey]);

  // Fetch on-chain balance from the saved linked address (when adapter is disconnected)
  useEffect(() => {
    if (!linkedAddress || connected) return;
    let cancelled = false;
    const fetchLinkedBalance = async () => {
      try {
        const { getConnection } = await import('@/lib/solana');
        const { PublicKey } = await import('@solana/web3.js');
        const connection = getConnection();
        const pubkey = new PublicKey(linkedAddress);
        const balance = await connection.getBalance(pubkey);
        if (!cancelled) setLinkedWalletBalance(balance / 1e9);
      } catch (e) {
        console.error('Failed to fetch linked wallet balance:', e);
      }
    };
    fetchLinkedBalance();
    const id = setInterval(fetchLinkedBalance, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [linkedAddress, connected]);

  return { linkedWalletBalance, setLinkedWalletBalance };
}
