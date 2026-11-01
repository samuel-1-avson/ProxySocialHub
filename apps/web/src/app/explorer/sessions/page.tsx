"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/glass-card";
import {
  getExplorerSessions,
  isExplorerNotFound,
} from "@/lib/services/explorer";
import { explorerPublicSessionsEnabled } from "@/lib/navigation/explorer-nav";
import Link from "next/link";
import {
  ArrowLeft,
  Radio,
  Clock,
  Filter,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  Loader,
  Activity,
  Download,
} from "lucide-react";

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const content = [headers, ...rows]
    .map((r) =>
      r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; label: string; icon: typeof CheckCircle }
> = {
  active: {
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    label: "Active",
    icon: CheckCircle,
  },
  terminated: {
    color: "text-rose-400",
    bg: "bg-rose-400/10",
    label: "Terminated",
    icon: XCircle,
  },
  disabled: {
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    label: "Disabled",
    icon: Loader,
  },
};

const TYPE_CONFIG: Record<string, { color: string; bg: string }> = {
  rotating: { color: "text-blue-400", bg: "bg-blue-400/10" },
  sticky: { color: "text-purple-400", bg: "bg-purple-400/10" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || {
    color: "text-muted-foreground",
    bg: "bg-muted",
    label: status,
    icon: Activity,
  };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${cfg.color} ${cfg.bg} px-2 py-1 rounded-lg normal-case tracking-normal`}
    >
      <Icon size={8} /> {cfg.label}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(3)} GB`;
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

export default function SessionsPage() {
  const sessionsApiEnabled = explorerPublicSessionsEnabled();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const pageSize = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["explorer-sessions", page, statusFilter, typeFilter],
    queryFn: () =>
      getExplorerSessions(page, pageSize, statusFilter, typeFilter),
    enabled: sessionsApiEnabled,
    refetchInterval: sessionsApiEnabled ? 15000 : false,
    retry: false,
  });

  const sessions = data?.sessions || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const sessionsFeedDisabled =
    !sessionsApiEnabled || Boolean(error && isExplorerNotFound(error));

  const handleExport = () => {
    if (!sessions.length) return;
    const headers = [
      "session_id",
      "type",
      "status",
      "bytes_used",
      "start_time",
      "end_time",
    ];
    const rows = sessions.map((s) => [
      s.session_id ?? "",
      s.session_type ?? "",
      s.status ?? "",
      String(s.bytes_used ?? 0),
      s.start_time ?? "",
      s.end_time ?? "",
    ]);
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadCsv(`sessions_${dateTag}.csv`, headers, rows);
  };

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
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
          <div>
            <div className="text-xs font-semibold text-primary normal-case tracking-normal mb-1">
              Public records / Sessions
            </div>
            <h1 className="text-4xl font-semibold normal-case tracking-tighter text-foreground flex items-center gap-4">
              <Radio className="text-primary" size={32} /> Session Explorer
            </h1>
            <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mt-2">
              Live and historical proxy session data
            </p>
          </div>
          <div className="flex gap-3">
            {[
              { label: "Total", value: total, color: "text-foreground" },
              {
                label: "Active Now",
                value: data?.active_count ?? activeCount,
                color: "text-emerald-400",
              },
            ].map((s) => (
              <GlassCard
                key={s.label}
                className="!p-4 border-border bg-card rounded-2xl text-center"
              >
                <div className={`text-xl font-semibold ${s.color}`}>
                  {s.value}
                </div>
                <div className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mt-0.5">
                  {s.label}
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      </motion.header>

      {/* Filter Bar */}
      {!sessionsFeedDisabled && (
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-center gap-3"
        >
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold normal-case tracking-normal border transition-all ${showFilters ? "bg-primary/10 border-primary/20 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"}`}
          >
            <Filter size={10} /> Filters
          </button>
          {showFilters && (
            <>
              <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-1">
                {["", "active", "terminated", "disabled"].map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setStatusFilter(s);
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold normal-case tracking-normal transition-all ${statusFilter === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {s || "All Status"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-1">
                {["", "rotating", "sticky"].map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTypeFilter(t);
                      setPage(1);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold normal-case tracking-normal transition-all ${typeFilter === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t || "All Types"}
                  </button>
                ))}
              </div>
            </>
          )}
          {(statusFilter || typeFilter) && (
            <button
              onClick={() => {
                setStatusFilter("");
                setTypeFilter("");
                setPage(1);
              }}
              className="text-xs font-semibold text-rose-400 normal-case tracking-normal hover:text-rose-300 transition-colors"
            >
              ✕ Clear Filters
            </button>
          )}
          <span className="ml-auto text-xs font-semibold text-muted-foreground normal-case tracking-normal">
            {total.toLocaleString()} sessions
          </span>
          <button
            onClick={handleExport}
            disabled={!sessions.length}
            title="Export current page as CSV"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-muted border border-border text-xs font-semibold normal-case tracking-normal text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          >
            <Download size={10} /> CSV
          </button>
        </motion.div>
      )}

      {/* Sessions Table */}
      <motion.section variants={itemVariants}>
        <GlassCard className="overflow-hidden border-border bg-card rounded-2xl">
          {isLoading ? (
            <div className="space-y-0 divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse bg-card" />
              ))}
            </div>
          ) : sessionsFeedDisabled ? (
            <div className="py-20 text-center max-w-md mx-auto">
              <Radio size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                Public session feed disabled
              </p>
              <p className="text-xs font-bold text-muted-foreground leading-relaxed">
                This deployment does not expose live session telemetry on the
                public explorer. Operators can enable it with{" "}
                <span className="text-primary/80">
                  EXPLORER_PUBLIC_SESSIONS_ENABLED
                </span>
                .
              </p>
              <Link
                href="/explorer"
                className="inline-flex items-center gap-2 mt-6 text-xs font-semibold text-primary normal-case tracking-normal hover:text-primary/80 transition-colors"
              >
                <ArrowLeft size={10} /> Explorer overview
              </Link>
            </div>
          ) : error ? (
            <div className="py-20 text-center">
              <Radio size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                Session data unavailable
              </p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-20 text-center">
              <Radio size={48} className="text-muted-foreground mx-auto mb-4" />
              <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                No sessions found
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted text-muted-foreground text-xs normal-case tracking-normal font-semibold">
                      <th className="px-6 py-4">Session ID</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Bandwidth Used</th>
                      <th className="px-6 py-4 text-right">Duration</th>
                      <th className="px-6 py-4">Started</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sessions.map((s) => {
                      const typeCfg = TYPE_CONFIG[s.session_type] || {
                        color: "text-muted-foreground",
                        bg: "bg-muted",
                      };
                      const start = s.start_time
                        ? new Date(s.start_time)
                        : null;
                      // For active sessions, use server-provided end_time or show "Active"
                      // Avoid re-computing with new Date() on every render
                      const isActive = s.status === "active";
                      const end = s.end_time ? new Date(s.end_time) : null;
                      const durationMs =
                        start && end ? end.getTime() - start.getTime() : 0;
                      const durationMin = Math.floor(durationMs / 60000);
                      return (
                        <tr
                          key={s.session_id}
                          className="hover:bg-surface-hover transition-colors"
                        >
                          <td className="px-6 py-4">
                            <span className="font-mono text-primary text-xs font-bold">
                              {s.session_id?.slice(0, 8)}...
                              {s.session_id?.slice(-6)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`text-xs font-semibold px-2 py-1 rounded-md normal-case ${typeCfg.color} ${typeCfg.bg}`}
                            >
                              {s.session_type || "—"}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status={s.status} />
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-xs font-semibold text-foreground">
                            {formatBytes(s.bytes_used || 0)}
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-xs font-semibold text-muted-foreground">
                            {isActive ? (
                              <span className="text-emerald-400">Active</span>
                            ) : durationMin > 0 ? (
                              `${durationMin}m`
                            ) : (
                              "<1m"
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Clock size={9} />
                              {start
                                ? formatDistanceToNow(start, {
                                    addSuffix: true,
                                  })
                                : "—"}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-border">
                <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                  Page {page} of {totalPages || 1}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-primary hover:border-primary/20 disabled:opacity-30 text-xs font-semibold normal-case tracking-normal transition-all"
                  >
                    <ChevronLeft size={10} /> Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-primary hover:border-primary/20 disabled:opacity-30 text-xs font-semibold normal-case tracking-normal transition-all"
                  >
                    Next <ChevronRight size={10} />
                  </button>
                </div>
              </div>
            </>
          )}
        </GlassCard>
      </motion.section>
    </motion.div>
  );
}
