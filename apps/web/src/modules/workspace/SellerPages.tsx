"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
} from "@/components/workspace/Patterns";
function useNodes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["provider-nodes", user?.id],
    queryFn: getMyNodes,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
function useEarnings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["provider-earnings-summary", user?.id],
    queryFn: getProviderEarningsSummary,
    staleTime: 30_000,
  });
}
export function SellerOverview() {
  const { user } = useAuth();
  const nodes = useNodes();
  const earnings = useEarnings();
  const readiness = useQuery({
    queryKey: ["provider-readiness", user?.id],
    queryFn: getProviderReadiness,
    staleTime: 15_000,
  });
  const online = nodes.data?.nodes.filter(
    (node) => node.status === "online",
  ).length;
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Seller workspace"
        title="Seller overview"
        description="Reliable supply, clear readiness, and traceable earnings."
        actions={
          <Link className="ui-button" href="/provider/nodes/new">
            <Plus size={15} />
            Add node
          </Link>
        }
      />
      <section className="ui-hero">
        <div>
          <Status
            tone={readiness.data?.status === "ready" ? "good" : "neutral"}
          >
            {readiness.isLoading
              ? "Checking readiness"
              : readiness.data?.status === "ready"
                ? "Readiness verified"
                : "Review supply readiness"}
          </Status>
          <h2>
            {readiness.data?.summary.ready_for_marketplace
              ? "Your supply is ready for the marketplace."
              : "From a healthy node to available capacity."}
          </h2>
          <p>
            {readiness.data?.next?.message ||
              "Follow the readiness checks for account access, scoped credentials, heartbeat verification, and published offers."}
          </p>
        </div>
        <Link className="ui-button secondary" href="/provider/nodes">
          Review nodes →
        </Link>
      </section>
      <section className="ui-stats">
        <Stat
          label="Nodes online"
          value={
            nodes.isSuccess ? `${online} / ${nodes.data.nodes.length}` : "…"
          }
          detail="Reported node status"
        />
        <Stat
          label="Earned in 30 days"
          value={
            earnings.data
              ? `${amount(earnings.data.last_30_days_sol, 4)} SOL`
              : "…"
          }
          detail="From provider earnings records"
        />
        <Stat
          label="Pending earnings"
          value={
            earnings.data ? `${amount(earnings.data.pending_sol, 4)} SOL` : "…"
          }
          detail="Separate from paid and payable funds"
        />
      </section>
      {readiness.isError && (
        <DataError
          error={readiness.error}
          retry={() => void readiness.refetch()}
        />
      )}
      <div className="ui-columns">
        <section>
          <div className="ui-section-heading">
            <h2>Seller readiness</h2>
          </div>
          {readiness.data?.checks.map((check) => (
            <div key={check.id} className="ui-row">
              <div>
                <h3>{check.label}</h3>
                <p>{check.message}</p>
              </div>
              {check.action_href?.startsWith("/") &&
              !check.action_href.startsWith("//") ? (
                <Link
                  className="ui-button small secondary"
                  href={check.action_href}
                >
                  {check.action_label || "Review"}
                </Link>
              ) : (
                <Status tone={check.status === "complete" ? "good" : "warning"}>
                  {check.status.replace(/_/g, " ")}
                </Status>
              )}
            </div>
          ))}
          {readiness.isLoading && (
            <Loading label="Checking seller readiness…" />
          )}
        </section>
        <section className="ui-attention">
          <Status
            tone={
              nodes.isSuccess && online !== nodes.data.nodes.length
                ? "warning"
                : "neutral"
            }
          >
            Your infrastructure
          </Status>
          <h3>A registered node is not automatically sellable.</h3>
          <p>
            Verify its heartbeat, payout identity, and offer readiness before
            accepting traffic.
          </p>
          <Link className="ui-button ghost" href="/provider/listings">
            Review listings →
          </Link>
        </section>
      </div>
    </div>
  );
}

export { SellerNodes } from "./SellerNodes";
export { SellerListings } from "./SellerListings";
export { SellerEarnings } from "./SellerEarnings";
