"use client";

/**
 * Honest environment strip for invited Testnet users.
 * Shown when Solana network is devnet/testnet/local, or when
 * NEXT_PUBLIC_SHOW_TESTNET_BANNER=1. Disable with =0.
 */
function shouldShowTestnetBanner(): boolean {
  const force = process.env.NEXT_PUBLIC_SHOW_TESTNET_BANNER?.trim().toLowerCase();
  if (force === "0" || force === "false" || force === "no") return false;
  if (force === "1" || force === "true" || force === "yes") return true;
  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet").toLowerCase();
  return (
    network.includes("devnet") ||
    network.includes("testnet") ||
    network.includes("local")
  );
}

export function TestnetEnvironmentBanner() {
  if (!shouldShowTestnetBanner()) return null;

  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet").trim() || "devnet";

  return (
    <div
      role="status"
      className="border-b border-border bg-secondary text-secondary-foreground"
    >
      <p className="mx-auto max-w-[1120px] px-4 py-2 text-center text-xs leading-relaxed sm:px-6 sm:text-sm">
        <span className="font-medium">Solana {network} · Testnet</span>
        <span className="text-muted-foreground">
          {" · "}Test SOL only. Balances can reset. Do not send mainnet funds.
        </span>
      </p>
    </div>
  );
}
