"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/ui/glass-card";
import {
  getNodeDetail,
  formatSuccessRate,
  successRatePercent,
} from "@/lib/services/explorer";
import Link from "next/link";
import {
  ArrowLeft,
  Server,
  MapPin,
  Activity,
  Wifi,
  Download,
  Upload,
  Clock,
  Shield,
  Users,
  Cpu,
  Globe,
  CheckCircle,
  XCircle,
  Star,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ExplorerErrorState } from "@/components/explorer/ExplorerErrorState";

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export default function NodeDetailPage() {
  const params = useParams();
  const nodeId = params.id as string;

  const {
    data: node,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["node-detail", nodeId],
    queryFn: () => getNodeDetail(nodeId),
    refetchInterval: 30000,
  });

  if (error) {
    return (
      <ExplorerErrorState
        retry={() => void refetch()}
        error={error}
        entity="Node"
        backHref="/explorer/nodes"
        backLabel="Return to nodes"
      />
    );
  }

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
        <div className="flex items-center gap-4">
          <Link
            href="/explorer/nodes"
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors normal-case tracking-normal"
          >
            <ArrowLeft size={14} /> All Nodes
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal truncate max-w-[200px]">
            {nodeId}
          </span>
        </div>

        <GlassCard className="p-8 relative overflow-hidden border-border bg-card">
          <div className="absolute top-0 right-0 p-40 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
              <div className="flex items-start gap-4">
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${
                    node?.is_active
                      ? "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/20"
                      : "bg-muted shadow-none"
                  }`}
                >
                  {node?.is_validator ? (
                    <Shield
                      size={28}
                      className={
                        node?.is_active ? "text-white" : "text-muted-foreground"
                      }
                    />
                  ) : (
                    <Server
                      size={28}
                      className={
                        node?.is_active ? "text-white" : "text-muted-foreground"
                      }
                    />
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold text-primary normal-case tracking-normal mb-1">
                    Public records / Node
                  </div>
                  {isLoading ? (
                    <div className="h-8 w-64 bg-muted animate-pulse rounded" />
                  ) : (
                    <h1 className="text-2xl font-semibold text-foreground tracking-tighter break-all">
                      {node?.name || nodeId}
                    </h1>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {node?.is_validator && (
                      <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-primary/10 text-primary border border-primary/20 normal-case tracking-normal">
                        Validator
                      </span>
                    )}
                    {node && (
                      <span
                        className={`flex items-center gap-1 text-xs font-semibold normal-case tracking-normal ${
                          node.is_active
                            ? "text-emerald-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {node.is_active ? (
                          <>
                            <CheckCircle size={10} /> Online
                          </>
                        ) : (
                          <>
                            <XCircle size={10} /> Offline
                          </>
                        )}
                      </span>
                    )}
                    {node?.version && (
                      <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                        v{node.version}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quality Score */}
              {!isLoading && node && (
                <div className="text-right">
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-1">
                    Quality Score
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    <Star size={20} className="text-yellow-500" />
                    <span className="text-4xl font-semibold text-foreground tracking-tighter">
                      {(node.quality_score || 0).toFixed(1)}
                    </span>
                    <span className="text-lg text-muted-foreground">/100</span>
                  </div>
                  {node.last_heartbeat && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 justify-end">
                      <Clock size={9} />
                      {formatDistanceToNow(new Date(node.last_heartbeat), {
                        addSuffix: true,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      </motion.header>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-32 bg-card animate-pulse border border-border rounded-2xl"
            />
          ))}
        </div>
      ) : node ? (
        <>
          {/* Performance Metrics */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal px-2 flex items-center gap-2">
              <Activity size={10} /> Performance
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  label: "Uptime",
                  value: `${(node.uptime_percent || 0).toFixed(2)}%`,
                  icon: CheckCircle,
                  color:
                    node.uptime_percent > 95
                      ? "text-emerald-500"
                      : node.uptime_percent > 80
                        ? "text-yellow-500"
                        : "text-rose-500",
                },
                {
                  label: "Latency",
                  value: `${(node.latency_ms || 0).toFixed(0)} ms`,
                  icon: Zap,
                  color:
                    node.latency_ms < 50
                      ? "text-emerald-500"
                      : node.latency_ms < 150
                        ? "text-yellow-500"
                        : "text-rose-500",
                },
                {
                  label: "Success Rate",
                  value: formatSuccessRate(node.success_rate, 2),
                  icon: Star,
                  color:
                    successRatePercent(node.success_rate) > 95
                      ? "text-emerald-500"
                      : successRatePercent(node.success_rate) > 80
                        ? "text-yellow-500"
                        : "text-rose-500",
                },
                {
                  label: "Active Sessions",
                  value: (node.active_sessions || 0).toLocaleString(),
                  icon: Users,
                  color: "text-primary",
                },
              ].map((stat) => (
                <GlassCard
                  key={stat.label}
                  className="p-5 border-border bg-card"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <stat.icon size={12} className={stat.color} />
                    <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                      {stat.label}
                    </p>
                  </div>
                  <p
                    className={`text-2xl font-semibold tracking-tighter ${stat.color}`}
                  >
                    {stat.value}
                  </p>
                </GlassCard>
              ))}
            </div>
          </motion.section>

          {/* Bandwidth */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal px-2 flex items-center gap-2">
              <Wifi size={10} /> Bandwidth
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <GlassCard className="p-5 border-border bg-card">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                  Total Bandwidth
                </p>
                <p className="text-2xl font-semibold text-foreground tracking-tighter">
                  {(node.bandwidth_gb || 0).toFixed(2)}{" "}
                  <span className="text-lg text-muted-foreground">GB</span>
                </p>
              </GlassCard>
              <GlassCard className="p-5 border-border bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <Upload size={12} className="text-primary" />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                    Uploaded
                  </p>
                </div>
                <p className="text-2xl font-semibold text-foreground tracking-tighter">
                  {formatBytes(node.bytes_up || 0)}
                </p>
              </GlassCard>
              <GlassCard className="p-5 border-border bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <Download size={12} className="text-primary" />
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                    Downloaded
                  </p>
                </div>
                <p className="text-2xl font-semibold text-foreground tracking-tighter">
                  {formatBytes(node.bytes_down || 0)}
                </p>
              </GlassCard>
            </div>
          </motion.section>

          {/* Location & Network */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal px-2 flex items-center gap-2">
              <Globe size={10} /> Location & Network
            </h2>
            <GlassCard className="overflow-hidden border-border bg-card">
              <div className="divide-y divide-border">
                {[
                  {
                    label: "Country",
                    value: node.country || "—",
                    icon: MapPin,
                  },
                  { label: "Region", value: node.region || "—", icon: Globe },
                  { label: "City", value: node.city || "—", icon: MapPin },
                  { label: "ISP", value: node.isp || "—", icon: Wifi },
                  {
                    label: "Chain",
                    value: node.chain?.toUpperCase() || "SOLANA",
                    icon: Cpu,
                  },
                ].map((field) => (
                  <div
                    key={field.label}
                    className="flex items-center gap-6 px-8 py-4"
                  >
                    <div className="flex items-center gap-3 w-32 flex-shrink-0">
                      <field.icon size={12} className="text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground normal-case tracking-normal">
                        {field.label}
                      </span>
                    </div>
                    <span className="text-[12px] font-semibold text-foreground">
                      {field.value}
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.section>

          {/* Staking (validators only) */}
          {node.is_validator && (
            <motion.section variants={itemVariants} className="space-y-4">
              <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal px-2 flex items-center gap-2">
                <Shield size={10} /> Validator Info
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <GlassCard className="p-5 border-border bg-card">
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                    Stake Amount
                  </p>
                  <p className="text-2xl font-semibold text-foreground tracking-tighter">
                    {(node.stake_amount || 0).toLocaleString()}{" "}
                    <span className="text-lg text-muted-foreground">SOL</span>
                  </p>
                </GlassCard>
                <GlassCard className="p-5 border-border bg-card">
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                    Commission Rate
                  </p>
                  <p className="text-2xl font-semibold text-foreground tracking-tighter">
                    {((node.commission_rate || 0) * 100).toFixed(1)}
                    <span className="text-lg text-muted-foreground">%</span>
                  </p>
                </GlassCard>
              </div>
              {node.hotkey && (
                <GlassCard className="p-5 border-border bg-card">
                  <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                    Hotkey
                  </p>
                  <p className="font-mono text-xs text-primary break-all">
                    {node.hotkey}
                  </p>
                </GlassCard>
              )}
            </motion.section>
          )}

          {/* Sessions Summary */}
          <motion.section variants={itemVariants} className="space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground normal-case tracking-normal px-2 flex items-center gap-2">
              <Users size={10} /> Sessions
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <GlassCard className="p-5 border-border bg-card">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                  Active
                </p>
                <p className="text-3xl font-semibold text-emerald-500 tracking-tighter">
                  {(node.active_sessions || 0).toLocaleString()}
                </p>
              </GlassCard>
              <GlassCard className="p-5 border-border bg-card">
                <p className="text-xs font-semibold text-muted-foreground normal-case tracking-normal mb-2">
                  Total (All Time)
                </p>
                <p className="text-3xl font-semibold text-foreground tracking-tighter">
                  {(node.total_sessions || 0).toLocaleString()}
                </p>
              </GlassCard>
            </div>
          </motion.section>
        </>
      ) : null}
    </motion.div>
  );
}
