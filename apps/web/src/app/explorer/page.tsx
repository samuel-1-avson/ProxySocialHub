"use client";

import React, { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeading } from "@/components/workspace/Patterns";
import { GlassCard } from "@/components/ui/glass-card";
import {
  getExplorerMetrics,
  getRecentTransactions,
  getBlocks,
  getNetworkHealth,
  getNodes,
  getAnalytics,
  getExplorerDecentralizationStatus,
  getExplorerDecentralizationWriters,
  type NetworkHealth,
  type TransactionSummary,
  type BlockSummary,
} from "@/lib/services/explorer";
import { useExplorerWS } from "@/lib/hooks/useExplorerWS";
import { buildExplorerSearchPath } from "@/lib/explorer-search";
import { MetricsUnavailableBanner } from "@/components/explorer/MetricsUnavailableBanner";
import {
  ExplorerApiError,
  isExplorerDecentralizationGate,
} from "@/lib/services/explorer-errors";
import {
  explorerPublicEarningsEnabled,
  explorerPublicSessionsEnabled,
} from "@/lib/navigation/explorer-nav";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  Box,
  Database,
  Search,
  Server,
  ShieldCheck,
  ArrowRightLeft,
  Clock,
  ChevronRight,
  Zap,
  Hexagon,
  Target,
  Fingerprint,
  History,
  Network,
  BarChart2,
  Trophy,
  MapPin,
  TrendingUp,
  Radio,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
const OverviewSparkline = dynamic(() => import("@/components/explorer/OverviewSparkline"), {
  ssr: false,
  loading: () => <div className="h-10" aria-hidden="true" />,
});

type OverviewTransaction = Pick<
  TransactionSummary,
  | "tx_hash"
  | "from_address"
  | "to_address"
  | "amount"
  | "currency"
  | "tx_type"
  | "status"
  | "timestamp"
>;
type OverviewBlock = Pick<
  BlockSummary,
  "block_hash" | "block_number" | "transaction_count" | "timestamp"
>;
const subscribeToMount = () => () => {};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function normalizeTransaction(value: unknown): OverviewTransaction {
  const tx = record(value);
  return {
    tx_hash: String(tx.tx_hash ?? ""),
    from_address: String(tx.from ?? tx.from_address ?? ""),
    to_address: String(tx.to ?? tx.to_address ?? ""),
    amount: Number(tx.amount ?? 0),
    currency: String(tx.currency ?? ""),
    tx_type: String(tx.tx_type ?? ""),
    status: String(tx.status ?? "pending"),
    timestamp: String(tx.timestamp ?? ""),
  };
}
function normalizeBlock(value: unknown): OverviewBlock {
  const block = record(value);
  return {
    block_hash: String(block.block_hash ?? ""),
    block_number: Number(block.block_number ?? 0),
    transaction_count: Number(block.transaction_count ?? 0),
    timestamp: String(block.timestamp ?? ""),
  };
}

export default function ExplorerDashboard() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = React.useState("");
  const mounted = useSyncExternalStore(
    subscribeToMount,
    () => true,
    () => false,
  );
  const [explorerGateActive, setExplorerGateActive] = useState(false);
  const [wsLive, setWsLive] = useState(false);
  const [socketTxs, setSocketTxs] = useState<OverviewTransaction[]>([]);
  const [socketBlocks, setSocketBlocks] = useState<OverviewBlock[]>([]);

  const isFullGateError = React.useCallback(
    (err: unknown): boolean => isExplorerDecentralizationGate(err),
    [],
  );

  const {
    data: metrics,
    isLoading: loadingMetrics,
    error: metricsError,
  } = useQuery({
    queryKey: ["explorer-metrics"],
    queryFn: async () => {
      try {
        return await getExplorerMetrics("all");
      } catch (err) {
        if (isFullGateError(err)) {
          setExplorerGateActive(true);
        }
        throw err;
      }
    },
    enabled: !explorerGateActive,
    refetchInterval: explorerGateActive ? false : 10000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const {
    data: transactions,
    isLoading: loadingTx,
    error: txError,
  } = useQuery({
    queryKey: ["recent-transactions"],
    queryFn: async () => {
      try {
        return await getRecentTransactions(1, 10);
      } catch (err) {
        if (isFullGateError(err)) {
          setExplorerGateActive(true);
        }
        throw err;
      }
    },
    enabled: !explorerGateActive,
    refetchInterval: explorerGateActive || wsLive ? false : 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const {
    data: blocks,
    isLoading: loadingBlocks,
    error: blocksError,
  } = useQuery({
    queryKey: ["recent-blocks"],
    queryFn: async () => {
      try {
        return await getBlocks(1, 5);
      } catch (err) {
        if (isFullGateError(err)) {
          setExplorerGateActive(true);
        }
        throw err;
      }
    },
    enabled: !explorerGateActive,
    refetchInterval: explorerGateActive || wsLive ? false : 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: health } = useQuery<NetworkHealth>({
    queryKey: ["network-health"],
    queryFn: ({ signal }) => getNetworkHealth(signal),
    refetchInterval: 30000,
  });

  const { data: topNodes } = useQuery({
    queryKey: ["top-nodes"],
    queryFn: async () => {
      try {
        return await getNodes(1, 5, true);
      } catch (err) {
        if (isFullGateError(err)) {
          setExplorerGateActive(true);
        }
        throw err;
      }
    },
    enabled: !explorerGateActive,
    refetchInterval: explorerGateActive ? false : 60000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: analytics } = useQuery({
    queryKey: ["analytics-dashboard", "24h"],
    queryFn: async () => {
      try {
        return await getAnalytics("24h");
      } catch (err) {
        if (isFullGateError(err)) {
          setExplorerGateActive(true);
        }
        throw err;
      }
    },
    enabled: !explorerGateActive,
    refetchInterval: explorerGateActive ? false : 120000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const { data: decentralization } = useQuery({
    queryKey: ["explorer-decentralization-status", 256],
    queryFn: () => getExplorerDecentralizationStatus(256),
    refetchInterval: 20000,
    retry: false,
  });

  const {
    data: writerHealth,
    isError: writerHealthError,
    isPending: writerHealthPending,
  } = useQuery({
    queryKey: ["explorer-decentralization-writers", 256],
    queryFn: () => getExplorerDecentralizationWriters(256),
    refetchInterval: 20000,
    retry: false,
  });

  const liveTxs =
    wsLive && socketTxs.length
      ? socketTxs
      : (transactions?.transactions ?? socketTxs);
  const liveBlocks =
    wsLive && socketBlocks.length
      ? socketBlocks
      : (blocks?.blocks ?? socketBlocks);
  useExplorerWS({
    enabled: !explorerGateActive,
    onOpen: () => setWsLive(true),
    onClose: () => setWsLive(false),
    onInitial: (value: unknown) => {
      const data = record(value);
      setWsLive(true);
      if (Array.isArray(data.transactions))
        setSocketTxs(data.transactions.map(normalizeTransaction));
      if (Array.isArray(data.blocks))
        setSocketBlocks(data.blocks.map(normalizeBlock));
    },
    onNewTransaction: (value: unknown) => {
      setWsLive(true);
      setSocketTxs((previous) =>
        [
          normalizeTransaction(value),
          ...(previous.length ? previous : (transactions?.transactions ?? [])),
        ].slice(0, 10),
      );
    },
    onNewBlock: (value: unknown) => {
      setWsLive(true);
      setSocketBlocks((previous) =>
        [
          normalizeBlock(value),
          ...(previous.length ? previous : (blocks?.blocks ?? [])),
        ].slice(0, 5),
      );
    },
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, scale: 0.98, y: 10 },
    show: { opacity: 1, scale: 1, y: 0 },
  };

  const handleSearch = (val: string) => {
    const query = val.trim();
    if (!query) return;
    router.push(buildExplorerSearchPath(query));
  };

  const volume = metrics?.total_volume;
  const nodes = metrics?.active_nodes;
  const bandwidth = metrics?.total_bandwidth_gb;
  const blockHeight = metrics?.block_height;

  // Real sparkline data from analytics API (24h history)
  const volSparkData = (analytics?.transaction_volume || []).map((p) => ({
    v: p.value,
  }));
  const bwSparkData = (analytics?.bandwidth_gb || []).map((p) => ({
    v: p.value,
  }));
  const nodeSparkData = (analytics?.active_nodes || []).map((p) => ({
    v: p.value,
  }));

  const metricCards = [
    {
      label: "Block Height",
      value: blockHeight != null ? blockHeight.toLocaleString() : "—",
      icon: Database,
      color: "text-primary",
      sparkColor: "#6366f1",
      sparkData: null, // no time series for block height
      sub:
        metrics?.avg_block_time_ms != null
          ? `~${Number(metrics.avg_block_time_ms).toFixed(0)}ms per block`
          : null,
    },
    {
      label: "Active nodes",
      value: nodes != null ? nodes.toLocaleString() : "—",
      icon: Server,
      color: "text-blue-500",
      sparkColor: "#3b82f6",
      sparkData: nodeSparkData.length > 0 ? nodeSparkData : null,
      sub: metrics
        ? `${metrics.active_wallets || 0} distinct wallets (24h)`
        : null,
    },
    {
      label: "Transaction volume",
      value: volume != null ? `${Number(volume).toFixed(2)} SOL` : "—",
      icon: ArrowRightLeft,
      color: "text-emerald-500",
      sparkColor: "#10b981",
      sparkData: volSparkData.length > 0 ? volSparkData : null,
      sub: metrics
        ? `${Number(metrics.transactions_per_second || 0).toFixed(2)} avg TPS (24h)`
        : null,
    },
    {
      label: "Indexed bandwidth",
      value: bandwidth != null ? `${Number(bandwidth).toFixed(2)} GB` : "—",
      icon: Zap,
      color: "text-yellow-500",
      sparkColor: "#eab308",
      sparkData: bwSparkData.length > 0 ? bwSparkData : null,
      sub: "Cumulative indexed node bandwidth",
    },
  ];

  // System health status color
  const healthStatus = health?.status?.toLowerCase() || "unavailable";
  const healthy = ["optimal", "healthy"].includes(healthStatus);
  const healthColor =
    healthStatus === "unavailable"
      ? "text-muted-foreground"
      : healthy
        ? "text-emerald-500"
        : healthStatus === "degraded"
          ? "text-yellow-500"
          : "text-rose-500";
  const healthBg =
    healthStatus === "unavailable"
      ? "bg-muted border-border"
      : healthy
        ? "bg-emerald-500/10 border-emerald-500/20"
        : healthStatus === "degraded"
          ? "bg-yellow-500/10 border-yellow-500/20"
          : "bg-rose-500/10 border-rose-500/20";

  const sortedTopNodes = [...(topNodes?.nodes || [])].sort(
    (a, b) => (b.uptime_percent || 0) - (a.uptime_percent || 0),
  );

  const consensusRate =
    decentralization && decentralization.recent_slots_analyzed > 0
      ? `${(decentralization.quorum_ratio * 100).toFixed(1)}%`
      : "—";
  const consensusColor =
    !decentralization || decentralization.recent_slots_analyzed === 0
      ? "text-muted-foreground"
      : decentralization.conflicting_slots > 0
        ? "text-rose-400"
        : decentralization.fully_decentralized
          ? "text-emerald-400"
          : "text-yellow-400";

  const trustLabel = !decentralization
    ? "Unavailable"
    : decentralization.recent_slots_analyzed === 0
      ? "Bootstrapping"
      : decentralization.fully_decentralized
        ? "Verified Multi-Writer"
        : decentralization.conflicting_slots > 0
          ? "Conflicting Views"
          : "Partial Quorum";

  const trustColor =
    !decentralization || decentralization.recent_slots_analyzed === 0
      ? "text-muted-foreground"
      : decentralization.fully_decentralized
        ? "text-emerald-400"
        : decentralization.conflicting_slots > 0
          ? "text-rose-400"
          : "text-yellow-400";

  const writerRows = (writerHealth?.writers || []).slice(0, 5);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="explorer-overview space-y-8"
    >
      <PageHeading
        eyebrow="Explorer / Public network records"
        title="ProxyExplorer"
        description="Inspect network activity, indexed transactions, and the evidence behind reported health."
      />
      <div className="explorer-overview-tools">
        <form
          className="explorer-overview-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            handleSearch(searchQuery);
          }}
        >
          <Search size={18} aria-hidden="true" />
          <label htmlFor="explorer-record-search" className="sr-only">
            Search public records
          </label>
          <input
            id="explorer-record-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Transaction, block, node, or wallet…"
          />
          <button type="submit" className="ui-button small">
            Search
          </button>
        </form>
        <div className="explorer-health-summary">
          <Activity size={17} aria-hidden="true" />
          <span>
            Reported health
            <strong className={healthColor}>{healthStatus}</strong>
          </span>
        </div>
      </div>

      {/* Quick Nav Links — hide sessions/earnings unless public API flags match control-api */}
      <motion.section
        variants={itemVariants}
        className="explorer-overview-links"
      >
        {[
          { href: "/treasury", label: "Treasury", icon: ShieldCheck },
          {
            href: "/explorer/transactions",
            label: "Transactions",
            icon: ArrowRightLeft,
          },
          { href: "/explorer/nodes", label: "Nodes", icon: Server },
          { href: "/explorer/blocks", label: "Blocks", icon: Box },
          { href: "/explorer/analytics", label: "Analytics", icon: BarChart2 },
          { href: "/explorer/map", label: "Node Map", icon: MapPin },
          { href: "/explorer/leaderboard", label: "Leaderboard", icon: Trophy },
          ...(explorerPublicSessionsEnabled()
            ? [{ href: "/explorer/sessions", label: "Sessions", icon: Radio }]
            : []),
          ...(explorerPublicEarningsEnabled()
            ? [
                {
                  href: "/explorer/earnings",
                  label: "Earnings",
                  icon: TrendingUp,
                },
              ]
            : []),
          { href: "/explorer/health", label: "Health", icon: ShieldCheck },
          { href: "/explorer/search", label: "Search", icon: Fingerprint },
          { href: "/explorer/wallets", label: "Wallets", icon: Database },
          { href: "/explorer/contracts", label: "Contracts", icon: Network },
        ].map((nav) => (
          <Link
            key={nav.href}
            href={nav.href}
            prefetch={false}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-primary hover:border-primary/20 hover:bg-primary/5 text-xs font-semibold tracking-wide transition-all"
          >
            <nav.icon size={11} /> {nav.label}
          </Link>
        ))}
      </motion.section>

      {/* Live Metrics Matrix with Sparklines */}
      <motion.section
        variants={itemVariants}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        {metricCards.map((stat, i) => (
          <GlassCard
            key={i}
            role="group"
            aria-label={stat.label}
            className="explorer-metric-card"
          >
            <div className="flex justify-between items-start mb-4 relative z-10">
              <stat.icon
                size={18}
                className={`${stat.color} opacity-40 group-hover:opacity-100 transition-opacity`}
              />
              <span className="explorer-metric-source">Indexed metric</span>
            </div>
            <div className="explorer-metric-value">
              {loadingMetrics ? (
                <div className="h-7 w-24 bg-muted animate-pulse rounded" />
              ) : (
                stat.value
              )}
            </div>
            <div className="explorer-metric-label">{stat.label}</div>
            {stat.sub && (
              <div className="text-xs text-muted-foreground font-mono relative z-10 mb-2">
                {stat.sub}
              </div>
            )}
            {/* Sparkline — only rendered when real 24h data is available */}
            {mounted && stat.sparkData && stat.sparkData.length > 1 && (
              <OverviewSparkline data={stat.sparkData} color={stat.sparkColor} gradientId={"overview-spark-" + i} />
            )}
          </GlassCard>
        ))}
      </motion.section>

      {/* System Health HUD */}
      <motion.section variants={itemVariants}>
        <GlassCard
          className={`!p-8 border rounded-2xl relative overflow-hidden group ${healthBg}`}
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
            <Network size={120} />
          </div>
          <div className="flex flex-col lg:flex-row justify-between items-center gap-10 relative z-10">
            <div className="flex items-center gap-8">
              <div
                className={`w-16 h-16 rounded-[1.8rem] ${healthBg} flex items-center justify-center ${healthColor}`}
              >
                <ShieldCheck size={32} />
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tighter text-foreground">
                  System status: {healthStatus}
                </h2>
                <div className="flex flex-wrap items-center gap-6 text-xs font-semibold tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full animate-pulse ${!health ? "bg-muted-foreground" : health.solana_health === "healthy" ? "bg-emerald-500" : "bg-rose-500"}`}
                    />
                    Blockchain indexer ·{" "}
                    {health?.solana_health || "unavailable"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${!health ? "bg-muted-foreground" : health.database_health === "healthy" ? "bg-emerald-500" : "bg-rose-500"}`}
                    />
                    Database · {health?.database_health || "unavailable"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    {health?.active_nodes ?? "—"} nodes online
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-12 items-center">
              <div className="text-right">
                <div className="text-xs font-semibold text-muted-foreground normal-case tracking-wide mb-1">
                  Response Latency
                </div>
                <div
                  className={`text-3xl font-semibold ${health?.avg_response_time_ms == null ? "text-muted-foreground" : health.avg_response_time_ms < 50 ? "text-emerald-400" : (health?.avg_response_time_ms || 0) < 200 ? "text-yellow-400" : "text-rose-400"}`}
                >
                  {health?.avg_response_time_ms?.toFixed(0) || "—"}
                  <span className="text-sm text-muted-foreground ml-1">ms</span>
                </div>
              </div>
              <div className="w-px h-12 bg-border hidden lg:block" />
              <div className="text-right">
                <div className="text-xs font-semibold text-muted-foreground normal-case tracking-wide mb-1">
                  Consensus Rate
                </div>
                <div className={`text-3xl font-semibold ${consensusColor}`}>
                  {consensusRate}
                </div>
              </div>
              <div className="w-px h-12 bg-border hidden lg:block" />
              <div className="text-right">
                <Link
                  href="/explorer/analytics"
                  prefetch={false}
                  className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary normal-case tracking-wide transition-colors"
                >
                  Analytics <ChevronRight size={12} />
                </Link>
                <div className="text-xs text-muted-foreground mt-0.5">
                  View full charts
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </motion.section>

      {/* Decentralization Trust Panel */}
      <motion.section
        variants={itemVariants}
        className="grid grid-cols-1 xl:grid-cols-12 gap-6"
      >
        <GlassCard className="xl:col-span-5 !p-6 border-border bg-card rounded-2xl">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold tracking-tighter text-foreground flex items-center gap-2">
              <ShieldCheck size={16} className="text-primary" /> Explorer Trust
            </h3>
            <div
              className={`text-xs font-semibold tracking-wide ${trustColor}`}
            >
              {trustLabel}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-muted p-3">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                Writers
              </div>
              <div className="text-xl font-semibold text-foreground mt-1">
                {decentralization?.unique_writers ?? "—"}
                <span className="text-xs text-muted-foreground ml-1">
                  / {decentralization?.min_writers_required ?? "—"}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-muted p-3">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                Quorum Slots
              </div>
              <div className="text-xl font-semibold text-foreground mt-1">
                {decentralization?.slots_meeting_quorum ?? "—"}
                <span className="text-xs text-muted-foreground ml-1">
                  / {decentralization?.recent_slots_analyzed ?? "—"}
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-muted p-3">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                Conflicting Slots
              </div>
              <div
                className={`text-xl font-semibold mt-1 ${(decentralization?.conflicting_slots || 0) > 0 ? "text-rose-400" : "text-emerald-400"}`}
              >
                {decentralization?.conflicting_slots ?? "—"}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-muted p-3">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                Mode
              </div>
              <div className="text-xs font-semibold text-foreground mt-2 normal-case tracking-normal truncate">
                {(decentralization?.explorer_mode || "unknown").replaceAll(
                  "_",
                  " ",
                )}
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-7 !p-6 border-border bg-card rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tighter text-foreground flex items-center gap-2">
              <Server size={16} className="text-primary" /> Writer Health
            </h3>
            <div className="text-xs text-muted-foreground normal-case tracking-wide">
              identity / lag / conflicts / participation
            </div>
          </div>

          {!writerRows.length ? (
            <div className="text-xs text-muted-foreground normal-case tracking-wide py-10 text-center border border-dashed border-border rounded-2xl">
              {writerHealthPending
                ? "Loading writer health…"
                : writerHealthError
                  ? "Writer health is unavailable"
                  : "No writer attestations in the current window"}
            </div>
          ) : (
            <div className="space-y-2">
              {writerRows.map((w) => (
                <div
                  key={w.writer_id}
                  className="grid grid-cols-12 gap-3 items-center rounded-xl border border-border bg-muted px-3 py-2"
                >
                  <div className="col-span-5 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-semibold text-primary truncate">
                        {w.writer_id}
                      </div>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-xs font-semibold tracking-wide ${w.identity_verified ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-border text-muted-foreground bg-muted"}`}
                      >
                        {w.identity_verified ? "verified" : "unverified"}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {w.rpc_endpoint || "rpc endpoint hidden"}
                    </div>
                  </div>
                  <div className="col-span-2 text-right">
                    <div className="text-xs text-muted-foreground normal-case tracking-wide">
                      Lag
                    </div>
                    <div
                      className={`text-xs font-semibold ${w.lag_slots === 0 ? "text-emerald-400" : w.lag_slots <= 2 ? "text-yellow-400" : "text-rose-400"}`}
                    >
                      {w.lag_slots}
                    </div>
                  </div>
                  <div className="col-span-2 text-right">
                    <div className="text-xs text-muted-foreground normal-case tracking-wide">
                      Conflicts
                    </div>
                    <div
                      className={`text-xs font-semibold ${w.conflicting_slots > 0 ? "text-rose-400" : "text-emerald-400"}`}
                    >
                      {w.conflicting_slots}
                    </div>
                  </div>
                  <div className="col-span-3 text-right">
                    <div className="text-xs text-muted-foreground normal-case tracking-wide">
                      Participation
                    </div>
                    <div className="text-xs font-semibold text-foreground">
                      {(w.participation_ratio * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </motion.section>

      {/* Real-time Data Streams */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
        {/* Recent transactions */}
        <motion.section
          variants={itemVariants}
          className="xl:col-span-8 space-y-6"
        >
          <div className="flex justify-between items-end px-4">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tighter text-foreground flex items-center gap-3">
                <Activity size={18} className="text-primary" /> Recent
                transactions
              </h2>
              <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide">
                Live protocol transactions
              </p>
            </div>
            <Link
              href="/explorer/transactions"
              className="text-xs font-semibold tracking-wide text-muted-foreground hover:text-primary transition-colors flex items-center gap-2"
            >
              Full Ledger <ChevronRight size={12} />
            </Link>
          </div>

          <div className="space-y-3">
            {loadingTx && !(wsLive && liveTxs.length > 0) ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-card animate-pulse border border-border rounded-2xl"
                />
              ))
            ) : !liveTxs.length ? (
              <div className="py-20 text-center border-2 border-dashed border-border rounded-2xl bg-card">
                <Fingerprint
                  size={48}
                  className="mx-auto text-muted-foreground mb-6"
                />
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide">
                  No indexed transactions in this result set
                </p>
              </div>
            ) : (
              liveTxs.map((tx, i) => (
                <GlassCard
                  key={tx.tx_hash || i}
                  className="group !p-4 border-border bg-card rounded-2xl hover:bg-surface-hover transition-all"
                >
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-black border border-border flex items-center justify-center text-primary group-hover:border-primary/20 transition-colors flex-shrink-0">
                        <Target size={14} />
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/explorer/transactions/${tx.tx_hash}`}
                          className="text-xs font-semibold text-primary hover:text-primary/80 truncate normal-case tracking-normal block transition-colors"
                        >
                          {tx.tx_hash?.slice(0, 14)}...{tx.tx_hash?.slice(-8)}
                        </Link>
                        <div className="text-xs font-semibold text-muted-foreground normal-case tracking-wide mt-0.5 flex items-center gap-2">
                          <Clock size={9} />
                          {tx.timestamp &&
                          Number.isFinite(new Date(tx.timestamp).getTime())
                            ? formatDistanceToNow(new Date(tx.timestamp), {
                                addSuffix: true,
                              })
                            : "Processing..."}
                          {tx.tx_type && (
                            <span className="text-muted-foreground bg-muted px-1.5 py-0.5 rounded text-xs">
                              {tx.tx_type.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-foreground">
                        {(tx.amount || 0).toFixed(4)} {tx.currency || "SOL"}
                      </div>
                      <div
                        className={`text-xs font-semibold tracking-wide mt-1 ${tx.status === "confirmed" ? "text-emerald-500" : tx.status === "failed" ? "text-rose-500" : "text-yellow-500"}`}
                      >
                        {tx.status || "Processing"}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              ))
            )}
          </div>
        </motion.section>

        {/* Right column: Blocks + Top Nodes */}
        <div className="xl:col-span-4 space-y-8">
          {/* Recent blocks */}
          <motion.section variants={itemVariants} className="space-y-4">
            <div className="space-y-1 px-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold tracking-tighter text-foreground flex items-center gap-3">
                  <Box size={18} className="text-primary" /> Recent blocks
                </h2>
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide mt-0.5">
                  Verified segment hashes
                </p>
              </div>
              <Link
                href="/explorer/blocks"
                className="text-xs font-semibold text-muted-foreground hover:text-primary normal-case tracking-wide flex items-center gap-1 transition-colors"
              >
                All <ChevronRight size={10} />
              </Link>
            </div>

            <div className="space-y-3">
              {loadingBlocks && !(wsLive && liveBlocks.length > 0) ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-20 bg-card animate-pulse border border-border rounded-[1.5rem]"
                  />
                ))
              ) : !liveBlocks.length ? (
                <div className="py-12 text-center border-2 border-dashed border-border rounded-2xl bg-card">
                  <Hexagon
                    size={36}
                    className="mx-auto text-muted-foreground mb-4"
                  />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-wide">
                    No indexed blocks in this result set
                  </p>
                </div>
              ) : (
                liveBlocks.map((block, i) => (
                  <Link
                    key={block.block_hash || i}
                    href={`/explorer/blocks/${block.block_number}`}
                  >
                    <GlassCard className="group !p-5 border-border bg-card rounded-2xl hover:bg-surface-hover transition-all relative overflow-hidden">
                      <div className="absolute right-0 top-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                        <History size={32} />
                      </div>
                      <div className="flex items-center justify-between relative z-10">
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground normal-case tracking-wide">
                            Block
                          </div>
                          <div className="text-xl font-semibold text-foreground tracking-tighter">
                            #{(block.block_number || 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground font-semibold tracking-wide">
                            {block.transaction_count ?? 0} txs
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {block.timestamp &&
                            Number.isFinite(new Date(block.timestamp).getTime())
                              ? formatDistanceToNow(new Date(block.timestamp), {
                                  addSuffix: true,
                                })
                              : "—"}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  </Link>
                ))
              )}
            </div>
          </motion.section>

          {/* Top Nodes Snapshot */}
          {sortedTopNodes.length > 0 && (
            <motion.section variants={itemVariants} className="space-y-4">
              <div className="px-4 flex justify-between items-center">
                <h2 className="text-xl font-semibold tracking-tighter text-foreground flex items-center gap-3">
                  <Trophy size={18} className="text-yellow-400" /> Active nodes
                </h2>
                <Link
                  href="/explorer/nodes"
                  className="text-xs font-semibold text-muted-foreground hover:text-primary normal-case tracking-wide flex items-center gap-1 transition-colors"
                >
                  All <ChevronRight size={10} />
                </Link>
              </div>
              <GlassCard className="!p-0 border-border bg-card rounded-2xl overflow-hidden divide-y divide-border">
                {sortedTopNodes.map((node, i) => (
                  <Link
                    key={node.node_id}
                    href={`/explorer/nodes/${node.node_id}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-surface-hover transition-colors"
                  >
                    <div className="text-xs font-semibold text-muted-foreground w-4">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-primary truncate">
                        {node.node_id?.slice(0, 14)}...
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <MapPin size={8} /> {node.country}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-xs font-semibold ${(node.uptime_percent || 0) > 98 ? "text-emerald-400" : "text-yellow-400"}`}
                      >
                        {(node.uptime_percent || 0).toFixed(1)}%
                      </div>
                    </div>
                  </Link>
                ))}
              </GlassCard>
            </motion.section>
          )}
        </div>
      </div>

      {metrics && metrics.time_series_available === false && !metricsError && (
        <motion.div variants={itemVariants}>
          <MetricsUnavailableBanner compact />
        </motion.div>
      )}

      {/* API Error Banner */}
      {(metricsError || txError || blocksError) && (
        <motion.div
          variants={itemVariants}
          data-testid={
            explorerGateActive ? "explorer-overview-gate-banner" : undefined
          }
          className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold tracking-wide"
        >
          <span className="text-rose-500">⚠</span>
          {explorerGateActive
            ? "Explorer full decentralization gate is active — detailed feeds are paused until quorum is satisfied"
            : metricsError instanceof ExplorerApiError &&
                metricsError.kind === "not_found"
              ? "Requested explorer resource was not found"
              : metricsError && txError
                ? "Network metrics and transaction data unavailable"
                : metricsError
                  ? metricsError instanceof Error
                    ? metricsError.message
                    : "Network metrics unavailable"
                  : txError
                    ? "Transaction feed unavailable"
                    : "Block data unavailable"}
          <span className="ml-auto text-xs text-destructive">
            {explorerGateActive
              ? "Follow /explorer/decentralization/status"
              : "Check API connection"}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
