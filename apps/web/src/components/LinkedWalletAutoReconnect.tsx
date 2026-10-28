"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth";
import {
  clearManualSolanaWalletDisconnect,
  isManualSolanaWalletDisconnectActive,
} from "@/lib/solana-wallet-session";

/**
 * After JWT auth, try once to restore a wallet-adapter session when a profile
 * wallet is linked and that installed wallet was already selected. Never pick
 * a loadable wallet: connecting it can open a blocking mobile wallet iframe.
 */
export function LinkedWalletAutoReconnect() {
  const { user } = useAuth();
  const { connected, publicKey, wallet, connecting } = useWallet();
  const attempted = useRef(false);

  const expected = (user?.wallet_address || "").trim();

  useEffect(() => {
    attempted.current = false;
  }, [expected]);

  useEffect(() => {
    if (!expected || connecting) return;

    if (isManualSolanaWalletDisconnectActive()) {
      return;
    }

    if (connected && publicKey) {
      const pk = publicKey.toBase58();
      if (pk === expected) {
        clearManualSolanaWalletDisconnect();
        attempted.current = true;
        return;
      }
      // Wrong account already connected — stop auto-reconnect so Disconnect sticks.
      attempted.current = true;
      return;
    }

    if (attempted.current) return;

    if (!wallet || wallet.readyState !== WalletReadyState.Installed) return;

    attempted.current = true;
    // autoConnect is the adapter's silent restoration path. Explicit wallet
    // selection and permission prompts remain in the user's connect action.
    void wallet.adapter.autoConnect().catch(() => {});
  }, [expected, connected, publicKey, wallet, connecting]);

  return null;
}
