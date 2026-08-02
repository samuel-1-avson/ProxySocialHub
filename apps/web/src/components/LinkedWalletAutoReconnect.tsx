"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth";

/**
 * After JWT auth, try to restore the wallet-adapter session when a profile
 * wallet is linked. Relies on WalletProvider autoConnect + select/connect.
 * Declines stay silent — UnlockWalletPrompt handles UX.
 */
export function LinkedWalletAutoReconnect() {
  const { user } = useAuth();
  const { connected, publicKey, wallets, select, connect, connecting } = useWallet();
  const attempted = useRef(false);

  const expected = (user?.wallet_address || "").trim();

  useEffect(() => {
    attempted.current = false;
  }, [expected]);

  useEffect(() => {
    if (!expected || connecting || attempted.current) return;
    if (connected && publicKey) return;

    const installed = wallets.filter(
      (w) =>
        w.readyState === WalletReadyState.Installed ||
        w.readyState === WalletReadyState.Loadable,
    );
    if (installed.length === 0) return;

    attempted.current = true;
    const preferred =
      installed.find((w) => /phantom/i.test(w.adapter.name)) || installed[0];

    void (async () => {
      try {
        select(preferred.adapter.name);
        await new Promise((r) => setTimeout(r, 50));
        await connect();
      } catch {
        attempted.current = false;
      }
    })();
  }, [expected, connected, publicKey, wallets, select, connect, connecting]);

  return null;
}
