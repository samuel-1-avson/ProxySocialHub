"use client";

type MoneyRail = "platform" | "linked" | "escrow" | "paystack";

const COPY: Record<
  MoneyRail,
  { title: string; body: string }
> = {
  platform: {
    title: "Paid from your ProxyHubb balance",
    body: "This moves SOL in your ProxyHubb balance. Marketplace purchases don't use it.",
  },
  linked: {
    title: "Paid from your own wallet",
    body: "This pays from your Phantom or Solflare wallet. Your ProxyHubb balance is not used.",
  },
  escrow: {
    title: "Held safely until you use it",
    body: "You pay from your own wallet. The money is held on Solana and only released to the provider as you use the bandwidth.",
  },
  paystack: {
    title: "Card or mobile money",
    body: "You pay by card or mobile money. We hold it safely and release it to the provider as you use the bandwidth.",
  },
};

type MoneyRailHintProps = {
  rail: MoneyRail;
  className?: string;
};

/** Short, consistent hint for which money rail a screen uses. */
export function MoneyRailHint({ rail, className = "" }: MoneyRailHintProps) {
  const c = COPY[rail];
  return (
    <div
      className={`rounded-lg border border-border bg-secondary px-3 py-2.5 ${className}`}
    >
      <p className="text-xs font-semibold text-primary/90">
        {c.title}
      </p>
      <p className="text-xs text-muted-foreground/80 mt-1 leading-relaxed">{c.body}</p>
    </div>
  );
}
