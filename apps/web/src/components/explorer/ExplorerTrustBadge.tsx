"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { getExplorerDecentralizationStatus } from "@/lib/services/explorer";

export function ExplorerTrustBadge() {
  const query = useQuery({
    queryKey: ["explorer-decentralization-status", 256],
    queryFn: () => getExplorerDecentralizationStatus(256),
    refetchInterval: 20_000,
    retry: false,
  });
  const report = query.data;
  const hasEvidence = !!report && report.recent_slots_analyzed > 0;
  const conflicting = hasEvidence && report.conflicting_slots > 0;
  const verified = hasEvidence && !conflicting && report.fully_decentralized;
  const label = query.isPending
    ? "Checking"
    : !report
      ? "Unavailable"
      : conflicting
        ? "Conflicting views"
        : verified
          ? "Verified"
          : hasEvidence
            ? "Partial quorum"
            : "Bootstrapping";
  return (
    <Link
      href="/explorer/health"
      className={"explorer-trust-badge" + (verified ? " verified" : "")}
      title="Reported writer quorum. Open health for the underlying evidence."
    >
      {query.isPending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      ) : (
        <ShieldCheck size={14} aria-hidden="true" />
      )}
      <span>Trust: {label}</span>
      {hasEvidence && (
        <span className="explorer-trust-count">
          {report.unique_writers}/{report.min_writers_required} writers
        </span>
      )}
    </Link>
  );
}
