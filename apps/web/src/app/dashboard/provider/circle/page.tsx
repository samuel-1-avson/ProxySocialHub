"use client";
import Image from "next/image";
import { Modal } from "@/components/patterns/Modal";
import { DataError } from "@/components/workspace/Patterns";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleDot,
  Coins,
  Users,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle,
  PieChart,
  ArrowRight,
  Zap,
  ShieldCheck,
  Globe,
  Activity,
  Search,
  Lock,
  X,
  Compass,
} from "lucide-react";
import {
  getCircles,
  getCirclePoolStatus,
  getCircleRevenue,
  claimCircleRevenue,
  contributeBandwidth,
  circlePoolingKeys,
  getUtilizationLabel,
  type CirclePoolStatus,
} from "@/lib/api/circlePooling";
import {
  getCircles as getBrowsableCircles,
  createCircle,
  joinCircle,
  type Circle as BrowsableCircle,
} from "@/lib/api/circles";
import { useNotificationStore } from "@/stores";
import { GlassCard } from "@/components/ui/glass-card";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

interface ContributeModalProps {
  onClose: () => void;
  onSubmit: (data: { bandwidth_gb: number }) => void;
  isSubmitting: boolean;
  poolStatus?: CirclePoolStatus;
}

export default function CirclePoolingPage() {
  const { addNotification } = useNotificationStore();
  const queryClient = useQueryClient();
  const [chosenCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [contributeModalOpen, setContributeModalOpen] = useState(false);
  const [browseModalOpen, setBrowseModalOpen] = useState(false);

  // Fetch user's circles
  const {
    data: circles = [],
    isLoading: circlesLoading,
    error: sourceError,
    refetch: retrySource,
  } = useQuery({
    queryKey: circlePoolingKeys.circles(),
    queryFn: getCircles,
  });

  const selectedCircleId = chosenCircleId ?? circles[0]?.id ?? null;

  const selectedCircle = circles.find((c) => c.id === selectedCircleId);

  // Fetch pool status for selected circle
  const { data: poolStatus, isLoading: poolLoading } = useQuery({
    queryKey: circlePoolingKeys.status(selectedCircleId || ""),
    queryFn: () => getCirclePoolStatus(selectedCircleId!),
    enabled: !!selectedCircleId,
    refetchInterval: 15000,
  });

  // Fetch revenue for selected circle
  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: circlePoolingKeys.revenues(selectedCircleId || ""),
    queryFn: () => getCircleRevenue(selectedCircleId!),
    enabled: !!selectedCircleId,
  });

  const contributeMutation = useMutation({
    mutationFn: ({
      circleId,
      bandwidth,
    }: {
      circleId: string;
      bandwidth: number;
    }) => contributeBandwidth(circleId, { bandwidth_gb: bandwidth }),
    onSuccess: () => {
      addNotification({
        type: "success",
        title: "TELEMETRY SYNCED",
        message: "Bandwidth coupled to enterprise pool successfully.",
      });
      setContributeModalOpen(false);
      queryClient.invalidateQueries({ queryKey: circlePoolingKeys.all });
    },
    onError: (error: Error) => {
      addNotification({
        type: "error",
        title: "SYNC FAILED",
        message: error.message,
      });
    },
  });

  const claimRevenueMutation = useMutation({
    mutationFn: claimCircleRevenue,
    onSuccess: (data) => {
      addNotification({
        type: "success",
        title: "REVENUE ACCESSED",
        message: `${data.amount.toFixed(6)} SOL credited to your local balance.`,
      });
      queryClient.invalidateQueries({ queryKey: circlePoolingKeys.all });
    },
    onError: (error: Error) => {
      addNotification({
        type: "error",
        title: "ACCESS DENIED",
        message: error.message,
      });
    },
  });

  const handleCircleReady = (circleId: string) => {
    setSelectedCircleId(circleId);
    setBrowseModalOpen(false);
    queryClient.invalidateQueries({ queryKey: circlePoolingKeys.circles() });
  };

  const loading = circlesLoading || poolLoading || revenueLoading;

  if (sourceError)
    return (
      <div className="ui-page">
        <h1>Circle pools</h1>
        <DataError error={sourceError} retry={() => void retrySource()} />
      </div>
    );

  if (loading && circles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-40 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="font-mono text-xs font-semibold normal-case tracking-normal text-muted-foreground animate-pulse">
          Syncing Enterprise Pools...
        </p>
      </div>
    );
  }

  if (circles.length === 0) {
    return (
      <motion.div
        initial="hidden"
        animate="show"
        variants={containerVariants}
        className="space-y-8 pb-20"
      >
        <motion.div variants={itemVariants} className="text-center py-20">
          <GlassCard className="inline-block p-16 border-dashed border-border">
            <CircleDot
              size={48}
              className="mx-auto mb-6 text-muted-foreground animate-pulse"
            />
            <h3 className="text-xs font-semibold font-mono normal-case mb-2">
              No Active Circles Detected
            </h3>
            <p className="text-xs font-mono normal-case max-w-xs mx-auto font-semibold leading-relaxed mb-8 text-muted-foreground">
              Join a cryptographic pooling circle to start distributing
              enterprise bandwidth.
            </p>
            <button
              onClick={() => setBrowseModalOpen(true)}
              className="px-8 py-3 bg-primary text-primary-foreground rounded-xl text-xs font-semibold font-mono normal-case tracking-normal hover:brightness-110 transition-all flex items-center gap-2 mx-auto"
            >
              <Compass size={14} /> Browse Circles
            </button>
          </GlassCard>
        </motion.div>

        <AnimatePresence>
          {browseModalOpen && (
            <CircleBrowseModal
              onClose={() => setBrowseModalOpen(false)}
              existingCircleIds={circles.map((c) => c.id)}
              onCircleReady={handleCircleReady}
            />
          )}
        </AnimatePresence>
      </motion.div>
    );
  }


  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-12 pb-20"
    >
      {/* Header Section */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-8"
      >
        <div>
          <div className="flex items-center gap-2 text-primary font-mono text-xs font-semibold normal-case tracking-normal mb-1">
            <Activity size={12} className="animate-pulse" /> Revenue
            Distribution Network
          </div>
          <h1 className="text-4xl font-semibold font-mono normal-case tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
            Circle Pool
          </h1>
        </div>
        <div className="flex flex-wrap gap-4">
          {circles.length > 1 && (
            <div className="bg-muted p-1 rounded-xl border border-border flex items-center">
              <select
                value={selectedCircleId || ""}
                onChange={(e) => setSelectedCircleId(e.target.value)}
                className="bg-transparent border-0 outline-none px-4 py-2 font-mono text-xs font-semibold normal-case tracking-normal"
              >
                {circles.map((circle) => (
                  <option
                    key={circle.id}
                    value={circle.id}
                    className="bg-background text-foreground"
                  >
                    {circle.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={() => setBrowseModalOpen(true)}
            className="px-6 py-3 bg-muted border border-border rounded-xl text-xs font-semibold font-mono normal-case tracking-normal hover:bg-muted-foreground/10 transition-all flex items-center gap-2"
          >
            <Compass size={14} /> Browse Circles
          </button>
          <button
            onClick={() => setContributeModalOpen(true)}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-xs font-semibold font-mono normal-case tracking-normal hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-primary/20"
          >
            <Plus size={14} /> Contribute Bandwidth
          </button>
        </div>
      </motion.div>

      {/* Selected Circle Stats */}
      {selectedCircle && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-1 border-primary/20 bg-primary/5">
            <div className="flex flex-col md:flex-row items-center gap-8 p-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/40 shadow-lg shadow-primary/10">
                <CircleDot className="text-primary" size={32} />
              </div>
              <div className="flex-1 text-center md:text-left">
                <h2 className="text-xl font-semibold font-mono normal-case tracking-tight">
                  {selectedCircle.name}
                </h2>
                <div className="flex items-center justify-center md:justify-start gap-4 mt-1 opacity-40">
                  <span className="text-xs font-mono font-semibold normal-case tracking-normal flex items-center gap-1.5 whitespace-nowrap">
                    <Users size={12} /> {selectedCircle.member_count} Members
                  </span>
                  <span className="text-xs font-mono font-semibold normal-case tracking-normal flex items-center gap-1.5 whitespace-nowrap">
                    <Globe size={12} />{" "}
                    {selectedCircle.bandwidth_pool_gb.toFixed(0)} GB Committed
                  </span>
                </div>
              </div>
              <div
                className={`px-4 py-1.5 rounded-xl border font-mono text-xs font-semibold normal-case tracking-normal shadow-lg ${
                  selectedCircle.type === "enterprise"
                    ? "bg-purple-500/10 border-purple-500/20 text-purple-400 shadow-purple-500/5"
                    : selectedCircle.type === "private"
                      ? "bg-amber-500/10 border-amber-400/20 text-amber-400 shadow-amber-400/5"
                      : "bg-blue-500/10 border-blue-500/20 text-blue-400 shadow-blue-500/5"
                }`}
              >
                {selectedCircle.type} Tier
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pool Telemetry */}
        {poolStatus && (
          <motion.div variants={itemVariants}>
            <GlassCard className="p-8 h-full relative overflow-hidden group">
              <div className="absolute -right-12 -top-12 w-40 h-40 bg-emerald-500/10 blur-3xl rounded-full transition-opacity group-hover:opacity-20" />

              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-xs font-semibold font-mono normal-case tracking-normal flex items-center gap-2 mb-1">
                    <Activity
                      size={16}
                      className="text-primary animate-pulse"
                    />{" "}
                    Pool Telemetry
                  </h3>
                  <p className="text-xs font-mono font-semibold normal-case">
                    Real-time status monitor
                  </p>
                </div>
                <div
                  className={`px-4 py-1.5 rounded-xl border font-mono text-xs font-semibold normal-case tracking-normal transition-colors ${
                    poolStatus.utilization_percent > 80
                      ? "text-rose-400 border-rose-400/20 bg-rose-400/5"
                      : poolStatus.utilization_percent > 50
                        ? "text-amber-400 border-amber-400/20 bg-amber-400/5"
                        : "text-emerald-400 border-emerald-400/20 bg-emerald-400/5"
                  }`}
                >
                  {getUtilizationLabel(poolStatus.utilization_percent)} |{" "}
                  {poolStatus.utilization_percent.toFixed(1)}%
                </div>
              </div>

              <div className="space-y-8">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono font-semibold normal-case tracking-normal">
                    <span className="opacity-40">Utilization Overlay</span>
                    <span className="tabular-nums">
                      {poolStatus.used_capacity_gb.toFixed(1)} /{" "}
                      {poolStatus.total_capacity_gb.toFixed(0)} GB
                    </span>
                  </div>
                  <div className="h-3 bg-white/5 rounded-full border border-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${poolStatus.utilization_percent}%` }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                      className={`h-full relative overflow-hidden ${
                        poolStatus.utilization_percent > 80
                          ? "bg-rose-500"
                          : poolStatus.utilization_percent > 50
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 animate-shimmer" />
                    </motion.div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6 pt-6 border-t border-white/5">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold font-mono normal-case">
                      Remaining
                    </p>
                    <p className="text-xl font-semibold font-mono tracking-tighter tabular-nums">
                      {poolStatus.available_capacity_gb.toFixed(1)}GB
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold font-mono normal-case">
                      Nodes
                    </p>
                    <p className="text-xl font-semibold font-mono tracking-tighter tabular-nums">
                      {poolStatus.member_count}
                    </p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs font-semibold font-mono normal-case">
                      Live Streams
                    </p>
                    <p className="text-xl font-semibold font-mono tracking-tighter tabular-nums text-primary">
                      {poolStatus.active_session_count}
                    </p>
                  </div>
                </div>

                {poolStatus.is_enterprise_ready && (
                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center gap-3">
                    <ShieldCheck className="text-indigo-400" size={20} />
                    <div className="flex-1">
                      <p className="text-xs font-semibold font-mono normal-case text-indigo-400 tracking-normal">
                        Enterprise Integrity Verified
                      </p>
                      <p className="text-xs font-mono normal-case font-semibold">
                        Ready for high-concurrency contracts
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Economic Center */}
        {revenueData && (
          <motion.div variants={itemVariants}>
            <GlassCard className="p-8 h-full relative overflow-hidden group">
              <div className="absolute -right-12 -top-12 w-40 h-40 bg-amber-500/10 blur-3xl rounded-full transition-opacity group-hover:opacity-20" />

              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-xs font-semibold font-mono normal-case tracking-normal flex items-center gap-2 mb-1">
                    <Coins size={16} className="text-amber-400" /> Economic
                    Center
                  </h3>
                  <p className="text-xs font-mono font-semibold normal-case">
                    Revenue settlement engine
                  </p>
                </div>
                {revenueData.available > 0 && (
                  <button
                    onClick={() =>
                      selectedCircleId &&
                      claimRevenueMutation.mutate(selectedCircleId)
                    }
                    disabled={claimRevenueMutation.isPending}
                    className="px-6 py-2 bg-amber-500 text-primary-foreground rounded-xl text-xs font-semibold font-mono normal-case tracking-normal hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
                  >
                    {claimRevenueMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    Claim {revenueData.available.toFixed(6)} SOL
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-6 mb-8 pb-8 border-b border-white/5">
                <div className="space-y-1">
                  <p className="text-xs font-semibold font-mono normal-case">
                    Lifetime
                  </p>
                  <p className="text-xl font-semibold font-mono tracking-tighter tabular-nums text-emerald-400">
                    {revenueData.total_earned.toFixed(6)} SOL
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold font-mono normal-case">
                    Extracted
                  </p>
                  <p className="text-xl font-semibold font-mono tracking-tighter tabular-nums">
                    {revenueData.total_claimed.toFixed(6)} SOL
                  </p>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-xs font-semibold font-mono normal-case">
                    Floating
                  </p>
                  <p className="text-xl font-semibold font-mono tracking-tighter tabular-nums text-amber-400">
                    {revenueData.available.toFixed(6)} SOL
                  </p>
                </div>
              </div>

              <div className="space-y-3 max-h-[180px] overflow-y-auto pr-2 custom-scrollbar">
                {revenueData.revenues.length === 0 ? (
                  <div className="py-12 text-center">
                    <PieChart size={32} className="mx-auto mb-2" />
                    <p className="text-xs font-mono font-semibold normal-case">
                      Awaiting Settlement Cycles
                    </p>
                  </div>
                ) : (
                  revenueData.revenues.map((revenue) => (
                    <div
                      key={revenue.revenue_id}
                      className="p-4 bg-white/2 border border-white/5 rounded-2xl flex justify-between items-center group/item hover:bg-white/5 transition-all"
                    >
                      <div>
                        <p className="text-xs font-semibold font-mono normal-case">
                          {new Date(revenue.period_start).toLocaleDateString(
                            undefined,
                            { month: "short", year: "numeric" },
                          )}
                        </p>
                        <p className="text-xs font-mono font-semibold normal-case tracking-tighter">
                          {revenue.sessions_count} Sessions |{" "}
                          {revenue.provider_share_percent.toFixed(1)}%
                          Contribution
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold font-mono text-emerald-400">
                          {revenue.provider_revenue.toFixed(6)} SOL
                        </p>
                        <p className="text-xs font-semibold font-mono normal-case tracking-normal">
                          {revenue.status}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </div>

      {/* Member Registry */}
      {poolStatus?.members && poolStatus.members.length > 0 && (
        <motion.div variants={itemVariants}>
          <GlassCard className="p-8">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-blue-400">
                <Users size={20} />
              </div>
              <div>
                <h3 className="text-xs font-semibold font-mono normal-case tracking-normal">
                  Member Registry
                </h3>
                <p className="text-xs font-mono font-semibold normal-case">
                  Authorized sector participants
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {poolStatus.members.slice(0, 6).map((member) => (
                <div
                  key={member.provider_id}
                  className="p-5 bg-white/2 border border-white/5 rounded-2xl flex items-center gap-4 group/member hover:border-blue-500/20 transition-all"
                >
                  <div className="relative">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-border group-hover/member:border-blue-500/40 transition-all overflow-hidden">
                      {member.avatar_url ? (
                        <Image
                          width={40}
                          height={40}
                          unoptimized
                          src={member.avatar_url}
                          alt={member.provider_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Users size={24} className="text-muted-foreground" />
                      )}
                    </div>
                    {member.is_online && (
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#09090b] shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold font-mono normal-case truncate group-hover/member:text-blue-400 transition-colors">
                      {member.provider_name || "Anonymous Operator"}
                    </p>
                    <div className="flex items-center gap-3 mt-1 opacity-40">
                      <span className="text-xs font-mono font-semibold normal-case tracking-tighter">
                        {member.share_percent.toFixed(1)}% Share
                      </span>
                      <span className="text-xs font-mono font-semibold normal-case tracking-tighter group-hover/member:text-emerald-400 transition-all">
                        {member.revenue_earned.toFixed(6)} SOL total
                      </span>
                    </div>
                  </div>
                  <div className="p-2 bg-white/5 rounded-lg opacity-0 group-hover/member:opacity-100 transition-opacity">
                    <ArrowRight size={14} className="text-blue-400" />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {contributeModalOpen && selectedCircleId && (
          <ContributeModal
            onClose={() => setContributeModalOpen(false)}
            onSubmit={(data) =>
              contributeMutation.mutate({
                circleId: selectedCircleId,
                bandwidth: data.bandwidth_gb,
              })
            }
            isSubmitting={contributeMutation.isPending}
            poolStatus={poolStatus}
          />
        )}
        {browseModalOpen && (
          <CircleBrowseModal
            onClose={() => setBrowseModalOpen(false)}
            existingCircleIds={circles.map((c) => c.id)}
            onCircleReady={handleCircleReady}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ContributeModal({
  onClose,
  onSubmit,
  isSubmitting,
  poolStatus,
}: ContributeModalProps) {
  const [bandwidthGb, setBandwidthGb] = useState(100);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Contribute bandwidth"
      size="xl"
      contentClassName="record-family"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <GlassCard className="w-full max-w-md p-10 border-emerald-500/40 shadow-[0_0_50px_rgba(16,185,129,0.15)]">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-emerald-500/20 rounded-2xl border border-emerald-500/40 text-emerald-400">
              <Plus size={24} />
            </div>
            <div>
              <h3 className="text-xl font-semibold font-mono normal-case text-primary tracking-tighter">
                Pool Contribution
              </h3>
              <p className="text-xs font-mono normal-case text-muted-foreground tracking-normal">
                Add reported capacity to the pool
              </p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-end">
                <label className="text-xs font-semibold font-mono normal-case tracking-normal">
                  Required Capacity
                </label>
                <span className="text-2xl font-semibold font-mono tabular-nums tracking-tighter">
                  {bandwidthGb} <span className="text-xs">GB</span>
                </span>
              </div>
              <input
                type="range"
                aria-label="Bandwidth contribution in gigabytes"
                min="10"
                max="1000"
                step="10"
                value={bandwidthGb}
                onChange={(e) => setBandwidthGb(Number(e.target.value))}
                className="w-full h-2 bg-white/5 rounded-full appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div className="p-6 bg-primary/5 border border-primary/20 rounded-2xl shadow-lg relative overflow-hidden group">
              <div className="absolute inset-x-0 bottom-0 h-1 bg-primary/20" />
              <p className="text-xs font-semibold font-mono normal-case text-primary tracking-normal mb-1">
                Projected Reward Share
              </p>
              <p className="text-3xl font-semibold font-mono tracking-tighter tabular-nums">
                {poolStatus && poolStatus.total_capacity_gb > 0
                  ? (
                      (bandwidthGb /
                        (poolStatus.total_capacity_gb + bandwidthGb)) *
                      100
                    ).toFixed(1)
                  : "100"}
                <span className="text-sm ml-1">%</span>
              </p>
              <p className="text-xs font-mono normal-case font-semibold mt-2 tracking-tighter">
                Based on target pool saturation of{" "}
                {((poolStatus?.total_capacity_gb || 0) + bandwidthGb).toFixed(
                  0,
                )}{" "}
                GB
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={onClose}
                className="flex-1 py-4 bg-white/5 border border-border rounded-xl text-xs font-mono font-semibold normal-case tracking-normal hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => onSubmit({ bandwidth_gb: bandwidthGb })}
                disabled={isSubmitting}
                className="flex-1 py-4 bg-primary text-primary-foreground rounded-xl text-xs font-mono font-semibold normal-case tracking-normal hover:brightness-110 transition-all shadow-xl shadow-primary/20 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Contribute bandwidth"
                )}
              </button>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </Modal>
  );
}

interface CircleBrowseModalProps {
  onClose: () => void;
  existingCircleIds: string[];
  onCircleReady: (circleId: string) => void;
}

function CircleBrowseModal({
  onClose,
  existingCircleIds,
  onCircleReady,
}: CircleBrowseModalProps) {
  const { addNotification } = useNotificationStore();
  const [tab, setTab] = useState<"browse" | "create">("browse");
  const [form, setForm] = useState({
    name: "",
    description: "",
    visibility: "public" as "public" | "private",
  });

  const {
    data: browsableCircles = [],
    isLoading: browseLoading,
    error: browseError,
  } = useQuery({
    queryKey: ["circles-browse-public"],
    queryFn: getBrowsableCircles,
  });

  const joinMutation = useMutation({
    mutationFn: (circleId: string) => joinCircle(circleId),
    onSuccess: (_data, circleId) => {
      addNotification({
        type: "success",
        title: "CIRCLE JOINED",
        message: "You now have access to this pool.",
      });
      onCircleReady(circleId);
    },
    onError: (error: Error) => {
      addNotification({
        type: "error",
        title: "JOIN FAILED",
        message: error.message,
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createCircle({
        name: form.name.trim(),
        description: form.description.trim(),
        visibility: form.visibility,
      }),
    onSuccess: (circle) => {
      addNotification({
        type: "success",
        title: "CIRCLE CREATED",
        message: `${circle.name} is ready to receive contributions.`,
      });
      onCircleReady(circle.id);
    },
    onError: (error: Error) => {
      addNotification({
        type: "error",
        title: "CREATE FAILED",
        message: error.message,
      });
    },
  });

  const existingSet = new Set(existingCircleIds);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Circle directory"
      size="xl"
      contentClassName="record-family"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl"
      >
        <GlassCard className="p-8 border-primary/30 shadow-[0_0_50px_rgba(59,130,246,0.1)] max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 rounded-2xl border border-primary/30 text-primary">
                <Compass size={22} />
              </div>
              <div>
                <h3 className="text-lg font-semibold font-mono normal-case text-foreground tracking-tighter">
                  Circle Directory
                </h3>
                <p className="text-xs font-mono normal-case text-muted-foreground tracking-normal">
                  Browse or launch a pooling circle
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 bg-muted p-1 rounded-xl border border-border w-fit">
            <button
              onClick={() => setTab("browse")}
              className={`px-5 py-2 rounded-lg text-xs font-mono font-semibold normal-case tracking-normal transition-all ${
                tab === "browse"
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setTab("create")}
              className={`px-5 py-2 rounded-lg text-xs font-mono font-semibold normal-case tracking-normal transition-all ${
                tab === "create"
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Create Circle
            </button>
          </div>

          {tab === "browse" ? (
            <div className="space-y-3">
              {browseLoading ? (
                <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p className="text-xs font-mono font-semibold normal-case tracking-normal">
                    Scanning public circles...
                  </p>
                </div>
              ) : browseError ? (
                <div className="py-16 flex flex-col items-center gap-3 text-center">
                  <AlertCircle className="w-8 h-8 text-rose-400" />
                  <p className="text-xs font-mono font-semibold normal-case text-rose-400">
                    {(browseError as Error).message || "Failed to load circles"}
                  </p>
                </div>
              ) : browsableCircles.length === 0 ? (
                <div className="py-16 flex flex-col items-center gap-3 text-center text-muted-foreground">
                  <Search className="w-8 h-8 opacity-40" />
                  <p className="text-xs font-mono font-semibold normal-case tracking-normal">
                    No public circles available yet
                  </p>
                  <button
                    onClick={() => setTab("create")}
                    className="text-xs font-mono font-semibold normal-case text-primary hover:underline"
                  >
                    Create the first one
                  </button>
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
                  {browsableCircles.map((circle: BrowsableCircle) => {
                    const alreadyMember = existingSet.has(circle.id);
                    return (
                      <div
                        key={circle.id}
                        className="p-4 bg-muted/40 border border-border rounded-2xl flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold font-mono normal-case truncate">
                              {circle.name}
                            </p>
                            <span className="px-1.5 py-0.5 rounded bg-background border border-border text-xs font-semibold normal-case tracking-tighter text-muted-foreground flex items-center gap-1">
                              {circle.visibility === "private" ? (
                                <Lock size={8} />
                              ) : (
                                <Globe size={8} />
                              )}
                              {circle.visibility}
                            </span>
                          </div>
                          {circle.description && (
                            <p className="text-xs font-mono text-muted-foreground truncate mt-1">
                              {circle.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 text-xs font-mono font-semibold normal-case tracking-tighter text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users size={10} /> {circle.member_count}
                            </span>
                            <span className="flex items-center gap-1">
                              <Globe size={10} />{" "}
                              {circle.bandwidth_pool_gb?.toFixed?.(0) ?? 0} GB
                            </span>
                          </div>
                        </div>
                        {alreadyMember ? (
                          <span className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold font-mono normal-case tracking-normal text-emerald-500 border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-1.5">
                            <CheckCircle size={12} /> Joined
                          </span>
                        ) : (
                          <button
                            onClick={() => joinMutation.mutate(circle.id)}
                            disabled={joinMutation.isPending}
                            className="shrink-0 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-semibold font-mono normal-case tracking-normal hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {joinMutation.isPending &&
                            joinMutation.variables === circle.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Plus size={12} />
                            )}
                            Join
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.name.trim()) return;
                createMutation.mutate();
              }}
              className="space-y-5"
            >
              <div className="space-y-2">
                <label className="text-xs font-semibold font-mono normal-case tracking-normal text-muted-foreground">
                  Circle Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="e.g. West Coast Pool"
                  required
                  className="w-full bg-muted border border-border rounded-xl p-3 font-mono text-sm outline-none focus:border-primary/50 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold font-mono normal-case tracking-normal text-muted-foreground">
                  Description
                </label>
                <textarea
                  aria-label="Personal message"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="What is this circle for?"
                  rows={3}
                  className="w-full bg-muted border border-border rounded-xl p-3 font-mono text-sm outline-none focus:border-primary/50 transition-all resize-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold font-mono normal-case tracking-normal text-muted-foreground">
                  Visibility
                </label>
                <div className="flex bg-muted p-1.5 rounded-xl border border-border gap-2">
                  {(["public", "private"] as const).map((v) => (
                    <button
                      type="button"
                      key={v}
                      onClick={() => setForm((f) => ({ ...f, visibility: v }))}
                      className={`flex-1 py-2.5 rounded-lg text-xs font-mono font-semibold normal-case transition-all flex items-center justify-center gap-1.5 ${
                        form.visibility === v
                          ? "bg-primary text-primary-foreground shadow"
                          : "text-muted-foreground hover:bg-muted-foreground/10"
                      }`}
                    >
                      {v === "private" ? (
                        <Lock size={12} />
                      ) : (
                        <Globe size={12} />
                      )}
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={createMutation.isPending || !form.name.trim()}
                className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-xs font-mono font-semibold normal-case tracking-normal hover:brightness-110 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Launch Circle
              </button>
            </form>
          )}
        </GlassCard>
      </motion.div>
    </Modal>
  );
}
