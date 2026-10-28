"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
    fetchProposalImpact,
    previewGovernanceImpact,
    type GovernanceImpactPreview,
} from "@/lib/governance-impact";
import { Loading, Status } from "@/components/workspace/Patterns";

type Props =
    | { mode: "proposal"; proposalId: string }
    | {
          mode: "draft";
          apiType: string;
          executionData: Record<string, unknown>;
          enabled?: boolean;
      };

function riskTone(level: string): "good" | "warning" | "error" | "neutral" {
    if (level === "low") return "good";
    if (level === "medium") return "warning";
    if (level === "high") return "error";
    return "neutral";
}

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
        <section className="ui-surface space-y-4">
            <div className="ui-section-heading">
                <h2>Impact preview</h2>
                {impact ? <Status tone={riskTone(impact.risk_level)}>{impact.risk_level} risk</Status> : null}
            </div>

            {loading ? <Loading label="Estimating network impact…" /> : null}

            {error ? (
                <p className="text-sm" role="alert">
                    {error}
                </p>
            ) : null}

            {impact && !loading ? (
                <>
                    <p className="text-sm leading-relaxed">{impact.summary}</p>
                    <dl className="ui-detail-list">
                        {impact.lines.map((line) => (
                            <div key={line.label}>
                                <dt>{line.label}</dt>
                                <dd>
                                    {line.value}
                                    {line.hint ? (
                                        <span className="block text-sm text-muted-foreground mt-0.5">
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
                                <li key={w} className="flex gap-2 text-sm leading-relaxed">
                                    <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                                    {w}
                                </li>
                            ))}
                        </ul>
                    ) : null}
                    <p className="ui-note pt-2">
                        Active listings at preview time: {impact.affected_counts.active_listings}
                        {" · "}
                        <Link href="/treasury" className="ui-link">
                            Treasury transparency
                        </Link>
                    </p>
                </>
            ) : null}
        </section>
    );
}
