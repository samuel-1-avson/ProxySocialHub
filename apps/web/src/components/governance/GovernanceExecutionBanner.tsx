"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
    getGovernanceExecutionReadiness,
    type GovernanceExecutionReport,
} from "@/lib/services/governance";

export function GovernanceExecutionBanner() {
    const [report, setReport] = useState<GovernanceExecutionReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getGovernanceExecutionReadiness()
            .then((data) => {
                if (!cancelled) setReport(data);
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Readiness check failed");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (loading) {
        return (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">
                <Loader2 size={14} className="animate-spin" />
                Checking on-chain governance readiness…
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div className="space-y-1 text-[10px] font-black uppercase tracking-widest leading-relaxed">
                    <p>Could not verify governance execution status.</p>
                    <p className="text-muted-foreground/60 normal-case font-mono text-[11px]">{error}</p>
                </div>
            </div>
        );
    }

    if (!report) return null;

    if (report.ready) {
        return (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-[10px] font-black uppercase tracking-widest text-emerald-200/90 leading-relaxed">
                    <p>On-chain governance is active</p>
                    <p className="text-muted-foreground/50 normal-case font-mono text-[11px] font-normal">
                        Create and vote using your linked Solana wallet. Voting power follows your PHB
                        balance at vote time. Quorum is measured in voting power (VP), not voter count.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-2 text-[10px] font-black uppercase tracking-widest text-rose-200/90 leading-relaxed">
                <p>On-chain governance is not ready ({report.status})</p>
                <p className="text-muted-foreground/50 normal-case font-mono text-[11px] font-normal">
                    {report.message}
                </p>
                {report.missing_instructions && report.missing_instructions.length > 0 && (
                    <p className="text-muted-foreground/40 normal-case font-mono text-[10px] font-normal">
                        Missing instructions: {report.missing_instructions.join(", ")}
                    </p>
                )}
                <Link
                    href="/dashboard/wallet"
                    className="inline-block text-primary hover:underline normal-case font-mono text-[11px]"
                >
                    Link a Solana wallet before proposing or voting
                </Link>
            </div>
        </div>
    );
}
