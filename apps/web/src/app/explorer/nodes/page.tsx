"use client";

import { DataError } from "@/components/workspace/Patterns";
import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { GlassCard } from "@/components/ui/glass-card";
import { getNodes } from "@/lib/services/explorer";
import Link from "next/link";
import {
  Server,
  MapPin,
  Shield,
  Cloud,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Radio,
  Trophy,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Activity,
  Zap,
  Star,
  BarChart2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";

type SortField =
  | "uptime_percent"
  | "bandwidth_gb"
  | "active_sessions"
  | "last_heartbeat";
type SortDir = "asc" | "desc";
type TypeFilter = "all" | "validator" | "proxy";

function StatusDot({ isActive }: { isActive: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className={
          "h-2 w-2 rounded-full " +
          (isActive ? "bg-emerald-500" : "bg-rose-500")
        }
      />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (field !== sortField)
    return <ArrowUpDown size={10} className="text-muted-foreground" />;
  return sortDir === "desc" ? (
    <ArrowDown size={10} className="text-primary" />
  ) : (
    <ArrowUp size={10} className="text-primary" />
  );
}

export default function NodesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = (searchParams.get("q") || "").trim();
  const [pageState, setPage] = useState({ query: searchQuery, value: 1 });
  const page = pageState.query === searchQuery ? pageState.value : 1;
  const changePage = (value: number) => setPage({ query: searchQuery, value });
  const pageSize = 20;
  const [sortField, setSortField] = useState<SortField>("uptime_percent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const toggleCompare = (nodeId: string) => {
    setCompareIds((prev) => {
      if (prev.includes(nodeId)) return prev.filter((id) => id !== nodeId);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, nodeId];
    });
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["nodes", page, activeOnly, searchQuery],
    queryFn: () =>
      getNodes(
        page,
        pageSize,
        activeOnly,
        undefined,
        undefined,
        searchQuery || undefined,
      ),
    refetchInterval: 30000,
  });

  // Sort + type filter on current page (search is server-side via ?q=)
  const displayNodes = useMemo(() => {
    let nodes = data?.nodes || [];
    if (typeFilter === "validator") nodes = nodes.filter((n) => n.is_validator);
    if (typeFilter === "proxy") nodes = nodes.filter((n) => !n.is_validator);
    return [...nodes].sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      if (typeof av === "string")
        return sortDir === "desc"
          ? String(bv).localeCompare(av)
          : av.localeCompare(String(bv));
      return sortDir === "desc"
        ? Number(bv) - Number(av)
        : Number(av) - Number(bv);
    });
  }, [data?.nodes, typeFilter, sortField, sortDir]);

  // Top 3 performers for leaderboard preview
  const top3Uptime = useMemo(
    () =>
      [...(data?.nodes || [])]
        .sort((a, b) => (b.uptime_percent || 0) - (a.uptime_percent || 0))
        .slice(0, 3),
    [data?.nodes],
  );
  const top3Bandwidth = useMemo(
    () =>
      [...(data?.nodes || [])]
        .sort((a, b) => (b.bandwidth_gb || 0) - (a.bandwidth_gb || 0))
        .slice(0, 3),
    [data?.nodes],
  );

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 },
  };

  const getRankBadge = (i: number) => {
    if (i === 0) return <Trophy size={12} className="text-yellow-400" />;
    if (i === 1) return <Star size={12} className="text-slate-300" />;
    return <Star size={12} className="text-amber-600" />;
  };

  if (error)
    return (
      <div className="ui-page">
        <h1>Nodes</h1>
        <DataError
          title="Nodes are unavailable"
          error={error}
          retry={() => void refetch()}
        />
      </div>
    );

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-8 font-mono"
    >
      {/* Header */}
      <motion.header
        variants={itemVariants}
        className="flex flex-col gap-6 border-b border-border pb-8"
      >
        <Link
          href="/explorer"
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors normal-case tracking-normal w-fit"
        >
          <ArrowLeft size={14} /> Explorer overview
        </Link>

        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
          <div>
            <div className="text-xs font-semibold text-primary normal-case tracking-normal mb-1">
              Public records / Nodes
            </div>
            <h1 className="text-4xl font-semibold normal-case tracking-tighter text-foreground flex items-center gap-4">
              <Server className="text-primary" size={32} />
              Network nodes
            </h1>
            <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mt-2">
              Browse reported nodes. Type filters and sorting apply to the
              current page.
            </p>
            {searchQuery ? (
              <p className="text-xs font-semibold text-primary/80 normal-case tracking-normal mt-2">
                Search: &quot;{searchQuery}&quot; — {data?.total ?? 0} match
                {(data?.total ?? 0) === 1 ? "" : "es"}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                Active Nodes
              </p>
              <p className="text-3xl font-semibold text-foreground tracking-tighter">
                {data?.active?.toLocaleString() || "0"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                Total
              </p>
              <p className="text-3xl font-semibold text-muted-foreground tracking-tighter">
                {data?.total?.toLocaleString() || "0"}
              </p>
            </div>
          </div>
        </div>
      </motion.header>

      {/* Leaderboard Preview — same-day snapshot; official page may add period windows later */}
      {!isLoading && (top3Uptime.length > 0 || top3Bandwidth.length > 0) && (
        <motion.section variants={itemVariants} className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal px-1">
            Preview rankings use current node counters, not a historical period.
            See{" "}
            <Link
              href="/explorer/leaderboard"
              className="text-primary/60 hover:text-primary"
            >
              official leaderboard
            </Link>{" "}
            for API metadata.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Uptime */}
            <GlassCard className="!p-6 border-border bg-card rounded-2xl">
              <div className="flex items-center gap-3 mb-4">
                <Activity size={16} className="text-emerald-500" />
                <h3 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                  Top Uptime
                </h3>
              </div>
              <div className="space-y-3">
                {top3Uptime.map((node, i) => (
                  <Link
                    key={node.node_id}
                    href={`/explorer/nodes/${node.node_id}`}
                    className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                  >
                    <div className="w-5 flex items-center justify-center">
                      {getRankBadge(i)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-primary truncate">
                        {node.node_id?.slice(0, 16)}...
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {node.country}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-emerald-400">
                        {(node.uptime_percent || 0).toFixed(2)}%
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
              <Link
                href="/explorer/leaderboard?category=uptime"
                className="mt-4 block text-xs font-semibold text-primary/50 hover:text-primary normal-case tracking-normal transition-colors text-right"
              >
                Full Leaderboard →
              </Link>
            </GlassCard>

            {/* Top Bandwidth */}
            <GlassCard className="!p-6 border-border bg-card rounded-2xl">
              <div className="flex items-center gap-3 mb-4">
                <Zap size={16} className="text-yellow-500" />
                <h3 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                  Top Bandwidth
                </h3>
              </div>
              <div className="space-y-3">
                {top3Bandwidth.map((node, i) => (
                  <Link
                    key={node.node_id}
                    href={`/explorer/nodes/${node.node_id}`}
                    className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                  >
                    <div className="w-5 flex items-center justify-center">
                      {getRankBadge(i)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-primary truncate">
                        {node.node_id?.slice(0, 16)}...
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {node.country}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-yellow-400">
                        {(node.bandwidth_gb || 0).toFixed(2)} GB
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
              <Link
                href="/explorer/leaderboard?category=bandwidth"
                className="mt-4 block text-xs font-semibold text-primary/50 hover:text-primary normal-case tracking-normal transition-colors text-right"
              >
                Full Leaderboard →
              </Link>
            </GlassCard>
          </div>
        </motion.section>
      )}

      {/* Filters */}
      <motion.section
        variants={itemVariants}
        className="flex flex-wrap items-center gap-3"
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground normal-case tracking-normal">
          <Filter size={12} /> Filters:
        </div>
        {/* Type Filter */}
        <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-1">
          {(["all", "validator", "proxy"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTypeFilter(t);
                changePage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold normal-case tracking-normal transition-all ${typeFilter === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* Active Only Toggle */}
        <button
          onClick={() => {
            setActiveOnly((v) => !v);
            changePage(1);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-semibold normal-case tracking-normal transition-all ${activeOnly ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-muted border-border text-muted-foreground"}`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${activeOnly ? "bg-emerald-500" : "bg-border"}`}
          />
          Active Only
        </button>
        <div className="ml-auto text-xs font-semibold text-muted-foreground normal-case tracking-normal">
          Showing {displayNodes.length} nodes
        </div>
      </motion.section>

      {/* Nodes Table */}
      <motion.section variants={itemVariants}>
        <GlassCard className="overflow-hidden border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted text-muted-foreground text-xs normal-case tracking-normal font-semibold">
                  <th
                    className="px-3 py-4 w-10 text-center"
                    title="Select to compare (max 3)"
                  >
                    <BarChart2 size={10} className="mx-auto" />
                  </th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Node ID</th>
                  <th className="px-6 py-4">Location</th>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4 text-center">
                    <button
                      onClick={() => handleSort("uptime_percent")}
                      className="flex items-center gap-1.5 mx-auto hover:text-foreground transition-colors"
                    >
                      Uptime{" "}
                      <SortIcon
                        field="uptime_percent"
                        sortField={sortField}
                        sortDir={sortDir}
                      />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleSort("bandwidth_gb")}
                      className="flex items-center gap-1.5 ml-auto hover:text-foreground transition-colors"
                    >
                      Bandwidth{" "}
                      <SortIcon
                        field="bandwidth_gb"
                        sortField={sortField}
                        sortDir={sortDir}
                      />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleSort("active_sessions")}
                      className="flex items-center gap-1.5 ml-auto hover:text-foreground transition-colors"
                    >
                      Sessions{" "}
                      <SortIcon
                        field="active_sessions"
                        sortField={sortField}
                        sortDir={sortDir}
                      />
                    </button>
                  </th>
                  <th className="px-6 py-4 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={9} className="px-6 py-4 h-14 bg-muted" />
                    </tr>
                  ))
                ) : displayNodes.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Radio size={48} className="text-muted-foreground" />
                        <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                          No nodes match the current filter
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayNodes.map((node) => {
                    const isSelected = compareIds.includes(node.node_id);
                    const atMax = compareIds.length >= 3 && !isSelected;
                    return (
                      <tr
                        key={node.node_id}
                        className={`hover:bg-surface-hover transition-colors group cursor-pointer ${isSelected ? "bg-primary/[0.04]" : ""}`}
                      >
                        <td className="px-3 py-4 text-center">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              toggleCompare(node.node_id);
                            }}
                            aria-pressed={isSelected}
                            aria-label={
                              "Compare node " + (node.name || node.node_id)
                            }
                            disabled={atMax}
                            title={
                              atMax
                                ? "Max 3 nodes"
                                : isSelected
                                  ? "Remove from comparison"
                                  : "Add to comparison"
                            }
                            className={`w-5 h-5 rounded border flex items-center justify-center transition-all mx-auto ${
                              isSelected
                                ? "bg-primary border-primary text-primary-foreground"
                                : atMax
                                  ? "border-border text-muted-foreground cursor-not-allowed"
                                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary/50"
                            }`}
                          >
                            {isSelected ? (
                              <span className="text-xs font-semibold">✓</span>
                            ) : (
                              <span className="text-xs">+</span>
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4">
                          <StatusDot isActive={node.is_active} />
                        </td>
                        <td className="px-6 py-4">
                          <Link
                            href={`/explorer/nodes/${node.node_id}`}
                            className="block"
                          >
                            <div className="font-mono text-primary text-xs font-bold group-hover:text-primary/80 transition-colors">
                              {node.node_id?.slice(0, 8)}...
                              {node.node_id?.slice(-6)}
                            </div>
                            {node.name && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {node.name}
                              </div>
                            )}
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <MapPin
                              size={12}
                              className="text-muted-foreground"
                            />
                            {node.country}
                            {node.region ? `, ${node.region}` : ""}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {node.is_validator ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-400 bg-purple-400/10 px-3 py-1.5 rounded-lg normal-case tracking-normal">
                              <Shield size={10} /> Validator
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-400 bg-blue-400/10 px-3 py-1.5 rounded-lg normal-case tracking-normal">
                              <Cloud size={10} /> Proxy Node
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-3">
                            <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  (node.uptime_percent || 0) > 98
                                    ? "bg-emerald-500"
                                    : (node.uptime_percent || 0) > 90
                                      ? "bg-yellow-500"
                                      : "bg-rose-500"
                                }`}
                                style={{
                                  width: `${Math.min(node.uptime_percent || 0, 100)}%`,
                                }}
                              />
                            </div>
                            <span
                              className={`text-xs font-semibold ${
                                (node.uptime_percent || 0) > 98
                                  ? "text-emerald-400"
                                  : (node.uptime_percent || 0) > 90
                                    ? "text-yellow-400"
                                    : "text-rose-400"
                              }`}
                            >
                              {(node.uptime_percent || 0).toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-mono text-foreground font-bold text-sm">
                            {(node.bandwidth_gb || 0).toFixed(2)} GB
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-mono text-muted-foreground font-bold text-sm">
                            {node.active_sessions ?? 0}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            active
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right text-xs text-muted-foreground">
                          {node.last_heartbeat
                            ? formatDistanceToNow(
                                new Date(node.last_heartbeat),
                                { addSuffix: true },
                              )
                            : "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Compare bar */}
          {compareIds.length > 0 && (
            <div className="px-6 py-3 bg-primary/[0.06] border-t border-primary/20 flex items-center gap-4">
              <BarChart2 size={14} className="text-primary flex-shrink-0" />
              <span className="text-xs font-semibold text-primary normal-case tracking-normal flex-1">
                {compareIds.length} node{compareIds.length > 1 ? "s" : ""}{" "}
                selected
                {compareIds.length < 2 && (
                  <span className="text-primary/50 ml-2">
                    — select at least 2
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCompareIds([])}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground text-xs font-semibold normal-case tracking-normal transition-all"
                >
                  <X size={9} /> Clear
                </button>
                <button
                  onClick={() =>
                    router.push(
                      `/explorer/nodes/compare?ids=${compareIds.join(",")}`,
                    )
                  }
                  disabled={compareIds.length < 2}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold normal-case tracking-normal disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-all"
                >
                  <BarChart2 size={9} /> Compare
                </button>
              </div>
            </div>
          )}

          {/* Pagination */}
          <div className="p-6 bg-muted flex items-center justify-between border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
              Page <span className="text-foreground">{page}</span>
              {data?.total ? ` of ${Math.ceil(data.total / pageSize)}` : ""}
            </p>
            <div className="flex gap-2">
              <button
                aria-label="Previous page"
                onClick={() => changePage(Math.max(1, page - 1))}
                disabled={page === 1 || isLoading}
                className="p-2 rounded-lg bg-card border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft aria-hidden="true" className="w-5 h-5" />
              </button>
              <button
                aria-label="Next page"
                onClick={() => changePage(page + 1)}
                disabled={!data || page * pageSize >= (data.total ?? 0)}
                className="p-2 rounded-lg bg-card border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight aria-hidden="true" className="w-5 h-5" />
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.section>

      {error && (
        <motion.div
          variants={itemVariants}
          className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold normal-case tracking-normal text-center"
        >
          Failed to load nodes. Please check your connection to the ProxyHub
          network.
        </motion.div>
      )}
    </motion.div>
  );
}
