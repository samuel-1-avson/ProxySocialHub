"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Cable } from "lucide-react";
import { orderStatusLabel } from "@/lib/order-status";
import {
  PageHeading,
  EmptyState,
  Loading,
  DataError,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";
import { useOrders, useSessions } from "./queries";

export function Connections() {
  const params = useSearchParams();
  const sessionsView = params.get("tab") === "sessions";
  const orders = useOrders();
  const sessions = useSessions();
  const access =
    orders.data?.filter((order) => order.status === "active") ?? [];
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Buyer workspace"
        title="Connections"
        description="Use purchased access and inspect actual session activity."
        actions={
          <Link href="/marketplace" className="ui-button secondary">
            Browse proxies →
          </Link>
        }
      />
      <nav className="ui-tabs" aria-label="Connection views">
        <Link className={!sessionsView ? "active" : ""} href="/app/connections">
          Access
        </Link>
        <Link
          className={sessionsView ? "active" : ""}
          href="/app/connections?tab=sessions"
        >
          Sessions
        </Link>
      </nav>
      <p className="ui-note">
        Credentials, client setup, and observed traffic are separate states. An
        active order does not confirm that your browser is routing through a
        proxy.
      </p>
      {sessionsView ? (
        <>
          {sessions.isLoading && <Loading label="Loading sessions…" />}
          {sessions.isError && (
            <DataError
              error={sessions.error}
              retry={() => void sessions.refetch()}
            />
          )}
          {sessions.isSuccess && !sessions.data.length && (
            <EmptyState
              title="No sessions yet."
              description="Configure a supported client from your purchased access, then inspect the usage reported here."
              href="/app/connections"
              action="View access"
            />
          )}
          {Boolean(sessions.data?.length) && (
            <div
              className="ui-table-wrap"
              role="region"
              aria-label="Proxy sessions"
              tabIndex={0}
            >
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Service state</th>
                    <th>Reported usage</th>
                    <th>Created</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.data?.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <span className="ui-truncate-id" title={session.id}>
                          {session.id.slice(0, 12)}…
                        </span>
                        <p>{session.type}</p>
                      </td>
                      <td>
                        <Status
                          tone={
                            session.status === "active" ? "good" : "neutral"
                          }
                        >
                          {session.status.replace(/_/g, " ")}
                        </Status>
                      </td>
                      <td>{amount(session.bytes_used / 1024 ** 3, 3)} GB</td>
                      <td>{shortDate(session.created_at)}</td>
                      <td>
                        <Link
                          href={`/app/connections/sessions/${encodeURIComponent(session.id)}`}
                          className="ui-button small secondary"
                        >
                          Session details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {orders.isLoading && <Loading label="Loading purchased access…" />}
          {orders.isError && (
            <DataError
              error={orders.error}
              retry={() => void orders.refetch()}
            />
          )}
          {orders.isSuccess && !access.length && (
            <EmptyState
              title="Your access belongs here."
              description="Purchase bandwidth from a listing. Your order and connection instructions stay linked throughout the session."
              href="/marketplace"
              action="Browse proxies"
            />
          )}
          {access.map((order) => (
            <section key={order.id} className="ui-surface">
              <div className="ui-row">
                <div className="ui-row-identity">
                  <span className="ui-region">
                    <Cable size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{order.listing?.title || "Purchased proxy access"}</h3>
                    <p>
                      {amount(order.bandwidth_gb)} GB purchased ·{" "}
                      {shortDate(order.created_at)}
                    </p>
                  </div>
                </div>
                <Status tone="good">{orderStatusLabel(order.status)}</Status>
              </div>
              <div className="ui-actions mt-5">
                <Link
                  className="ui-button"
                  href={`/app/connections/${order.id}`}
                >
                  Connect your app →
                </Link>
                <Link
                  className="ui-button secondary"
                  href={`/app/activity/orders/${order.id}`}
                >
                  View order
                </Link>
              </div>
            </section>
          ))}
        </>
      )}
      <details className="ui-note">
        <summary className="cursor-pointer">Advanced integrations</summary>
        <p className="mt-3">
          Supported intent and SDK tools remain available for integrations that
          use them. They are distinct from a paid marketplace order.
        </p>
        <Link href="/dashboard/proxy" className="ui-link">
          Open integration tools →
        </Link>
      </details>
    </div>
  );
}
