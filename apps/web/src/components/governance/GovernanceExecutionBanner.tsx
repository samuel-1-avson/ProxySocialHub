"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getGovernanceExecutionReadiness } from "@/lib/services/governance";

export function GovernanceExecutionBanner() {
  const query = useQuery({
    queryKey: ["governance", "execution-readiness"],
    queryFn: getGovernanceExecutionReadiness,
  });
  if (query.isPending)
    return (
      <div role="status" className="governance-readiness">
        <Loader2 size={17} className="animate-spin" />
        Checking on-chain governance readiness…
      </div>
    );
  if (query.isError)
    return (
      <div role="alert" className="governance-readiness">
        <AlertTriangle size={20} aria-hidden="true" />
        <div>
          <strong>Could not verify governance execution status.</strong>
          <p>
            The readiness service is unavailable. Review execution status before
            signing a proposal or vote.
          </p>
          <button
            className="ui-link"
            type="button"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  const report = query.data;
  return (
    <div className={"governance-readiness " + (report.ready ? "ready" : "")}>
      {report.ready ? (
        <CheckCircle2 size={20} aria-hidden="true" />
      ) : (
        <AlertTriangle size={20} aria-hidden="true" />
      )}
      <div>
        <strong>
          {report.ready
            ? "On-chain governance is active"
            : "On-chain governance is not ready (" + report.status + ")"}
        </strong>
        <p>
          {report.message ||
            "Review the proposal’s impact and use your linked Solana wallet to participate."}
        </p>
        {!!report.missing_instructions?.length && (
          <p>Missing instructions: {report.missing_instructions.join(", ")}</p>
        )}
        <Link href="/app/wallet" className="ui-link">
          Manage your linked Solana wallet →
        </Link>
      </div>
    </div>
  );
}
