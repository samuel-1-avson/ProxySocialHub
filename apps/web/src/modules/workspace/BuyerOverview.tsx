"use client";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Cable,
  Gauge,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { orderStatusLabel } from "@/lib/order-status";
import {
  PageHeading,
  Stat,
  Status,
  Loading,
  DataError,
  EmptyState,
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
    <div className="ui-page buyer-overview">
      <PageHeading
        eyebrow="Buyer workspace"
        title="Overview"
        description="Your access, usage, and next step."
        actions={
          <Link className="ui-button secondary" href="/app/wallet">
            <Wallet size={16} aria-hidden="true" />
            Manage wallet
          </Link>
        }
      />
      {orders.isLoading ? (
        <Loading />
      ) : (
        <section className="workspace-welcome">
          <div className="workspace-welcome-copy">
            <Status
              tone={latest ? "good" : orders.isError ? "warning" : "neutral"}
            >
              {latest
                ? "Purchased access ready"
                : orders.isError
                  ? "Order data unavailable"
                  : "Your next connection"}
            </Status>
            <h2>
              {latest
                ? "Put your capacity to work."
                : isNew
                  ? "Your first connection starts here."
                  : "Find your next connection."}
            </h2>
            <p>
              {latest
                ? "Your purchased access is ready to open. Configure your client, then check reported traffic to confirm the connection."
                : "Choose a location, compare the terms, and connect your app with credentials linked to your order."}
            </p>
            <Link
              className="ui-button"
              href={latest ? "/app/connections/" + latest.id : "/marketplace"}
            >
              {latest ? "Open connection" : "Browse proxies"}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <ol className="workspace-route" aria-label="Your connection workflow">
            {[
              {
                icon: ShoppingBag,
                title: "Choose capacity",
                detail: "Location, price & terms",
              },
              {
                icon: Cable,
                title: "Connect your app",
                detail: "Order-linked credentials",
              },
              {
                icon: Activity,
                title: "Inspect usage",
                detail: "Reported session activity",
              },
            ].map(({ icon: Icon, title, detail }, index) => (
              <li key={title}>
                <span className="workspace-route-icon">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <div>
                  <small>0{index + 1}</small>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="ui-stats" aria-label="Account summary">
        <Stat
          icon={<Cable size={18} />}
          label="Active orders"
          value={orders.isSuccess ? active.length : "…"}
          detail="Purchased access with an active order"
        />
        <Stat
          icon={<Gauge size={18} />}
          label="Bandwidth used"
          value={
            usage.isSuccess && usage.data.total_gb != null
              ? amount(usage.data.total_gb) + " GB"
              : "None yet"
          }
          detail="Reported account usage"
        />
        <Stat
          icon={<Wallet size={18} />}
          label="Reported cost"
          value={
            usage.isSuccess && usage.data.total_cost_sol != null
              ? amount(usage.data.total_cost_sol, 4) + " SOL"
              : "None yet"
          }
          detail="From the account usage record"
        />
      </section>
      {orders.isError && (
        <DataError
          title="Your orders could not be loaded"
          error={orders.error}
          retry={() => void orders.refetch()}
        />
      )}
      {usage.isError && (
        <DataError
          title="Usage data is unavailable"
          error={usage.error}
          retry={() => void usage.refetch()}
        />
      )}
      <div className="workflow-columns">
        <section className="ui-surface">
          <div className="ui-section-heading">
            <div>
              <p className="ui-eyebrow">Purchased access</p>
              <h2>Your connections</h2>
            </div>
            <Link className="ui-button ghost small" href="/app/connections">
              View all
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {active.length ? (
            active.slice(0, 3).map((order) => (
              <div className="ui-row" key={order.id}>
                <div className="ui-row-identity">
                  <span className="ui-region">
                    <Cable size={18} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{order.listing?.title || "Purchased proxy access"}</h3>
                    <p>
                      {amount(order.bandwidth_gb)} GB purchased · routing not
                      verified
                    </p>
                  </div>
                </div>
                <Link
                  className="ui-button small secondary"
                  href={"/app/connections/" + order.id}
                >
                  Open
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </div>
            ))
          ) : (
            <div className="workflow-inline-empty">
              <Cable size={28} aria-hidden="true" />
              <h3>No active access yet</h3>
              <p>
                {orders.isSuccess
                  ? "Choose an offer to get order-linked connection instructions."
                  : "Connections appear once your order data is available."}
              </p>
              {orders.isSuccess && (
                <Link className="ui-link" href="/marketplace">
                  Find capacity →
                </Link>
              )}
            </div>
          )}
        </section>
        <section className="workflow-next-step">
          <span className="workflow-step-index">NEXT / ACTION</span>
          <Status tone={attention.length ? "warning" : "neutral"}>
            {attention.length ? "Needs attention" : "Good to know"}
          </Status>
          <h2>
            {attention.length
              ? attention.length +
                (attention.length === 1
                  ? " order needs a review."
                  : " orders need a review.")
              : "Confirm traffic after setup."}
          </h2>
          <p>
            {attention.length
              ? "Review payment, provisioning, or dispute status on the original order before attempting another payment."
              : "Credentials let you configure a client. Check session usage to verify that requests are routing."}
          </p>
          <Link
            className="ui-button secondary"
            href={
              attention.length
                ? "/app/activity/orders/" + attention[0].id
                : "/app/connections?tab=sessions"
            }
          >
            {attention.length ? "Review order" : "Inspect sessions"}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
      </div>
      <section className="ui-surface">
        <div className="ui-section-heading">
          <div>
            <p className="ui-eyebrow">Order history</p>
            <h2>Recent activity</h2>
          </div>
          <Link className="ui-button ghost small" href="/app/activity">
            View activity
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {orders.data?.slice(0, 5).map((order) => (
          <div className="ui-row" key={order.id}>
            <div className="ui-row-identity">
              <span className="workflow-order-icon">
                <ShoppingBag size={16} aria-hidden="true" />
              </span>
              <div>
                <h3>{order.listing?.title || "Marketplace order"}</h3>
                <p>
                  {shortDate(order.created_at)} ·{" "}
                  {orderStatusLabel(order.status)}
                </p>
              </div>
            </div>
            <Link
              className="ui-button small ghost"
              href={"/app/activity/orders/" + order.id}
            >
              View order
              <ArrowRight size={13} aria-hidden="true" />
            </Link>
          </div>
        ))}
        {isNew && (
          <EmptyState
            title="A fresh start."
            description="Your first order and reported usage will appear here."
            icon={<Activity size={24} />}
          />
        )}
        {orders.isError && (
          <p className="ui-note">
            Recent activity will appear when your order data is available.
          </p>
        )}
      </section>
      {!user?.wallet_address && (
        <div className="workflow-note">
          <Wallet size={18} aria-hidden="true" />
          <p>
            Before funding an order,{" "}
            <Link className="ui-link" href="/app/wallet">
              link your wallet
            </Link>{" "}
            in account settings.
          </p>
        </div>
      )}
    </div>
  );
}
