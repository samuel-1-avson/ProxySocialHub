"use client";

type MoneyRail = "platform" | "linked" | "escrow";

const COPY: Record<
  MoneyRail,
  { title: string; body: string }
> = {
  platform: {
    title: "Uses platform balance",
    body: "This action moves SOL in your custodial ProxyHubb balance (deposits in, withdraws out). It does not spend Phantom escrow for marketplace bandwidth.",
  },
  linked: {
    title: "Uses linked Solana wallet",
    body: "This action pays from your unlocked Phantom/Solflare account. Platform balance is not used.",
  },
  escrow: {
    title: "Uses on-chain escrow",
    body: "Marketplace bandwidth is funded from your linked wallet into a Solana escrow PDA — not from platform balance.",
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
      className={`rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 ${className}`}
    >
      <p className="text-[10px] font-black uppercase tracking-widest text-primary/90">
        {c.title}
      </p>
      <p className="text-[10px] text-muted-foreground/80 mt-1 leading-relaxed">{c.body}</p>
    </div>
  );
}
