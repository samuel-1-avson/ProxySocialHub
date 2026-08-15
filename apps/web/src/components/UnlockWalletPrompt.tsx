"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SolanaWalletButton } from "@/components/SolanaWalletButton";
import {
  clearManualSolanaWalletDisconnect,
  forceDisconnectSolanaWallet,
} from "@/lib/solana-wallet-session";

/** Truncate a base58 address for inline hints. */
export function shortWallet(address: string | null | undefined, head = 4, tail = 4): string {
  const a = (address || "").trim();
  if (!a) return "";
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

type UnlockWalletPromptProps = {
  /** Linked / expected pubkey from profile */
  expectedAddress?: string | null;
  /** When adapter is connected to a different account */
  mismatch?: boolean;
  /** Optional compact mode (single line) */
  compact?: boolean;
  className?: string;
};

/**
 * Shown when the user is already authenticated but the browser wallet-adapter
 * session is missing or on the wrong account. Do not use for login/register.
 */
export function UnlockWalletPrompt({
  expectedAddress,
  mismatch = false,
  compact = false,
  className = "",
}: UnlockWalletPromptProps) {
  const { connected, publicKey, disconnect, select } = useWallet();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const expected = shortWallet(expectedAddress);
  const current = publicKey ? shortWallet(publicKey.toBase58()) : "";
  const title = mismatch ? "Wrong wallet connected" : "Connect wallet to sign";
  const body = mismatch
    ? expected
      ? `This account votes with ${expected}. In Phantom, switch to that account first, then disconnect here and reconnect.`
      : "Switch to the Solana account linked to your ProxyHubb profile."
    : expected
      ? `You're signed in. Connect ${expected} to authorize this action.`
      : "You're signed in. Connect your Solana wallet to authorize this action.";

  const handleDisconnect = async () => {
    setBusy(true);
    setHint("");
    try {
      await forceDisconnectSolanaWallet({ disconnect, select });
      setHint(
        expected
          ? `Disconnected. Switch Phantom to ${expected}, then tap Select Wallet.`
          : "Disconnected. Switch Phantom to the linked account, then reconnect.",
      );
    } catch {
      setHint("Disconnect failed — open Phantom and disconnect this site, then retry.");
    } finally {
      setBusy(false);
    }
  };

  const handleConnectClick = () => {
    // Allow the next connect after a manual disconnect.
    clearManualSolanaWalletDisconnect();
  };

  if (compact) {
    return (
      <div className={`space-y-3 min-w-0 ${className}`}>
        <p className="text-xs text-amber-400/90 leading-relaxed">{body}</p>
        <div onClickCapture={handleConnectClick}>
          <SolanaWalletButton fullWidth />
        </div>
        {connected ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDisconnect()}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs font-medium text-muted-foreground hover:border-rose-500/40 hover:text-rose-300 transition-colors disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect browser wallet"}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-4 space-y-4 min-w-0 overflow-hidden ${className}`}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-amber-300">{title}</p>
        <p className="text-sm text-amber-200/80 leading-relaxed">{body}</p>
      </div>

      <ol className="list-decimal list-inside space-y-1 text-sm text-amber-100/70">
        <li>Open Phantom and select {expected || "the linked account"}</li>
        <li>Disconnect below (stays disconnected until you reconnect)</li>
        <li>Select Wallet / Connect with that account</li>
      </ol>

      <dl className="grid gap-2 text-sm font-mono">
        {expected ? (
          <div className="flex items-baseline justify-between gap-3 min-w-0">
            <dt className="shrink-0 text-muted-foreground">Required</dt>
            <dd className="truncate text-foreground" title={expectedAddress || undefined}>
              {expected}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3 min-w-0">
          <dt className="shrink-0 text-muted-foreground">Connected</dt>
          <dd className={`truncate ${connected && mismatch ? "text-rose-400" : "text-foreground"}`}>
            {connected && current ? current : "None"}
          </dd>
        </div>
      </dl>

      <div className="space-y-2 min-w-0">
        {connected ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDisconnect()}
            className="w-full rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
          >
            {busy ? "Disconnecting…" : "Disconnect browser wallet"}
          </button>
        ) : (
          <div onClickCapture={handleConnectClick}>
            <SolanaWalletButton fullWidth />
          </div>
        )}
        {hint ? <p className="text-xs text-emerald-300/90 leading-relaxed">{hint}</p> : null}
      </div>
    </div>
  );
}
