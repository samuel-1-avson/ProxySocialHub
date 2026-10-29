"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getDailyUsage } from "@/lib/api/analytics";
import { BuyerBilling } from "./BuyerBilling";
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

export function Activity() {
  const params = useSearchParams();
  const tab = ["usage", "billing"].includes(params.get("tab") || "")
    ? params.get("tab")!
    : "orders";
  const orders = useOrders();
  const usage = useUsage();
  const { user } = useAuth();
  const daily = useQuery({
    queryKey: ["daily-usage", 7, user?.id],
    queryFn: () => getDailyUsage(7),
    enabled: tab === "usage",
  });
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Buyer workspace"
        title="Activity"
        description="One place for orders, measured usage, and cost."
      />
      <nav className="ui-tabs" aria-label="Activity views">
        {[
          ["orders", "Orders"],
          ["usage", "Usage"],
          ["billing", "Billing"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={
              key === "orders" ? "/app/activity" : `/app/activity?tab=${key}`
            }
            className={tab === key ? "active" : ""}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "orders" && (
        <>
          {orders.isLoading && <Loading label="Loading orders…" />}
          {orders.isError && (
            <DataError
              error={orders.error}
              retry={() => void orders.refetch()}
            />
          )}
          {orders.isSuccess && !orders.data.length && (
            <EmptyState
              title="Your first order starts in the marketplace."
              description="Return here for payment status, connection instructions, and settlement history."
              href="/marketplace"
              action="Browse proxies"
            />
          )}
          {Boolean(orders.data?.length) && (
            <div
              className="ui-table-wrap"
              role="region"
              aria-label="Marketplace orders"
              tabIndex={0}
            >
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Order state</th>
                    <th>Purchased</th>
                    <th>Price reference</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data?.map((order) => (
                    <tr key={order.id}>
                      <td>
                        {order.listing?.title || "Marketplace order"}
                        <p>
                          {order.id.slice(0, 12)} ·{" "}
                          {shortDate(order.created_at)}
                        </p>
                      </td>
                      <td>
                        <Status
                          tone={
                            order.status === "active"
                              ? "good"
                              : [
                                    "pending_payment",
                                    "pending",
                                    "disputed",
                                  ].includes(order.status)
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {orderStatusLabel(order.status)}
                        </Status>
                      </td>
                      <td>{amount(order.bandwidth_gb)} GB</td>
                      <td>
                        {order.total_price != null || order.price_total != null
                          ? `$${amount(order.total_price ?? order.price_total, 4)}`
                          : "—"}
                      </td>
                      <td>
                        <Link
                          href={`/app/activity/orders/${order.id}`}
                          className="ui-button small secondary"
                        >
                          View order →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {tab === "usage" && (
        <>
          <section className="ui-stats">
            <Stat
              label="Bandwidth used"
              value={
                usage.data?.total_gb != null
                  ? `${amount(usage.data.total_gb)} GB`
                  : "—"
              }
              detail="Reported account usage"
            />
            <Stat
              label="Reported cost"
              value={
                usage.data?.total_cost_sol != null
                  ? `${amount(usage.data.total_cost_sol, 4)} SOL`
                  : "—"
              }
              detail="Account usage record"
            />
            <Stat
              label="Total sessions"
              value={amount(usage.data?.total_sessions, 0)}
              detail="Reported sessions, not active clients"
            />
          </section>
          {usage.isError && (
            <DataError error={usage.error} retry={() => void usage.refetch()} />
          )}
          {daily.isLoading && <Loading label="Loading daily usage…" />}
          {daily.isError && (
            <DataError error={daily.error} retry={() => void daily.refetch()} />
          )}
          {daily.isSuccess && (
            <section className="ui-surface">
              <h2>Bandwidth over the last seven days</h2>
              <div
                className="ui-table-wrap mt-5"
                role="region"
                aria-label="Daily bandwidth usage"
                tabIndex={0}
              >
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Reported usage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.data.data?.map((point) => (
                      <tr key={point.date}>
                        <td>{shortDate(point.date)}</td>
                        <td>
                          {point.gb_used != null
                            ? amount(point.gb_used, 3)
                            : point.bytes_used != null
                              ? amount(point.bytes_used / 1024 ** 3, 3)
                              : "—"}{" "}
                          GB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!daily.data.data?.length && (
                <p className="ui-note mt-4">
                  No daily measurements were returned for this period.
                </p>
              )}
            </section>
          )}
          <Link href="/dashboard/trustless" className="ui-button ghost">
            Inspect oracle-attested usage records →
          </Link>
          <Link href="/dashboard/analytics" className="ui-button secondary">Detailed traffic analytics →</Link>
        </>
      )}
      {tab === "billing" && <BuyerBilling />}
    </div>
  );
}
