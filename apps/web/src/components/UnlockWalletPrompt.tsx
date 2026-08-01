"use client";

import { SolanaWalletButton } from "@/components/SolanaWalletButton";

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
  const short = shortWallet(expectedAddress);
  const title = mismatch
    ? "Wrong wallet unlocked"
    : "Unlock wallet to sign";
  const body = mismatch
    ? short
      ? `Switch Phantom/Solflare to ${short} — the account linked to your ProxyHubb profile.`
      : "Switch to the Solana account linked to your ProxyHubb profile."
    : short
      ? `You're signed in. Unlock ${short} in your browser wallet to authorize this transaction.`
      : "You're signed in. Unlock your Solana wallet in the browser to authorize this transaction.";

  if (compact) {
    return (
      <div className={`space-y-2 ${className}`}>
        <p className="text-[10px] font-mono text-amber-500/90 uppercase tracking-wide">{body}</p>
        <SolanaWalletButton />
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 space-y-3 ${className}`}
    >
      <div>
        <p className="text-sm font-bold text-amber-400">{title}</p>
        <p className="text-xs text-amber-500/80 mt-1 leading-relaxed">{body}</p>
      </div>
      <SolanaWalletButton />
    </div>
  );
}
