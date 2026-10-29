"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getExplorerDecentralizationStatus } from "@/lib/services/explorer";
import { explorerHref } from "@/lib/navigation/workspace";
import { cn } from "@/lib/utils";

type ExplorerTrustBadgeProps = {
    className?: string;
    windowSlots?: number;
};

export function ExplorerTrustBadge({ className, windowSlots = 256 }: ExplorerTrustBadgeProps) {
    const { data } = useQuery({
        queryKey: ["explorer-trust-badge", windowSlots],
        queryFn: () => getExplorerDecentralizationStatus(windowSlots),
        refetchInterval: 20000,
        retry: false,
    });

    const mode = data?.explorer_mode || "bootstrap_no_attestations";
    const quorumPct = data?.recent_slots_analyzed
        ? Math.round((data.quorum_ratio || 0) * 100)
        : 0;

    const tone = !data || data.recent_slots_analyzed === 0
        ? "text-muted-foreground border-border bg-muted"
        : data.fully_decentralized
            ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
            : (data.conflicting_slots || 0) > 0
                ? "text-rose-300 border-rose-500/30 bg-rose-500/10"
                : "text-amber-950 border-amber-300 bg-amber-200 dark:text-yellow-300 dark:border-yellow-500/30 dark:bg-yellow-500/10";

    const label = !data || data.recent_slots_analyzed === 0
        ? "Trust: Bootstrapping"
        : data.fully_decentralized
            ? "Trust: Verified"
            : (data.conflicting_slots || 0) > 0
                ? "Trust: Conflicts"
                : "Trust: Partial";

    return (
        <Link
            href={explorerHref()}
            className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all hover:brightness-110",
                tone,
                className,
            )}
            title={`mode=${mode} writers=${data?.unique_writers ?? 0}/${data?.min_writers_required ?? 0} quorum=${quorumPct}%`}
        >
            <ShieldCheck size={12} />
            <span>{label}</span>
            {data && data.recent_slots_analyzed > 0 && (
                <span className="text-[9px] opacity-80">
                    {data.unique_writers}/{data.min_writers_required} • {quorumPct}%
                </span>
            )}
        </Link>
    );
}
