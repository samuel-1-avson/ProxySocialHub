"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getProposals, type Proposal } from "@/lib/services/governance";
import { GovernanceExecutionBanner } from "@/components/governance/GovernanceExecutionBanner";
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Stat,
    Status,
    shortDate,
} from "@/components/workspace/Patterns";

function statusTone(status: string): "good" | "warning" | "error" | "neutral" {
    switch (status) {
        case "active":
            return "warning";
        case "passed":
        case "executed":
            return "good";
        case "rejected":
            return "error";
        default:
            return "neutral";
    }
}

export default function GovernancePage() {
    const [proposals, setProposals] = useState<Proposal[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        async function loadProposals() {
            try {
                const data = await getProposals();
                setProposals(data);
                setLoadError("");
            } catch (err) {
                console.error("Failed to load proposals", err);
                setLoadError(err instanceof Error ? err.message : "Failed to load proposals");
            } finally {
                setLoading(false);
            }
        }
        loadProposals();
    }, []);

    const retry = () => {
        setLoading(true);
        setLoadError("");
        getProposals()
            .then((data) => {
                setProposals(data);
                setLoadError("");
            })
            .catch((err) => {
                console.error("Failed to load proposals", err);
                setLoadError(err instanceof Error ? err.message : "Failed to load proposals");
            })
            .finally(() => setLoading(false));
    };

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Governance"
                title="Governance"
                description="Participate in protocol upgrades and parameter adjustments."
                actions={
                    <Link href="/governance/create" className="ui-button">
                        Create proposal
                    </Link>
                }
            />

            <GovernanceExecutionBanner />

            <section className="ui-stats">
                <Stat
                    label="Voting influence"
                    value="1 wallet = 1 vote"
                    detail="Fixed on-chain weight (token VP later)"
                />
                <Stat
                    label="Active proposals"
                    value={proposals.filter((p) => p.status === "active").length}
                    detail="Pending settlement"
                />
                <Stat
                    label="Executed"
                    value={proposals.filter((p) => p.status === "executed").length}
                    detail="Votes recorded on-chain"
                />
            </section>

            <section className="ui-surface">
                <div className="ui-section-heading">
                    <h2>Proposals</h2>
                    <p className="ui-note">Displaying {proposals.length} proposals</p>
                </div>

                {loading ? (
                    <Loading label="Loading proposals…" />
                ) : loadError ? (
                    <DataError error={new Error(loadError)} retry={retry} />
                ) : proposals.length === 0 ? (
                    <EmptyState
                        title="No proposals yet"
                        description="Create a proposal to start a vote. Public readers can view proposals; creating and voting require a linked wallet."
                        href="/governance/create"
                        action="Create proposal"
                    />
                ) : (
                    <div className="space-y-0">
                        {proposals.map((proposal) => (
                            <Link
                                key={proposal.id}
                                href={`/governance/${proposal.id}`}
                                className="ui-listing"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center flex-wrap gap-3 mb-2">
                                        <Status tone={statusTone(proposal.status)}>
                                            {proposal.status}
                                        </Status>
                                        <span className="ui-truncate-id" title={proposal.id}>
                                            {proposal.id.split("-")[0]}
                                        </span>
                                    </div>
                                    <h2>{proposal.title}</h2>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        {proposal.description}
                                    </p>
                                    <div className="ui-listing-meta">
                                        <span>Ends {shortDate(proposal.end_time)}</span>
                                        <span>{proposal.total_votes} votes</span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
