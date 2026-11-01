"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import { getProposals } from "@/lib/services/governance";
import { GovernanceExecutionBanner } from "@/components/governance/GovernanceExecutionBanner";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
  Stat,
  Status,
} from "@/components/workspace/Patterns";

export default function GovernancePage() {
  const query = useQuery({
    queryKey: ["governance", "proposals"],
    queryFn: () => getProposals(),
  });
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const proposals = query.data;
  const filtered = useMemo(
    () =>
      (proposals ?? []).filter(
        (proposal) =>
          (!status || proposal.status === status) &&
          (proposal.title + " " + proposal.description)
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
      ),
    [proposals, search, status],
  );
  return (
    <div className="ui-page governance-page">
      <PageHeading
        eyebrow="Community / Protocol decisions"
        title="Governance"
        description="Read proposals, review their impact, and participate in decisions about the network."
        actions={
          <Link href="/governance/create" className="ui-button">
            <Plus size={16} aria-hidden="true" />
            Create proposal
          </Link>
        }
      />
      <GovernanceExecutionBanner />
      <div className="ui-stats">
        <Stat
          label="Published proposals"
          value={proposals?.length ?? "—"}
          detail="Proposals returned by the governance service"
          icon={<FileText size={18} />}
        />
        <Stat
          label="Active proposals"
          value={
            proposals?.filter((proposal) => proposal.status === "active")
              .length ?? "—"
          }
          detail="Check each proposal’s voting deadline"
          icon={<Clock3 size={18} />}
        />
        <Stat
          label="Executed proposals"
          value={
            proposals?.filter((proposal) => proposal.status === "executed")
              .length ?? "—"
          }
          detail="Reported execution status"
          icon={<CheckCircle2 size={18} />}
        />
      </div>
      <section aria-labelledby="proposal-list-title">
        <div className="ui-section-heading">
          <div>
            <p className="ui-eyebrow">Decision record</p>
            <h2 id="proposal-list-title">Network proposals</h2>
          </div>
          <span className="ui-subtle" role="status">
            {query.isSuccess ? filtered.length + " proposals" : ""}
          </span>
        </div>
        <div className="proposal-toolbar">
          <label className="proposal-search">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search proposals</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search proposals…"
            />
          </label>
          <label className="proposal-status">
            <span>Status</span>
            <select
              aria-label="Proposal status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {["active", "passed", "rejected", "executed", "failed"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
        {query.isPending ? (
          <Loading label="Loading network proposals…" />
        ) : query.isError ? (
          <DataError
            title="Proposals could not be loaded"
            error={query.error}
            retry={() => void query.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={
              proposals?.length ? "No matching proposals" : "No proposals yet"
            }
            description={
              proposals?.length
                ? "Try another search or status to find a proposal."
                : "Create a proposal to open a discussion about the network."
            }
            href={proposals?.length ? undefined : "/governance/create"}
            action="Create proposal"
            icon={<FileText size={28} />}
          />
        ) : (
          <div className="proposal-list">
            {filtered.map((proposal) => {
              const deadline = proposal.end_time
                ? new Date(proposal.end_time)
                : null;
              return (
                <Link
                  href={"/governance/" + proposal.id}
                  key={proposal.id}
                  className="proposal-card ui-surface"
                >
                  <div className="proposal-card-main">
                    <div className="proposal-card-meta">
                      <Status
                        tone={
                          proposal.status === "executed" ||
                          proposal.status === "passed"
                            ? "good"
                            : proposal.status === "rejected" ||
                                proposal.status === "failed"
                              ? "error"
                              : "neutral"
                        }
                      >
                        {proposal.status}
                      </Status>
                      <span>{proposal.type.replace(/_/g, " ")}</span>
                    </div>
                    <h3>{proposal.title}</h3>
                    <p>{proposal.description}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Voting deadline</dt>
                      <dd>
                        {deadline && Number.isFinite(deadline.getTime())
                          ? deadline.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "Not reported"}
                      </dd>
                    </div>
                    <div>
                      <dt>Voting power cast</dt>
                      <dd>{proposal.total_votes.toLocaleString()} VP</dd>
                    </div>
                  </dl>
                  <ArrowUpRight
                    size={20}
                    className="proposal-card-arrow"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
