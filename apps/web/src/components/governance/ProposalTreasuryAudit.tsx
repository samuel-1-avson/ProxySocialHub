"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Landmark, Loader2 } from "lucide-react";
import {
    getProposalTreasuryTransactions,
    type TreasuryTransaction,
} from "@/lib/services/governance";
import { GlassCard } from "@/components/ui/glass-card";

const EXPLORER_TX_BASE =
    process.env.NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL ??
    "https://explorer.solana.com/tx/";

type Props = {
    proposalId: string;
    showWhenEmpty?: boolean;
};

export function ProposalTreasuryAudit({ proposalId, showWhenEmpty }: Props) {
    const [rows, setRows] = useState<TreasuryTransaction[] | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        getProposalTreasuryTransactions(proposalId)
            .then((data) => {
                if (!cancelled) setRows(data);
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Failed to load treasury audit");
                    setRows([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [proposalId]);

    if (rows === null) {
        return (
            <GlassCard className="!p-6 flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                <Loader2 className="animate-spin" size={16} />
                Loading treasury audit…
            </GlassCard>
        );
    }

    if (error) {
        return (
            <GlassCard className="!p-6 text-[10px] font-black uppercase tracking-widest text-rose-400/80">
                {error}
            </GlassCard>
        );
    }

    if (rows.length === 0 && !showWhenEmpty) {
        return null;
    }

    return (
        <GlassCard className="!p-6 space-y-4 border-white/10">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/50">
                <Landmark size={14} className="text-primary" />
                Treasury audit trail
            </div>
            {rows.length === 0 ? (
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30">
                    No treasury_transactions rows linked to this proposal yet.
                </p>
            ) : (
                <ul className="space-y-3">
                    {rows.map((tx) => (
                        <li
                            key={tx.id}
                            className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2"
                        >
                            <div className="flex justify-between gap-4 text-[10px] font-black uppercase tracking-widest">
                                <span className="text-foreground/80">
                                    {tx.amount} {tx.currency}
                                </span>
                                <span className="text-muted-foreground/40">{tx.status}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground/50 break-all">
                                → {tx.recipient}
                            </p>
                            {tx.description ? (
                                <p className="text-[10px] text-muted-foreground/40">{tx.description}</p>
                            ) : null}
                            {tx.tx_hash ? (
                                <Link
                                    href={`${EXPLORER_TX_BASE}${tx.tx_hash}?cluster=devnet`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-primary hover:underline"
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
