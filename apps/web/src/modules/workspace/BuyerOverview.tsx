"use client";
import Link from "next/link";
import { ArrowRight, Cable, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { orderStatusLabel } from "@/lib/order-status";
import {
  PageHeading,
  Stat,
  Status,
  Loading,
  DataError,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";
import { useOrders, useUsage } from "./queries";

export function BuyerOverview() {
  const { user } = useAuth();
  const orders = useOrders();
  const usage = useUsage();
  const active =
    orders.data?.filter((order) => order.status === "active") ?? [];
  const latest = active[0];
  const attention =
    orders.data?.filter((order) =>
      ["pending", "pending_payment", "disputed"].includes(order.status),
    ) ?? [];
  const isNew = orders.isSuccess && orders.data.length === 0;
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Buyer workspace"
        title="Overview"
        description="Your access, usage, and next step."
      />
      {orders.isLoading ? (
        <Loading />
      ) : (
        <section className="ui-hero">
          <div>
            <Status
              tone={latest ? "good" : orders.isError ? "warning" : "neutral"}
            >
              {latest
                ? "Order active"
                : isNew
                  ? "Start with a proxy"
                  : orders.isError
                    ? "Order data unavailable"
                    : "Your workspace"}
            </Status>
            <h2>
              {latest
                ? "Your next connection starts here."
                : isNew
                  ? "Your first connection starts here."
                  : "Everything you need, in one workspace."}
            </h2>
            <p>
              {latest
                ? "Open your purchased access to load credentials, configure a client, and verify its traffic."
                : "Choose a location, review the price, then connect your app with the credentials from your order."}
            </p>
          </div>
          <Link
            className="ui-button"
            href={latest ? `/app/connections/${latest.id}` : "/marketplace"}
          >
            {latest ? "Open connection" : "Browse proxies"}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
      )}
      <section className="ui-stats" aria-label="Account summary">
        <Stat
          label="Active orders"
          value={orders.isSuccess ? active.length : "—"}
          detail="Purchased access with an active order"
        />
        <Stat
          label="Bandwidth used"
          value={
            usage.isSuccess && usage.data.total_gb != null
              ? `${amount(usage.data.total_gb)} GB`
              : "—"
          }
          detail="Reported account usage"
        />
        <Stat
          label="Reported cost"
          value={
            usage.isSuccess && usage.data.total_cost_sol != null
              ? `${amount(usage.data.total_cost_sol, 4)} SOL`
              : "—"
          }
          detail="From the account usage record"
        />
      </section>
      {orders.isError && (
        <DataError error={orders.error} retry={() => void orders.refetch()} />
      )}
      <div className="ui-columns">
        <section>
          <div className="ui-section-heading">
            <h2>Your connections</h2>
            <Link className="ui-button ghost" href="/app/connections">
              View all →
            </Link>
          </div>
          {active.length ? (
            active.slice(0, 3).map((order) => (
              <div className="ui-row" key={order.id}>
                <div className="ui-row-identity">
                  <span className="ui-region">
                    <Cable size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{order.listing?.title || "Purchased proxy access"}</h3>
                    <p>
                      {amount(order.bandwidth_gb)} GB purchased · client routing
                      not verified
                    </p>
                  </div>
                </div>
                <Link
                  className="ui-button small secondary"
                  href={`/app/connections/${order.id}`}
                >
                  Open
                </Link>
              </div>
            ))
          ) : (
            <p className="ui-note">
              {orders.isSuccess
                ? "Purchased access appears here. Browse the marketplace to choose a proxy."
                : "Your connections will appear when order data is available."}
            </p>
          )}
        </section>
        <section className="ui-attention">
          <Status tone={attention.length ? "warning" : "neutral"}>
            {attention.length ? "Needs attention" : "Your next step"}
          </Status>
          <h3>
            {attention.length
              ? `${attention.length} ${attention.length === 1 ? "order needs" : "orders need"} a review.`
              : "Access ready and traffic active are different states."}
          </h3>
          <p>
            {attention.length
              ? "Review payment, provisioning, or dispute status on the original order before attempting another payment."
              : "Credentials let you configure a client. Check actual session usage to verify that requests are routing."}
          </p>
          <Link
            className="ui-button ghost"
            href={
              attention.length
                ? `/app/activity/orders/${attention[0].id}`
                : "/app/connections"
            }
          >
            {attention.length ? "Review order" : "View connections"} →
          </Link>
        </section>
      </div>
      <section>
        <div className="ui-section-heading">
          <h2>Recent activity</h2>
          <Link className="ui-button ghost" href="/app/activity">
            View activity →
          </Link>
        </div>
        {orders.data?.slice(0, 5).map((order) => (
          <div className="ui-row" key={order.id}>
            <div>
              <h3>{order.listing?.title || "Marketplace order"}</h3>
              <p>
                {shortDate(order.created_at)} · {orderStatusLabel(order.status)}
              </p>
            </div>
            <Link
              className="ui-button small ghost"
              href={`/app/activity/orders/${order.id}`}
            >
              View order →
            </Link>
          </div>
        ))}
        {isNew && (
          <p className="ui-note">
            Your first order and measured usage will appear here.
          </p>
        )}
      </section>
      {!user?.wallet_address && (
        <p className="ui-note ui-inline-icon">
          <ShieldCheck size={16} aria-hidden="true" />
          Link a wallet in{" "}
          <Link className="ui-link" href="/app/wallet">
            Wallet settings
          </Link>{" "}
          before funding escrow.
        </p>
      )}
    </div>
  );
}
