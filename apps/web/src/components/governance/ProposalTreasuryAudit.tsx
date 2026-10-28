"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    getProposalTreasuryTransactions,
    type TreasuryTransaction,
} from "@/lib/services/governance";
import { Loading, Status } from "@/components/workspace/Patterns";

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
        return <Loading label="Loading treasury audit…" />;
    }

    if (error) {
        return (
            <p className="text-sm" role="alert">
                {error}
            </p>
        );
    }

    if (rows.length === 0 && !showWhenEmpty) {
        return null;
    }

    return (
        <section className="ui-surface space-y-4">
            <h2>Treasury audit trail</h2>
            {rows.length === 0 ? (
                <p className="ui-note">No treasury_transactions rows linked to this proposal yet.</p>
            ) : (
                <ul className="space-y-3">
                    {rows.map((tx) => (
                        <li key={tx.id} className="border-b border-border pb-3 space-y-1">
                            <div className="flex justify-between gap-4 text-sm">
                                <span>
                                    {tx.amount} {tx.currency}
                                </span>
                                <Status tone="neutral">{tx.status}</Status>
                            </div>
                            <p className="text-sm text-muted-foreground break-all">→ {tx.recipient}</p>
                            {tx.description ? (
                                <p className="text-sm text-muted-foreground">{tx.description}</p>
                            ) : null}
                            {tx.tx_hash ? (
                                <Link
                                    href={`${EXPLORER_TX_BASE}${tx.tx_hash}?cluster=devnet`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-link text-sm"
                                >
                                    View on-chain tx
                                </Link>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
