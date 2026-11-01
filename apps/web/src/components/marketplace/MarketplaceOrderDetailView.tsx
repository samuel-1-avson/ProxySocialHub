"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  CreditCard,
  KeyRound,
  Radio,
  ReceiptText,
} from "lucide-react";
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
import { OrderRecovery } from "@/modules/workspace/OrderRecovery";
import { CopyValue } from "@/components/workspace/CopyValue";
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
        description="One durable record for payment, access, and settlement."
      />
      {query.isLoading && <Loading label="Loading order…" />}
      {query.isError && (
        <DataError error={query.error} retry={() => void query.refetch()} />
      )}
      {order && (
        <>
          <section className="order-state-panel">
            <div className="ui-section-heading">
              <div>
                <p className="ui-eyebrow">Purchase lifecycle</p>
                <h2>Payment, access, and traffic</h2>
              </div>
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
            <ol className="order-journey" aria-label="Order progress">
              <li className="complete">
                <span>
                  <ReceiptText size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Order recorded</strong>
                  <p>{shortDate(order.created_at)}</p>
                </div>
                <CheckCircle2 size={15} aria-hidden="true" />
              </li>
              <li className={eligible ? "complete" : ""}>
                <span>
                  <CreditCard size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Payment & access</strong>
                  <p>
                    {eligible
                      ? "Escrow confirmed by order state"
                      : orderStatusLabel(order.status)}
                  </p>
                </div>
                {eligible ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <Circle size={15} aria-hidden="true" />
                )}
              </li>
              <li className={credentials.data ? "complete" : ""}>
                <span>
                  <KeyRound size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Credentials</strong>
                  <p>
                    {credentials.data
                      ? "Available for client setup"
                      : "Available after provisioning"}
                  </p>
                </div>
                {credentials.data ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <Circle size={15} aria-hidden="true" />
                )}
              </li>
              <li>
                <span>
                  <Radio size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>Traffic</strong>
                  <p>Inspect session usage after setup</p>
                </div>
                <Circle size={15} aria-hidden="true" />
              </li>
            </ol>
          </section>
          <div className="detail-columns order-detail-columns">
            <div className="detail-main">
              {eligible && credentials.isLoading && (
                <Loading label="Preparing connection instructions…" />
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
                  <MarketplaceOrderCredentials
                    credentials={credentials.data}
                    orderId={order.id}
                  />
                </>
              )}
              {!eligible && (
                <section className="ui-attention">
                  <h3>Access follows the order state.</h3>
                  <p>
                    Credentials appear after payment is confirmed and
                    provisioning completes. Keep the same order reference while
                    checking a pending transaction.
                  </p>
                  <button
                    className="ui-button secondary small"
                    onClick={() => void query.refetch()}
                  >
                    Refresh order status
                  </button>
                </section>
              )}
              {["pending", "pending_payment"].includes(order.status) && (
                <OrderRecovery order={order} />
              )}
            </div>
            <aside
              className="order-receipt ui-surface"
              aria-label="Order receipt"
            >
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
              <CopyValue label="order reference" value={order.id} />
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
                <span>Escrow state</span>
                <span>{order.escrow_status || "See payment record"}</span>
              </div>
              <p className="ui-note mt-5">
                {credentials.data
                  ? "Credentials are available. This does not verify client routing or current traffic."
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
            </aside>
          </div>
          <div className="ui-actions">
            <Link
              className="ui-button secondary"
              href="/app/connections?tab=sessions"
            >
              Inspect sessions <ArrowRight size={14} aria-hidden="true" />
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
