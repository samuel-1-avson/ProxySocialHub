"use client";

import { useQuery } from "@tanstack/react-query";
import { DataError } from "@/components/workspace/Patterns";
import Link from "next/link";
import { ExternalLink, Landmark, Loader2 } from "lucide-react";
import { getProposalTreasuryTransactions } from "@/lib/services/governance";
import { GlassCard } from "@/components/ui/glass-card";

const EXPLORER_TX_BASE =
  process.env.NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL ??
  "https://explorer.solana.com/tx/";

type Props = {
  proposalId: string;
  showWhenEmpty?: boolean;
};

export function ProposalTreasuryAudit({ proposalId, showWhenEmpty }: Props) {
  const query = useQuery({
    queryKey: ["governance", "treasury-audit", proposalId],
    queryFn: () => getProposalTreasuryTransactions(proposalId),
  });
  const rows = query.data ?? [];

  if (query.isPending) {
    return (
      <GlassCard className="!p-6 flex items-center gap-3 text-sm font-semibold tracking-wide text-muted-foreground">
        <Loader2 className="animate-spin" size={16} />
        Loading treasury audit…
      </GlassCard>
    );
  }

  if (query.isError)
    return (
      <DataError
        title="Treasury audit trail is unavailable"
        error={query.error}
        retry={() => void query.refetch()}
      />
    );

  if (rows.length === 0 && !showWhenEmpty) {
    return null;
  }

  return (
    <GlassCard className="!p-6 space-y-4 border-border">
      <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground">
        <Landmark size={14} className="text-primary" />
        Treasury audit trail
      </div>
      {rows.length === 0 ? (
        <p className="text-sm font-semibold tracking-wide text-muted-foreground">
          No treasury transfers have been linked to this proposal.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((tx) => (
            <li
              key={tx.id}
              className="rounded-xl border border-border bg-secondary p-4 space-y-2"
            >
              <div className="flex justify-between gap-4 text-sm font-semibold tracking-wide">
                <span className="text-foreground/80">
                  {tx.amount} {tx.currency}
                </span>
                <span className="text-muted-foreground">{tx.status}</span>
              </div>
              <p className="text-sm text-muted-foreground break-all">
                → {tx.recipient}
              </p>
              {tx.description ? (
                <p className="text-sm text-muted-foreground">
                  {tx.description}
                </p>
              ) : null}
              {tx.tx_hash ? (
                <Link
                  href={`${EXPLORER_TX_BASE}${tx.tx_hash}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold tracking-wide text-primary hover:underline"
                >
                  View on-chain tx
                  <ExternalLink size={12} />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
