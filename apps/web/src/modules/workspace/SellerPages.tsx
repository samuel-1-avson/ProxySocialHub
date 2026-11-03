"use client";
import { isNodeOnline, nodeStatusLabel, useNodeClock } from "@/lib/node-status";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CircleAlert,
  Coins,
  ListChecks,
  Plus,
  Server,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getMyNodes,
  getProviderReadiness,
  getProviderEarningsSummary,
} from "@/lib/api/provider";
import {
  PageHeading,
  Stat,
  Status,
  Loading,
  DataError,
  amount,
  countryName,
} from "@/components/workspace/Patterns";

export function SellerOverview() {
  const { user } = useAuth();
  const now = useNodeClock();
  const nodes = useQuery({
    queryKey: ["provider-nodes", user?.id],
    queryFn: getMyNodes,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const earnings = useQuery({
    queryKey: ["provider-earnings-summary", user?.id],
    queryFn: getProviderEarningsSummary,
    staleTime: 30_000,
  });
  const readiness = useQuery({
    queryKey: ["provider-readiness", user?.id],
    queryFn: getProviderReadiness,
    staleTime: 15_000,
  });
  const online =
    nodes.data?.nodes.filter((node) => isNodeOnline(node, now)).length ?? 0;
  const checks = readiness.data?.checks ?? [];
  const complete = checks.filter((check) => check.status === "complete").length;
  const ready = readiness.data?.summary.ready_for_marketplace === true;
  return (
    <div className="ui-page provider-overview">
      <PageHeading
        eyebrow="Provider workspace"
        title="Provider overview"
        description="Keep supply healthy, publish capacity, and follow your earnings."
        actions={
          <Link className="ui-button" href="/provider/nodes/new">
            <Plus size={16} aria-hidden="true" />
            Add node
          </Link>
        }
      />
      <section className="workspace-welcome provider-welcome">
        <div className="workspace-welcome-copy">
          <Status
            tone={readiness.isError ? "warning" : ready ? "good" : "neutral"}
          >
            {readiness.isLoading
              ? "Checking readiness"
              : readiness.isError
                ? "Readiness unavailable"
                : ready
                  ? "Marketplace ready"
                  : "Build your supply"}
          </Status>
          <h2>
            {ready
              ? "Your capacity is ready to meet demand."
              : "A healthy node is where it starts."}
          </h2>
          <p>
            {readiness.data?.next?.message ||
              "Register a node, verify its heartbeat, and publish your capacity. Your readiness checklist keeps each step in view."}
          </p>
          <Link
            className="ui-button"
            href={ready ? "/provider/listings" : "/provider/nodes"}
          >
            {ready ? "Manage listings" : "Review nodes"}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="provider-readiness-meter">
          <span className="ui-eyebrow">Supply readiness</span>
          <div>
            <strong>
              {readiness.isSuccess && checks.length ? complete : "…"}
            </strong>
            <span>
              {checks.length
                ? "/ " + checks.length + " checks complete"
                : "Checks reported by your account"}
            </span>
          </div>
          {checks.length > 0 && (
            <progress
              max={checks.length}
              value={complete}
              aria-label="Completed provider readiness checks"
            />
          )}
          <p>
            {ready
              ? "Your account reports that supply is ready for the marketplace."
              : "Complete the checks below before accepting marketplace traffic."}
          </p>
          <Link href="#provider-readiness">
            View checklist
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <section className="ui-stats" aria-label="Provider summary">
        <Stat
          icon={<Server size={18} />}
          label="Nodes online"
          value={
            nodes.isSuccess ? online + " / " + nodes.data.nodes.length : "…"
          }
          detail="Reported node status"
        />
        <Stat
          icon={<Coins size={18} />}
          label="Earned in 30 days"
          value={
            earnings.data
              ? amount(earnings.data.last_30_days_sol, 4) + " SOL"
              : "…"
          }
          detail="Recorded provider earnings"
        />
        <Stat
          icon={<ListChecks size={18} />}
          label="Active listings"
          value={amount(readiness.data?.summary.active_listings, 0)}
          detail="Published offers reported by readiness"
        />
      </section>
      {earnings.isError && (
        <DataError
          title="Earnings data is unavailable"
          error={earnings.error}
          retry={() => void earnings.refetch()}
        />
      )}
      <div className="workflow-columns">
        <section className="ui-surface readiness-panel" id="provider-readiness">
          <div className="ui-section-heading">
            <div>
              <p className="ui-eyebrow">Before you accept traffic</p>
              <h2>Provider readiness</h2>
            </div>
            {checks.length > 0 && (
              <span className="ui-tag">
                {complete} of {checks.length} complete
              </span>
            )}
          </div>
          {readiness.isLoading && (
            <Loading label="Checking provider readiness…" />
          )}
          {readiness.isError && (
            <DataError
              title="Readiness checks could not be loaded"
              error={readiness.error}
              retry={() => void readiness.refetch()}
            />
          )}
          <ol className="readiness-checklist">
            {checks.map((check) => {
              const CheckIcon =
                check.status === "complete"
                  ? CheckCircle2
                  : check.status === "action_required"
                    ? CircleAlert
                    : Circle;
              return (
                <li key={check.id}>
                  <span
                    className={
                      "readiness-check-icon " +
                      (check.status === "complete" ? "complete" : "attention")
                    }
                  >
                    <CheckIcon size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{check.label}</h3>
                    <p>{check.message}</p>
                    <span className="readiness-check-status">
                      {check.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {check.action_href?.startsWith("/") &&
                    !check.action_href.startsWith("//") && (
                      <Link
                        className="ui-button small secondary"
                        href={check.action_href}
                      >
                        {check.action_label || "Review"}
                      </Link>
                    )}
                </li>
              );
            })}
          </ol>
          {readiness.isSuccess && checks.length === 0 && (
            <p className="ui-note">
              No individual readiness checks were returned. Open your nodes to
              review their latest status.
            </p>
          )}
        </section>
        <section className="workflow-next-step">
          <span className="workflow-step-index">EARNINGS / RECORDED</span>
          <Coins size={25} className="text-primary" aria-hidden="true" />
          <h2>Follow the value of your supply.</h2>
          <div className="workflow-feature-value">
            {earnings.data ? amount(earnings.data.pending_sol, 4) : "…"}{" "}
            <span>SOL pending</span>
          </div>
          <p>
            Pending, payable, and paid funds have different states. Review
            eligibility and settlement records before requesting a payout.
          </p>
          <Link className="ui-button secondary" href="/provider/earnings">
            Review earnings
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
      </div>
      <section className="ui-surface">
        <div className="ui-section-heading">
          <div>
            <p className="ui-eyebrow">Your infrastructure</p>
            <h2>Node fleet</h2>
          </div>
          <Link className="ui-button ghost small" href="/provider/nodes">
            View nodes
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {nodes.isLoading && <Loading label="Loading your nodes…" />}
        {nodes.isError && (
          <DataError error={nodes.error} retry={() => void nodes.refetch()} />
        )}
        {nodes.data?.nodes.slice(0, 4).map((node) => (
          <div className="ui-row" key={node.id}>
            <div className="ui-row-identity">
              <span className="ui-region">
                <Server size={18} aria-hidden="true" />
              </span>
              <div>
                <h3>{node.name}</h3>
                <p>
                  {countryName(node.country)}
                  {node.city ? " · " + node.city : ""}
                </p>
              </div>
            </div>
            <div className="ui-actions">
              <Status tone={isNodeOnline(node, now) ? "good" : "neutral"}>
                {nodeStatusLabel(node, now)}
              </Status>
              <Link
                className="ui-button secondary small"
                href={"/provider/nodes/" + node.id}
              >
                Manage
              </Link>
            </div>
          </div>
        ))}
        {nodes.isSuccess && nodes.data.nodes.length === 0 && (
          <div className="workflow-inline-empty">
            <Server size={28} aria-hidden="true" />
            <h3>Your first node belongs here.</h3>
            <p>
              Register a machine, create its credentials, then verify its first
              heartbeat.
            </p>
            <Link className="ui-link" href="/provider/nodes/new">
              Set up a node →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

export { SellerNodes } from "./SellerNodes";
export { SellerListings } from "./SellerListings";
export { SellerEarnings } from "./SellerEarnings";
