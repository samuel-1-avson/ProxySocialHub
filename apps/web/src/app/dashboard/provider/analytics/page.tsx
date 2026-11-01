"use client";
import { DataError } from "@/components/workspace/Patterns";

import Link from "next/link";
import { getProviderNodes, ProviderNode } from "@/lib/api/marketplace";
import { getProviderEarningsSummary, getNodeUptime } from "@/lib/api/provider";
import { ProviderScoreCard } from "@/components/ProviderScoreCard";
import { MarketplaceFunnelDashboard } from "@/components/admin/MarketplaceFunnelDashboard";
import {
  Loader2,
  Server,
  BarChart2,
  Coins,
  TrendingUp,
  Activity,
  Plus,
  Gauge,
  Wifi,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

async function fetchProviderNodes(): Promise<ProviderNode[]> {
  const data = await getProviderNodes();
  return data.nodes || [];
}

type NodeUptimeData = Awaited<ReturnType<typeof getNodeUptime>>;

function uptimeBarColor(percent: number): string {
  if (percent >= 99) return "bg-emerald-500";
  if (percent >= 95) return "bg-amber-500";
  return "bg-rose-500";
}

export default function ProviderAnalyticsPage() {
  const { isAuthenticated } = useAuth();
  const {
    data: nodes = [],
    isLoading: loading,
    error: sourceError,
    refetch: retrySource,
  } = useQuery({
    queryKey: ["provider-nodes-analytics"],
    queryFn: fetchProviderNodes,
    retry: 2,
  });

  const { data: earnings, error: earningsError, refetch: retryEarnings } = useQuery({
    queryKey: ["provider-earnings-summary"],
    queryFn: getProviderEarningsSummary,
    staleTime: 30_000,
  });

  const nodeIds = nodes.map((n) => n.id).join(",");
  const { data: uptimeByNode = {} } = useQuery({
    queryKey: ["provider-nodes-uptime", nodeIds],
    queryFn: async () => {
      const results = await Promise.allSettled(
        nodes.map((n) => getNodeUptime(n.id)),
      );
      const map: Record<string, NodeUptimeData> = {};
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          map[nodes[index].id] = result.value;
        }
      });
      return map;
    },
    enabled: nodes.length > 0,
    staleTime: 30_000,
  });

  if (sourceError)
    return (
      <div className="ui-page">
        <h1>Provider analytics</h1>
        <DataError error={sourceError} retry={() => void retrySource()} />
      </div>
    );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-xs font-mono normal-case text-muted-foreground">
          Analyzing Network Performance...
        </p>
      </div>
    );
  }

  const hasActiveNodes = nodes.length > 0;
  const totalEarned = earnings?.total_earned_sol;

  const uptimeEntries = nodes
    .map((n) => uptimeByNode[n.id]?.uptime_percent ?? n.uptime_percent)
    .filter((v): v is number => typeof v === "number");
  const avgUptime =
    uptimeEntries.length > 0
      ? uptimeEntries.reduce((acc, v) => acc + v, 0) / uptimeEntries.length
      : null;

  const latencyEntries = nodes
    .map((n) => uptimeByNode[n.id]?.avg_latency_ms ?? n.latency_ms)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const avgLatency =
    latencyEntries.length > 0
      ? latencyEntries.reduce((acc, v) => acc + v, 0) / latencyEntries.length
      : null;

  const totalSessions = earnings?.total_sessions ?? null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col gap-2 border-b border-border pb-6">
        <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold normal-case tracking-normal">
          <BarChart2 size={14} />
          Performance Analytics
        </div>
        <h1 className="text-3xl font-bold font-mono normal-case tracking-tight">
          Provider Scorecard
        </h1>
        <p className="text-muted-foreground font-mono text-xs max-w-lg">
          Real-time trust metrics, node performance, and earnings.
        </p>
      </div>

      {earningsError && <DataError title="Earnings summary is unavailable" error={earningsError} retry={() => void retryEarnings()} />}
      <GlassCard hoverEffect={false} className="p-6">
        <MarketplaceFunnelDashboard mode="seller" enabled={isAuthenticated} />
      </GlassCard>

      {!hasActiveNodes ? (
        <GlassCard hoverEffect={false}>
          <div className="text-center py-12 space-y-4">
            <Server className="mx-auto w-14 h-14 text-muted-foreground/20" />
            <p className="font-mono text-sm font-bold">No nodes yet</p>
            <p className="font-mono text-xs text-muted-foreground max-w-md mx-auto">
              Add a node with the setup wizard, then start the CLI. Stats appear
              after your first heartbeat.
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
                className="px-4 py-2 bg-muted border border-border rounded-xl font-mono text-xs font-bold normal-case"
              >
                CLI download
              </Link>
            </div>
          </div>
        </GlassCard>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <GlassCard className="p-5 border-emerald-500/10 bg-emerald-500/5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <Coins size={20} className="text-emerald-400" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Total Earnings
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono text-emerald-400">
                {totalEarned != null ? totalEarned.toFixed(4) : "—"}{" "}
                <span className="text-sm text-emerald-400/60">SOL</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Pending {earnings?.pending_sol != null ? earnings.pending_sol.toFixed(4) : "—"} SOL ·{" "}
                <Link
                  href="/dashboard/provider/earnings"
                  className="text-primary hover:underline"
                >
                  Income
                </Link>
              </p>
            </GlassCard>

            <GlassCard className="p-5 border-border bg-muted">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Activity size={20} className="text-blue-400" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Active Nodes
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono">
                {nodes.filter((n) => n.status === "online").length}
                <span className="text-sm text-muted-foreground">
                  /{nodes.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Online now</p>
            </GlassCard>

            <GlassCard className="p-5 border-border bg-muted">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <TrendingUp size={20} className="text-emerald-400" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Trust Score
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono">
                {(nodes.length > 0
                  ? nodes.reduce(
                      (acc, n) => acc + (Number(n.quality_score) || 0),
                      0,
                    ) / nodes.length
                  : 0
                ).toFixed(1)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Average across nodes
              </p>
            </GlassCard>

            <GlassCard className="p-5 border-border bg-muted">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                  <Server size={20} className="text-orange-400" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Connections
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono">
                {nodes.reduce((acc, n) => acc + (n.active_connections || 0), 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Active right now
              </p>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <GlassCard className="p-5 border-border bg-muted">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
                  <Gauge size={20} className="text-cyan-400" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Avg Uptime (30d)
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono">
                {avgUptime !== null ? `${avgUptime.toFixed(1)}%` : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all reporting nodes
              </p>
            </GlassCard>

            <GlassCard className="p-5 border-border bg-muted">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
                  <Wifi size={20} className="text-primary" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Avg Latency
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono">
                {avgLatency !== null ? `${avgLatency.toFixed(0)}` : "—"}
                {avgLatency !== null && (
                  <span className="text-sm text-muted-foreground"> ms</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Across all reporting nodes
              </p>
            </GlassCard>

            <GlassCard className="p-5 border-border bg-muted">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                  <BarChart2 size={20} className="text-emerald-400" />
                </div>
                <div className="text-xs font-bold normal-case tracking-normal text-muted-foreground">
                  Total Sessions
                </div>
              </div>
              <div className="text-2xl font-semibold font-mono">
                {totalSessions !== null ? totalSessions.toLocaleString() : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Lifetime, from earnings
              </p>
            </GlassCard>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold normal-case tracking-normal text-muted-foreground">
              <Gauge size={16} />
              Node Availability (30d)
            </div>
            <GlassCard
              hoverEffect={false}
              className="p-5 border-border bg-muted divide-y divide-border"
            >
              {nodes.map((node) => {
                const uptime = uptimeByNode[node.id];
                const uptimePercent =
                  uptime?.uptime_percent ?? node.uptime_percent ?? null;
                const latency =
                  uptime?.avg_latency_ms ?? node.latency_ms ?? null;
                return (
                  <div
                    key={node.id}
                    className="py-3 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center gap-3"
                  >
                    <div className="flex items-center gap-2 md:w-48 shrink-0">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${node.status === "online" ? "bg-emerald-500" : "bg-rose-500"}`}
                      />
                      <span className="text-xs font-mono font-bold truncate">
                        {node.name || node.ip_address || node.id.slice(0, 8)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      {uptimePercent !== null ? (
                        <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border">
                          <div
                            className={`h-full rounded-full ${uptimeBarColor(uptimePercent)}`}
                            style={{
                              width: `${Math.min(100, Math.max(0, uptimePercent))}%`,
                            }}
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground font-mono">
                          No uptime data yet
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground md:w-56 shrink-0 justify-end">
                      <span>
                        {uptimePercent !== null
                          ? `${uptimePercent.toFixed(1)}%`
                          : "—"}
                      </span>
                      <span>
                        {latency !== null ? `${latency.toFixed(0)}ms` : "—"}
                      </span>
                      {uptime?.current_status && (
                        <span className="normal-case">
                          {uptime.current_status}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </GlassCard>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold normal-case tracking-normal text-muted-foreground">
                <Server size={16} />
                Your Nodes
              </div>
              <div className="flex gap-2 text-xs font-mono">
                <Link
                  href="/dashboard/provider/health"
                  className="text-primary hover:underline"
                >
                  Diagnostics
                </Link>
                <span className="text-muted-foreground">·</span>
                <Link
                  href="/dashboard/provider/nodes"
                  className="text-primary hover:underline"
                >
                  Manage
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {nodes.map((node) => (
                <ProviderScoreCard key={node.id} node={node} />
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center pt-8"
          >
            <GlassCard className="p-6 border-dashed border-border bg-muted/40 max-w-2xl w-full">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
                    <TrendingUp size={24} className="text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold">Scale Your Earnings</h3>
                    <p className="text-xs text-muted-foreground">
                      Add more nodes to increase your earning potential
                    </p>
                  </div>
                </div>
                <Link
                  href="/dashboard/provider/setup"
                  className="px-4 py-2 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-xs font-bold normal-case tracking-normal text-primary transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Plus size={12} />
                  Add Node
                </Link>
              </div>
            </GlassCard>
          </motion.div>
        </>
      )}
    </div>
  );
}
