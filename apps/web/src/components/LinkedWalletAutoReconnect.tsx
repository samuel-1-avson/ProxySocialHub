"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useAuth } from "@/lib/auth";
import {
  AUTH_LOGOUT_EVENT,
  clearManualSolanaWalletDisconnect,
  isManualSolanaWalletDisconnectActive,
  pickAutoReconnectWallet,
  readRememberedWalletName,
} from "@/lib/solana-wallet-session";

/**
 * After JWT auth, try once to restore a wallet-adapter session for the
 * linked wallet when an installed browser wallet is available.
 *
 * The login page and the workspace mount separate wallet providers, so the
 * adapter always starts disconnected here even right after sign-in. Wallet
 * selection is stored by the provider, but a failed silent reconnect makes
 * the adapter library drop that selection; when exactly one installed
 * wallet remains, re-select it here instead of leaving the user with a
 * dead Connect button. Loadable web wallets are never picked: connecting
 * one without a click can open a blocking hosted-wallet page.
 */
/**
 * Addresses automatic restore already attempted in this page lifetime.
 * Adapter-session resets remount this component; without a page-level
 * record a reset would re-trigger the same failing silent attempt in a
 * loop. Explicit logout clears the record for the next sign-in.
 */
const attemptedAutoRestoreFor = new Set<string>();

export function LinkedWalletAutoReconnect() {
  const { user } = useAuth();
  const { connected, connecting, publicKey, wallet, wallets, select, connect } =
    useWallet();
  const attempted = useRef(false);

  const expected = (user?.wallet_address || "").trim();

  useEffect(() => {
    attempted.current = false;
  }, [expected]);

  useEffect(() => {
    const onLogout = () => attemptedAutoRestoreFor.clear();
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  }, []);

  useEffect(() => {
    if (!expected || connecting) return;

    if (isManualSolanaWalletDisconnectActive()) {
      return;
    }

    if (connected && publicKey) {
      if (publicKey.toBase58() === expected) {
        clearManualSolanaWalletDisconnect();
      }
      // Matching or not, a live connection ends auto-reconnect. A wrong
      // account is a user decision (see the wallet page recovery actions),
      // not something to fight by reconnecting underneath them.
      attempted.current = true;
      return;
    }

    if (attempted.current || attemptedAutoRestoreFor.has(expected)) return;

    if (!wallet) {
      // Selection was dropped (a previous silent reconnect failed) or never
      // existed. Restore the wallet used at sign-in when it is installed;
      // otherwise only an unambiguous single installed wallet may be picked.
      const name = pickAutoReconnectWallet(
        wallets.map((entry) => ({
          name: entry.adapter.name,
          readyState: entry.readyState,
        })),
        readRememberedWalletName(),
      );
      if (name) {
        console.debug(`[wallet] auto-restore selecting ${name}`);
        select(name as WalletName);
      }
      return;
    }

    // Installed only. "Loadable" is a web wallet or mobile deep link that
    // exists in every browser (Solflare reports it even with no extension);
    // connecting it from here, with no click, injected connect.solflare.com
    // as a full-page iframe over the app (or redirected mobile users away).
    // Those open only when the user picks them in the wallet modal.
    if (wallet.readyState !== WalletReadyState.Installed) return;

    attempted.current = true;
    attemptedAutoRestoreFor.add(expected);
    // Go through the provider's connect so connection state and failures
    // stay visible. The provider error handler republishes failures to the
    // connect controls; nothing is fabricated if the wallet declines.
    console.debug(
      `[wallet] auto-restore connecting ${wallet.adapter.name} for ${expected.slice(0, 4)}…`,
    );
    void connect().catch((err: unknown) => {
      console.debug("[wallet] auto-restore connect failed", err);
    });
  }, [expected, connected, connecting, publicKey, wallet, wallets, select, connect]);

  return null;
}
