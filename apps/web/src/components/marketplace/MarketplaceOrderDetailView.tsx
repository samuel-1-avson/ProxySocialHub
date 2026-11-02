"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getOrder,
  getOrderProxyCredentials,
  marketplaceKeys,
  orderCredentialsEligible,
  orderStatusDescription,
  orderStatusLabel,
  type MarketplaceProxyCredentials,
} from "@/lib/api/marketplace";
import { explorerHref } from "@/lib/navigation/workspace";
import { MarketplaceOrderCredentials } from "@/components/marketplace/MarketplaceOrderCredentials";
import { ExtensionConnectCard } from "@/components/marketplace/ExtensionConnectCard";
import { AuditLauncher } from "@/modules/audits/AuditLauncher";
import { OrderRecovery } from '@/modules/workspace/OrderRecovery';
import {
  PageHeading,
  Status,
  Loading,
  DataError,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";

export function MarketplaceOrderDetailView({
  orderId,
  backHref,
  backLabel,
}: {
  orderId: string;
  backHref: string;
  backLabel: string;
}) {
  const { isAuthenticated, user } = useAuth();
  const query = useQuery({
    queryKey: [...marketplaceKeys.order(orderId), user?.id],
    queryFn: () => getOrder(orderId),
    enabled: isAuthenticated && Boolean(orderId),
    refetchInterval: (current) =>
      ["pending", "pending_payment", "active"].includes(
        current.state.data?.status || "",
      )
        ? 15_000
        : false,
  });
  const order = query.data;
  const eligible = orderCredentialsEligible(order?.status ?? "");
  const credentials = useQuery({
    queryKey: [...marketplaceKeys.orderCredentials(orderId), user?.id],
    queryFn: async () => {
      const response = await getOrderProxyCredentials(orderId);
      const creds = response.proxy_credentials;
      if (!creds?.username || !creds?.password)
        throw new Error(
          "Payment may be confirmed while access is still preparing. Keep this order and refresh its status; do not pay again.",
        );
      return {
        ...creds,
        expires_at: response.expires_at ?? creds.expires_at,
        session_capability:
          response.session_capability ?? creds.session_capability,
        session_capability_note:
          response.session_capability_note ?? creds.session_capability_note,
      } as MarketplaceProxyCredentials;
    },
    enabled: isAuthenticated && Boolean(orderId) && eligible,
    retry: 2,
    refetchInterval: (current) =>
      current.state.error && !current.state.data ? 5000 : false,
  });
  if (!isAuthenticated)
    return (
      <div className="ui-empty">
        <h2>Sign in to view this order.</h2>
        <Link
          href={`/login?next=${encodeURIComponent(`/app/activity/orders/${orderId}`)}`}
          className="ui-button mt-4"
        >
          Sign in
        </Link>
      </div>
    );
  return (
    <div className="ui-page">
      <Link href={backHref} className="ui-button ghost self-start">
        <ArrowLeft size={15} />
        {backLabel}
      </Link>
      <PageHeading
        eyebrow="Purchase & connection"
        title={order?.listing?.title || "Marketplace order"}
        description="Your payment, and how to use this proxy."
      />
      {query.isLoading && <Loading label="Loading order…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {order && (
        <>
          <section className="ui-surface">
            <div className="ui-section-heading">
              <h2>Order receipt</h2>
              <Status
                tone={
                  order.status === "active"
                    ? "good"
                    : ["pending", "pending_payment", "disputed"].includes(
                          order.status,
                        )
                      ? "warning"
                      : "neutral"
                }
              >
                {orderStatusLabel(order.status)}
              </Status>
            </div>
            <p className="ui-note break-all">{order.id}</p>
            <div className="ui-row">
              <span>Purchased bandwidth</span>
              <strong>{amount(order.bandwidth_gb)} GB</strong>
            </div>
            <div className="ui-row">
              <span>Price reference</span>
              <span>
                {order.total_price != null || order.price_total != null
                  ? `$${amount(order.total_price ?? order.price_total, 4)}`
                  : "Unavailable"}
              </span>
            </div>
            <div className="ui-row">
              <span>Created</span>
              <span>{shortDate(order.created_at)}</span>
            </div>
            <div className="ui-row">
              <span>Payment status</span>
              <span>{order.escrow_status || "See payment record"}</span>
            </div>
            <p className="ui-note mt-5">
              {credentials.data
                ? "Paid and ready to use."
                : orderStatusDescription(order.status)}
            </p>
            {(order.tx_signature || order.tx_hash) && (
              <a
                className="ui-button ghost mt-3"
                href={explorerHref(
                  `/transactions/${encodeURIComponent(order.tx_signature || order.tx_hash || "")}`,
                )}
              >
                View public transaction
                <ArrowUpRight size={14} />
              </a>
            )}
          </section>
          {eligible && credentials.isLoading && (
            <Loading label="Getting your proxy ready…" />
          )}
          {eligible && credentials.isError && (
            <DataError
              error={credentials.error}
              retry={() => void credentials.refetch()}
            />
          )}
          {eligible && credentials.data && (
            <>
              {order.status === "active" && (
                <ExtensionConnectCard
                  orderId={order.id}
                  listingTitle={order.listing?.title}
                />
              )}
              <MarketplaceOrderCredentials credentials={credentials.data} />
              {order.status === "active" && (
                <AuditLauncher orderId={order.id} />
              )}
            </>
          )}
          {!eligible && (
            <section className="ui-attention">
              <h3>Your proxy is not ready yet</h3>
              <p>
                Your proxy details appear here once your payment is confirmed.
                If you just paid, give it a minute and refresh. Do not pay again.
              </p>
              <button
                className="ui-button secondary small"
                onClick={() => void query.refetch()}
              >
                Refresh order status
              </button>
            </section>
          )}
          {['pending','pending_payment'].includes(order.status) && <OrderRecovery order={order} />}
          <div className="ui-actions">
            <Link
              className="ui-button secondary"
              href="/app/connections?tab=sessions"
            >
              Inspect sessions
            </Link>
            <Link className="ui-button ghost" href="/help">
              Order support →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
