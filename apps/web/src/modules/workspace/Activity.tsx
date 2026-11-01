"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Cable, Clock3, Gauge, ShoppingBag, Wallet } from "lucide-react";
import { UsageChart } from "@/components/workspace/UsageChart";
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
        actions={
          <Link className="ui-button secondary" href="/marketplace">
            <ShoppingBag size={16} aria-hidden="true" />
            Browse proxies
          </Link>
        }
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
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "orders" && (
        <>
          <section className="ui-stats" aria-label="Order summary">
            <Stat
              icon={<ShoppingBag size={18} />}
              label="Orders shown"
              value={orders.isSuccess ? orders.data.length : "—"}
              detail="Orders in your account history"
            />
            <Stat
              icon={<Cable size={18} />}
              label="Active access"
              value={
                orders.isSuccess
                  ? orders.data.filter((order) => order.status === "active")
                      .length
                  : "—"
              }
              detail="Purchased orders with active access"
            />
            <Stat
              icon={<Clock3 size={18} />}
              label="Needs review"
              value={
                orders.isSuccess
                  ? orders.data.filter((order) =>
                      ["pending", "pending_payment", "disputed"].includes(
                        order.status,
                      ),
                    ).length
                  : "—"
              }
              detail="Payment, provisioning, or dispute status"
            />
          </section>
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
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
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
              icon={<Gauge size={18} />}
              label="Bandwidth used"
              value={
                usage.data?.total_gb != null
                  ? `${amount(usage.data.total_gb)} GB`
                  : "—"
              }
              detail="Reported account usage"
            />
            <Stat
              icon={<Wallet size={18} />}
              label="Reported cost"
              value={
                usage.data?.total_cost_sol != null
                  ? `${amount(usage.data.total_cost_sol, 4)} SOL`
                  : "—"
              }
              detail="Account usage record"
            />
            <Stat
              icon={<Cable size={18} />}
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
          {daily.isSuccess && <UsageChart points={daily.data.data ?? []} />}
          <Link href="/dashboard/trustless" className="ui-button ghost">
            Inspect oracle-attested usage records →
          </Link>
        </>
      )}
      {tab === "billing" && <BuyerBilling />}
    </div>
  );
}
