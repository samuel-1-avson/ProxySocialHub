"use client";
import { DataError } from "@/components/workspace/Patterns";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Wifi,
  Server,
  Clock,
  BarChart3,
  Cpu,
  MapPin,
} from "lucide-react";
import { getMyNodes, getNodeUptime } from "@/lib/api/provider";

type CheckStatus = "pass" | "warn" | "fail" | "loading";

interface HealthCheck {
  id: string;
  label: string;
  description: string;
  status: CheckStatus;
  detail?: string;
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "loading")
    return <Loader2 size={16} className="animate-spin text-muted-foreground" />;
  if (status === "pass")
    return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (status === "warn")
    return <AlertCircle size={16} className="text-amber-400" />;
  return <XCircle size={16} className="text-red-400" />;
}

function statusColor(status: CheckStatus) {
  if (status === "pass") return "text-emerald-400";
  if (status === "warn") return "text-amber-400";
  if (status === "fail") return "text-red-400";
  return "text-muted-foreground";
}

function statusBg(status: CheckStatus) {
  if (status === "pass") return "bg-emerald-500/10 border-emerald-500/20";
  if (status === "warn") return "bg-amber-500/10 border-amber-500/20";
  if (status === "fail") return "bg-red-500/10 border-red-500/20";
  return "bg-white/5 border-border";
}

export default function HealthPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const {
    data: nodesData,
    isLoading: nodesLoading,
    error: sourceError,
    refetch: retrySource,
  } = useQuery({
    queryKey: ["my-nodes", refreshKey],
    queryFn: getMyNodes,
  });

  const nodes = useMemo(() => nodesData?.nodes ?? [], [nodesData?.nodes]);
  const onlineNodes = nodes.filter((n) => n.status === "online");
  const offlineNodes = nodes.filter(
    (n) => n.status === "offline" || n.status === "pending",
  );

  const uptimeQueries = useQueries({
    queries: nodes.slice(0, 8).map((node) => ({
      queryKey: ["node-uptime", node.id, refreshKey],
      queryFn: () => getNodeUptime(node.id),
      staleTime: 60_000,
      enabled: nodes.length > 0,
    })),
  });

  const uptimeByNode = useMemo(() => {
    const map = new Map<
      string,
      { uptime_percent: number; checks_24h: number; avg_latency_ms: number }
    >();
    nodes.slice(0, 8).forEach((node, i) => {
      const data = uptimeQueries[i]?.data;
      if (data) {
        map.set(node.id, {
          uptime_percent: data.uptime_percent,
          checks_24h: data.checks_24h,
          avg_latency_ms: data.avg_latency_ms,
        });
      }
    });
    return map;
  }, [nodes, uptimeQueries]);

  const avgApiUptime = useMemo(() => {
    const vals = [...uptimeByNode.values()]
      .map((v) => v.uptime_percent)
      .filter((n) => Number.isFinite(n));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [uptimeByNode]);

  const avgUptime =
    avgApiUptime ??
    (nodes.length > 0
      ? nodes.reduce((s, n) => s + (n.uptime_percent ?? 0), 0) / nodes.length
      : null);
  const avgLatency =
    onlineNodes.length > 0
      ? onlineNodes.reduce((s, n) => s + (n.latency_ms ?? 0), 0) /
        onlineNodes.length
      : null;
  const avgScore =
    nodes.length > 0
      ? nodes.reduce((s, n) => s + (n.quality_score ?? 0), 0) / nodes.length
      : null;
  const proofOk = nodes.filter((n) => n.latest_heartbeat_verified).length;
  const withWallet = nodes.filter((n) => Boolean(n.wallet_address)).length;

  if (sourceError)
    return (
      <div className="ui-page">
        <h1>Node health</h1>
        <DataError error={sourceError} retry={() => void retrySource()} />
      </div>
    );

  const checks: HealthCheck[] = nodesLoading
    ? [
        {
          id: "nodes",
          label: "Node Registration",
          description: "Checking registered nodes…",
          status: "loading",
        },
        {
          id: "connectivity",
          label: "Connectivity",
          description: "Checking online status…",
          status: "loading",
        },
        {
          id: "uptime",
          label: "Uptime (24h)",
          description: "Checking uptime history…",
          status: "loading",
        },
        {
          id: "proof",
          label: "Heartbeat proof",
          description: "Checking signed heartbeats…",
          status: "loading",
        },
        {
          id: "payout",
          label: "Payout wallet",
          description: "Checking node payout wallets…",
          status: "loading",
        },
        {
          id: "latency",
          label: "Latency",
          description: "Checking response times…",
          status: "loading",
        },
      ]
    : [
        {
          id: "nodes",
          label: "Node Registration",
          description: "At least one node registered",
          status: nodes.length > 0 ? "pass" : "fail",
          detail:
            nodes.length === 0
              ? "No nodes registered. Use the setup wizard."
              : `${nodes.length} node${nodes.length > 1 ? "s" : ""} registered`,
        },
        {
          id: "connectivity",
          label: "Connectivity",
          description: "Nodes online via CLI tunnel",
          status:
            nodes.length === 0
              ? "fail"
              : onlineNodes.length === nodes.length
                ? "pass"
                : onlineNodes.length > 0
                  ? "warn"
                  : "fail",
          detail:
            nodes.length === 0
              ? "No nodes to check"
              : `${onlineNodes.length} of ${nodes.length} online${offlineNodes.length > 0 ? ` · ${offlineNodes.length} offline/pending` : ""}`,
        },
        {
          id: "uptime",
          label: "Uptime (24h API)",
          description: "Average uptime above 90%",
          status:
            avgUptime === null
              ? "warn"
              : avgUptime >= 95
                ? "pass"
                : avgUptime >= 80
                  ? "warn"
                  : "fail",
          detail:
            avgUptime !== null
              ? `Average uptime: ${avgUptime.toFixed(1)}%${avgApiUptime != null ? " (from /uptime)" : ""}`
              : "No uptime history yet",
        },
        {
          id: "proof",
          label: "Heartbeat proof",
          description: "Signed heartbeats verified",
          status:
            nodes.length === 0
              ? "fail"
              : proofOk === nodes.length
                ? "pass"
                : proofOk > 0
                  ? "warn"
                  : "warn",
          detail:
            nodes.length === 0
              ? "No nodes"
              : `${proofOk}/${nodes.length} nodes with verified proof`,
        },
        {
          id: "payout",
          label: "Payout wallet",
          description: "Node has Solana payout wallet for claims",
          status:
            nodes.length === 0
              ? "fail"
              : withWallet === nodes.length
                ? "pass"
                : withWallet > 0
                  ? "warn"
                  : "fail",
          detail:
            nodes.length === 0
              ? "No nodes"
              : `${withWallet}/${nodes.length} nodes have payout wallet (linked from profile)`,
        },
        {
          id: "latency",
          label: "Latency",
          description: "Average response time below 200ms",
          status:
            avgLatency === null
              ? onlineNodes.length === 0
                ? "warn"
                : "fail"
              : avgLatency < 100
                ? "pass"
                : avgLatency < 200
                  ? "warn"
                  : "fail",
          detail:
            avgLatency !== null
              ? `Average latency: ${avgLatency.toFixed(0)}ms`
              : onlineNodes.length === 0
                ? "No online nodes to measure"
                : "No latency data",
        },
      ];

  const passing = checks.filter((c) => c.status === "pass").length;
  const failing = checks.filter((c) => c.status === "fail").length;
  const warning = checks.filter((c) => c.status === "warn").length;
  const overall: CheckStatus =
    failing > 0
      ? "fail"
      : warning > 0
        ? "warn"
        : nodesLoading
          ? "loading"
          : "pass";

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col gap-2 border-b border-border pb-6">
        <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold normal-case tracking-normal">
          <ShieldCheck size={14} />
          Diagnostics
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold font-mono normal-case tracking-tight">
            Node Health
          </h1>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-xl font-mono text-xs transition-colors"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
        <p className="text-muted-foreground font-mono text-xs max-w-lg">
          Connectivity, uptime history, heartbeat proofs, and payout readiness.
        </p>
      </div>

      {!nodesLoading && nodes.length === 0 && (
        <GlassCard hoverEffect={false}>
          <div className="text-center py-12 space-y-4">
            <Server className="mx-auto w-14 h-14 text-muted-foreground/20" />
            <p className="font-mono text-sm font-bold">No nodes to diagnose</p>
            <p className="font-mono text-xs text-muted-foreground max-w-md mx-auto">
              Create a node with Setup, download config, and start the CLI. Then
              return here.
            </p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/dashboard/provider/setup"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-xl font-mono text-xs font-bold normal-case"
              >
                Setup wizard
              </Link>
              <Link
                href="/dashboard/provider/cli"
                className="px-4 py-2 bg-white/10 rounded-xl font-mono text-xs font-bold normal-case"
              >
                CLI download
              </Link>
            </div>
          </div>
        </GlassCard>
      )}

      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`rounded-2xl border p-5 flex items-center gap-4 ${statusBg(overall)}`}
      >
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusBg(overall)} border`}
        >
          <StatusIcon status={overall} />
        </div>
        <div>
          <p
            className={`text-lg font-semibold font-mono ${statusColor(overall)}`}
          >
            {overall === "loading"
              ? "Running checks…"
              : overall === "pass"
                ? "All systems healthy"
                : overall === "warn"
                  ? "Some checks need attention"
                  : "Critical issues detected"}
          </p>
          <p className="text-xs font-mono text-muted-foreground">
            {passing} passed · {warning} warnings · {failing} failed
          </p>
        </div>
      </motion.div>

      <div className="space-y-3">
        {checks.map((check, i) => (
          <motion.div
            key={check.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
            className={`rounded-2xl border p-4 flex items-start gap-4 ${statusBg(check.status)}`}
          >
            <div className="mt-0.5">
              <StatusIcon status={check.status} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold font-mono">{check.label}</p>
              <p className="text-xs font-mono text-muted-foreground">
                {check.description}
              </p>
              {check.detail && (
                <p
                  className={`text-xs font-mono mt-1 ${statusColor(check.status)}`}
                >
                  {check.detail}
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {nodes.length > 0 && (
        <GlassCard hoverEffect={false}>
          <h2 className="text-sm font-bold font-mono mb-4 flex items-center gap-2">
            <Server size={14} className="text-primary" />
            Node Details
          </h2>
          <div className="divide-y divide-white/5">
            {nodes.map((node) => {
              const hist = uptimeByNode.get(node.id);
              return (
                <div
                  key={node.id}
                  className="py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        node.status === "online"
                          ? "bg-emerald-500"
                          : node.status === "pending"
                            ? "bg-amber-400"
                            : "bg-red-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold font-mono truncate">
                        {node.name}
                      </p>
                      {node.country && (
                        <p className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                          <MapPin size={8} />
                          {node.city ? `${node.city}, ` : ""}
                          {node.country}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground shrink-0">
                    <div
                      className="flex items-center gap-1"
                      title="24h uptime API"
                    >
                      <Clock size={10} />
                      <span>
                        {(hist?.uptime_percent ?? node.uptime_percent)?.toFixed(
                          1,
                        ) ?? "Not measured"}
                        %
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Wifi size={10} />
                      <span>
                        {node.latency_ms != null ? `${node.latency_ms}ms` : "Not measured"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <BarChart3 size={10} />
                      <span>{node.quality_score?.toFixed(0) ?? "Not measured"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Cpu size={10} />
                      <span>{node.active_connections ?? 0} conn</span>
                    </div>
                    {hist && (
                      <span className="text-xs text-muted-foreground/60">
                        {hist.checks_24h} checks
                      </span>
                    )}
                    <Link
                      href="/dashboard/provider/nodes"
                      className="text-primary hover:underline text-xs normal-case font-bold"
                    >
                      Manage
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {failing > 0 && (
        <GlassCard hoverEffect={false}>
          <h2 className="text-sm font-bold font-mono mb-3 flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-400" />
            Remediation Tips
          </h2>
          <div className="space-y-2 text-xs font-mono text-muted-foreground">
            {nodes.length === 0 && (
              <p>
                • Use{" "}
                <Link
                  href="/dashboard/provider/setup"
                  className="text-primary hover:underline"
                >
                  Setup
                </Link>{" "}
                then <code className="text-primary">provider-node start</code>{" "}
                (not a second register).
              </p>
            )}
            {offlineNodes.length > 0 && (
              <p>
                • {offlineNodes.length} node(s) offline or pending. Open My nodes
                → Connect and start the CLI.
              </p>
            )}
            {withWallet < nodes.length && nodes.length > 0 && (
              <p>
                • Link a Solana wallet in{" "}
                <Link
                  href="/dashboard/settings"
                  className="text-primary hover:underline"
                >
                  Settings
                </Link>{" "}
                so payout wallets auto-bind for claims.
              </p>
            )}
            {proofOk < nodes.length && nodes.length > 0 && (
              <p>
                • Configure{" "}
                <code className="text-primary">provider_signing_key</code> (or
                linked wallet hotkey) for verified heartbeats.
              </p>
            )}
            {avgLatency !== null && avgLatency > 200 && (
              <p>• High latency detected. Check your network connection.</p>
            )}
            {avgScore !== null && avgScore < 60 && (
              <p>
                • Low quality score. Ensure stable uptime and sufficient
                bandwidth.
              </p>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
