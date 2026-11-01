"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Cable,
  Gauge,
  Layers,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { CopyValue } from "@/components/workspace/CopyValue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSession, terminateSession } from "@/lib/api/sessions";
import { getSessionUsage } from "@/lib/api/usage";
import { Modal } from "@/components/patterns/Modal";
import { useOrders } from "./queries";
import {
  PageHeading,
  Loading,
  DataError,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [endOpen, setEndOpen] = useState(false);
  const session = useQuery({
    queryKey: ["buyer-session", user?.id, sessionId],
    queryFn: () => getSession(sessionId),
    refetchInterval: 15_000,
  });
  const usage = useQuery({
    queryKey: ["buyer-session-usage", user?.id, sessionId],
    queryFn: () => getSessionUsage(sessionId),
    enabled: session.isSuccess,
    refetchInterval: 15_000,
    retry: 1,
  });
  const end = useMutation({
    retry: false,
    mutationFn: () => terminateSession(sessionId),
    onSuccess: () => {
      setEndOpen(false);
      void client.invalidateQueries({ queryKey: ["buyer-session"] });
      void client.invalidateQueries({ queryKey: ["workspace-sessions"] });
      void client.invalidateQueries({ queryKey: ["workspace-usage"] });
    },
  });
  const orders = useOrders();
  const order = orders.data?.find((item) => item.session_id === sessionId);
  const row = session.data;
  const bytes =
    usage.data?.bytes_used == null && row?.bytes_used == null
      ? undefined
      : Math.max(usage.data?.bytes_used ?? 0, row?.bytes_used ?? 0);
  const eligible = row?.status === "active";
  return (
    <div className="ui-page">
      <Link
        className="ui-button ghost self-start"
        href="/app/connections?tab=sessions"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Sessions
      </Link>
      <PageHeading
        title="Session details"
        eyebrow="Buyer workspace"
        description="Inspect service state, observed usage, and client access for this session."
      />
      {session.isLoading && <Loading label="Loading this session…" />}
      {session.isError && (
        <DataError error={session.error} retry={() => void session.refetch()} />
      )}
      {row && (
        <>
          <section className="ui-surface ui-page session-record">
            <div className="ui-section-heading">
              <h2>Session record</h2>
              <Status tone={eligible ? "good" : "neutral"}>
                {row.status.replace(/_/g, " ")}
              </Status>
            </div>
            <CopyValue label="session ID" value={row.id} />
            <section className="ui-stats">
              <Stat
                icon={<Gauge size={18} />}
                label="Reported usage"
                value={
                  bytes != null ? `${amount(bytes / 1024 ** 3, 4)} GB` : "None yet"
                }
                detail="Server counters; separate from client connection state"
              />
              <Stat
                icon={<Layers size={18} />}
                label="Bandwidth limit"
                value={
                  row.bytes_limit > 0
                    ? `${amount(row.bytes_limit / 1024 ** 3)} GB`
                    : "Not reported"
                }
                detail="As reported by the session service"
              />
              <Stat
                icon={<Wallet size={18} />}
                label="Reported cost"
                value={
                  usage.data?.cost_sol != null
                    ? `${amount(usage.data.cost_sol, 9)} SOL`
                    : "None yet"
                }
                detail="No estimate substituted when unavailable"
              />
            </section>
            {bytes != null && row.bytes_limit > 0 && (
              <div className="session-usage-meter">
                <div>
                  <span>Bandwidth consumed</span>
                  <strong>{amount((bytes / row.bytes_limit) * 100, 1)}%</strong>
                </div>
                <progress
                  aria-label="Consumed session bandwidth"
                  value={Math.min(bytes, row.bytes_limit)}
                  max={row.bytes_limit}
                />
              </div>
            )}
            <div className="workflow-note">
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                {(bytes ?? 0) > 0
                  ? "Usage has been recorded for this session. This does not prove the current browser is routing through it."
                  : "Client routing is not verified. Configure a client and check whether server usage increases."}
              </p>
            </div>
            <dl className="ui-detail-list">
              <div>
                <dt>Session behavior</dt>
                <dd>{row.type}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{shortDate(row.created_at)}</dd>
              </div>
              <div>
                <dt>Expires</dt>
                <dd>
                  {row.expires_at ? shortDate(row.expires_at) : "Not reported"}
                </dd>
              </div>
            </dl>
            <div className="ui-actions">
              <button
                className="ui-button secondary"
                disabled={session.isFetching || usage.isFetching}
                onClick={() => {
                  void session.refetch();
                  void usage.refetch();
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Refresh observed state
              </button>
              {[
                "active",
                "disabled",
                "activation_pending",
                "activation_failed",
              ].includes(row.status) && (
                <button
                  className="ui-button secondary danger"
                  onClick={() => setEndOpen(true)}
                >
                  End session…
                </button>
              )}
            </div>
          </section>
          {usage.isError && (
            <DataError error={usage.error} retry={() => void usage.refetch()} />
          )}
          <Link
            className="ui-button secondary self-start"
            href={order ? `/app/connections/${order.id}` : "/app/connections"}
          >
            <Cable size={15} aria-hidden="true" />
            Open purchased access & client setup →
          </Link>
          <p className="ui-note">
            Provider-managed rotating sessions follow their configured behavior.
            Session termination does not by itself prove an escrow refund or
            settlement has completed.
          </p>
        </>
      )}
      <Modal
        open={endOpen}
        onOpenChange={(open) => {
          if (!end.isPending) setEndOpen(open);
        }}
        title="End this session?"
        description="Clients using these credentials may stop working."
      >
        <p className="ui-note">
          The server closes the session and applies its settlement rules. Review
          the original order for any payment or refund state.
        </p>
        {end.isError && <DataError error={end.error} />}
        <div className="ui-actions mt-4">
          <button
            className="ui-button secondary"
            disabled={end.isPending}
            onClick={() => setEndOpen(false)}
          >
            Keep session
          </button>
          <button
            className="ui-button"
            disabled={end.isPending}
            onClick={() => end.mutate()}
          >
            End session
          </button>
        </div>
      </Modal>
    </div>
  );
}
