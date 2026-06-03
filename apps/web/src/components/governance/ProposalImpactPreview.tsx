"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, Loader2 } from "lucide-react";
import {
    fetchProposalImpact,
    impactRiskColor,
    previewGovernanceImpact,
    type GovernanceImpactPreview,
} from "@/lib/governance-impact";
import { GlassCard } from "@/components/ui/glass-card";

type Props =
    | { mode: "proposal"; proposalId: string }
    | {
          mode: "draft";
          apiType: string;
          executionData: Record<string, unknown>;
          enabled?: boolean;
      };

export function ProposalImpactPreview(props: Props) {
    const [impact, setImpact] = useState<GovernanceImpactPreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;

        if (props.mode === "draft" && props.enabled === false) {
            setImpact(null);
            setLoading(false);
            setError("");
            return;
        }

        async function load() {
            setLoading(true);
            setError("");
            try {
                const result =
                    props.mode === "proposal"
                        ? await fetchProposalImpact(props.proposalId)
                        : await previewGovernanceImpact(props.apiType, props.executionData);
                if (!cancelled) setImpact(result);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Could not load impact preview");
                    setImpact(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        const delay = props.mode === "draft" ? 400 : 0;
        const timer = setTimeout(() => {
            void load();
        }, delay);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [
        props.mode,
        props.mode === "proposal" ? props.proposalId : "",
        props.mode === "draft" ? props.apiType : "",
        props.mode === "draft" ? JSON.stringify(props.executionData) : "",
        props.mode === "draft" ? props.enabled : true,
    ]);

    if (props.mode === "draft" && props.enabled === false) {
        return null;
    }

    return (
        <GlassCard className="!p-6 border-white/10 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/50">
                    <BarChart3 size={14} className="text-primary" />
                    Impact preview
                </div>
                {impact ? (
                    <span
                        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded border ${impactRiskColor(impact.risk_level)}`}
                    >
                        {impact.risk_level} risk
                    </span>
                ) : null}
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                    <Loader2 size={14} className="animate-spin" />
                    Estimating network impact…
                </div>
            ) : null}

            {error ? (
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-400/80">{error}</p>
            ) : null}

            {impact && !loading ? (
                <>
                    <p className="text-xs font-bold text-foreground/80 leading-relaxed">{impact.summary}</p>
                    <dl className="space-y-2">
                        {impact.lines.map((line) => (
                            <div
                                key={line.label}
                                className="flex flex-col sm:flex-row sm:justify-between gap-1 text-[10px] border-b border-white/5 pb-2"
                            >
                                <dt className="font-black uppercase tracking-widest text-muted-foreground/40">
                                    {line.label}
                                </dt>
                                <dd className="font-mono text-foreground/90 sm:text-right max-w-md">
                                    {line.value}
                                    {line.hint ? (
                                        <span className="block text-[9px] text-muted-foreground/30 mt-0.5 normal-case">
                                            {line.hint}
                                        </span>
                                    ) : null}
                                </dd>
                            </div>
                        ))}
                    </dl>
                    {impact.warnings && impact.warnings.length > 0 ? (
                        <ul className="space-y-2 pt-2">
                            {impact.warnings.map((w) => (
                                <li
                                    key={w}
                                    className="flex gap-2 text-[10px] font-bold text-amber-300/90 leading-relaxed"
                                >
                                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                    {w}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/30 pt-2">
                        Active listings at preview time: {impact.affected_counts.active_listings}
                        {" · "}
                        <Link href="/treasury" className="text-primary/60 hover:text-primary">
                            Treasury transparency
                        </Link>
                    </p>
                </>
            ) : null}
        </GlassCard>
    );
}
