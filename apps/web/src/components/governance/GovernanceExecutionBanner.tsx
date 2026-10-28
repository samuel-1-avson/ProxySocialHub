"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
    getGovernanceExecutionReadiness,
    type GovernanceExecutionReport,
} from "@/lib/services/governance";
import { Loading } from "@/components/workspace/Patterns";

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
        return <Loading label="Checking on-chain governance readiness…" />;
    }

    if (error) {
        return (
            <div className="ui-error" role="alert">
                <strong className="ui-inline-icon">
                    <AlertTriangle size={17} aria-hidden="true" />
                    Could not verify governance execution status.
                </strong>
                <p>{error}</p>
            </div>
        );
    }

    if (!report) return null;

    if (report.ready) {
        return (
            <p className="ui-note">
                <CheckCircle2 size={14} className="inline mr-1" aria-hidden="true" />
                On-chain governance is active. Create and vote using your linked Solana wallet. Voting
                power follows your PHB balance at vote time. Quorum is measured in voting power (VP),
                not voter count.
            </p>
        );
    }

    return (
        <div className="ui-error" role="alert">
            <strong className="ui-inline-icon">
                <AlertTriangle size={17} aria-hidden="true" />
                On-chain governance is not ready ({report.status})
            </strong>
            <p>{report.message}</p>
            {report.missing_instructions && report.missing_instructions.length > 0 && (
                <p>Missing instructions: {report.missing_instructions.join(", ")}</p>
            )}
            <Link href="/dashboard/wallet" className="ui-link text-sm">
                Link a Solana wallet before proposing or voting
            </Link>
        </div>
    );
}
