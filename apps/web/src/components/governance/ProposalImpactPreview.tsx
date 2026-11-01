"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, BarChart3, Loader2 } from "lucide-react";
import {
  fetchProposalImpact,
  impactRiskColor,
  previewGovernanceImpact,
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
  const proposalId = props.mode === "proposal" ? props.proposalId : "";
  const apiType = props.mode === "draft" ? props.apiType : "";
  const payload =
    props.mode === "draft" ? JSON.stringify(props.executionData) : "";
  const [debouncedPayload, setDebouncedPayload] = useState(payload);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPayload(payload), 400);
    return () => clearTimeout(timer);
  }, [payload]);
  const enabled =
    props.mode === "proposal" ||
    (props.enabled !== false && payload === debouncedPayload);
  const query = useQuery({
    queryKey: [
      "governance",
      "impact",
      props.mode,
      proposalId,
      apiType,
      debouncedPayload,
    ],
    queryFn: () =>
      props.mode === "proposal"
        ? fetchProposalImpact(proposalId)
        : previewGovernanceImpact(
            apiType,
            JSON.parse(debouncedPayload) as Record<string, unknown>,
          ),
    enabled,
    retry: false,
  });
  const impact = query.data;
  const loading = query.isPending || payload !== debouncedPayload;
  const error = query.error instanceof Error ? query.error.message : "";

  if (props.mode === "draft" && props.enabled === false) {
    return null;
  }

  return (
    <GlassCard className="!p-6 border-border space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground">
          <BarChart3 size={14} className="text-primary" />
          Impact preview
        </div>
        {impact ? (
          <span
            className={`text-xs font-semibold tracking-wide px-2 py-1 rounded border ${impactRiskColor(impact.risk_level)}`}
          >
            {impact.risk_level} risk
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Estimating network impact…
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}{" "}
          <button
            type="button"
            className="ui-link"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </p>
      ) : null}

      {impact && !loading ? (
        <>
          <p className="text-xs font-bold text-foreground/80 leading-relaxed">
            {impact.summary}
          </p>
          <dl className="space-y-2">
            {impact.lines.map((line) => (
              <div
                key={line.label}
                className="flex flex-col sm:flex-row sm:justify-between gap-1 text-sm border-b border-border pb-2"
              >
                <dt className="font-semibold tracking-wide text-muted-foreground">
                  {line.label}
                </dt>
                <dd className="font-mono text-foreground/90 sm:text-right max-w-md">
                  {line.value}
                  {line.hint ? (
                    <span className="block text-xs text-muted-foreground mt-0.5 normal-case">
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
                  className="flex gap-2 text-sm font-bold text-amber-700 dark:text-amber-300 leading-relaxed"
                >
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs font-semibold tracking-wide text-muted-foreground pt-2">
            Active listings at preview time:{" "}
            {impact.affected_counts.active_listings}
            {" · "}
            <Link href="/treasury" className="text-primary hover:text-primary">
              Treasury transparency
            </Link>
          </p>
        </>
      ) : null}
    </GlassCard>
  );
}
