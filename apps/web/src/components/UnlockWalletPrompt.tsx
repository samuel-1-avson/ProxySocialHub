"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletConnectControl } from "@/components/WalletConnectControl";
import { shortWallet } from "@/lib/solana-wallet-session";

/** Re-exported for existing importers; the implementation lives with the session helpers. */
export { shortWallet };

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
 *
 * The connect action is WalletConnectControl (its own picker dialog), never
 * the library WalletMultiButton: the library modal mounts outside the app's
 * Radix dialogs, so inside e.g. the buy dialog its overlay is unreachable
 * (body pointer-events are claimed by the open dialog) and clicking
 * "connect wallet" appeared to do nothing.
 */
export function UnlockWalletPrompt({
  expectedAddress,
  mismatch = false,
  compact = false,
  className = "",
}: UnlockWalletPromptProps) {
  const { connected, publicKey } = useWallet();
  const expected = shortWallet(expectedAddress);
  const current = publicKey ? shortWallet(publicKey.toBase58()) : "";
  const title = mismatch ? "Wrong wallet connected" : "Connect wallet to sign";
  const body = mismatch
    ? expected
      ? `This account uses ${expected}. Disconnect below, switch to that account in your wallet, then reconnect.`
      : "Switch to the Solana account linked to your ProxyHubb profile."
    : expected
      ? `You're signed in. Connect ${expected} to authorize this action.`
      : "You're signed in. Connect your Solana wallet to authorize this action.";

  if (compact) {
    return (
      <div className={`space-y-3 min-w-0 ${className}`}>
        <p className="text-xs text-warning/90 leading-relaxed">{body}</p>
        <WalletConnectControl linkedAddress={expectedAddress ?? null} />
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-warning/30 bg-warning/[0.08] p-4 space-y-4 min-w-0 overflow-hidden ${className}`}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-warning">{title}</p>
        <p className="text-sm text-warning/80 leading-relaxed">{body}</p>
      </div>

      <ol className="list-decimal list-inside space-y-1 text-sm text-warning/70">
        <li>Open your wallet and select {expected || "the linked account"}</li>
        <li>Connect it below (disconnect first if a different account is connected)</li>
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
          <dd className={`truncate ${connected && mismatch ? "text-destructive" : "text-foreground"}`}>
            {connected && current ? current : "None"}
          </dd>
        </div>
      </dl>

      <WalletConnectControl linkedAddress={expectedAddress ?? null} />
    </div>
  );
}
