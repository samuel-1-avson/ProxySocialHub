"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    CircleDot,
    Wifi,
    DollarSign,
    Users,
    TrendingUp,
    Plus,
    Minus,
    Loader2,
    AlertCircle,
    CheckCircle,
    PieChart,
    ArrowRight,
    ChevronDown,
    Zap,
    ShieldCheck,
    Globe,
    Activity
} from "lucide-react";
import {
    getCircles,
    getCirclePoolStatus,
    getCircleRevenue,
    claimCircleRevenue,
    contributeBandwidth,
    circlePoolingKeys,
    getUtilizationColor,
    getUtilizationLabel,
    type CirclePoolStatus,
    type Circle,
} from "@/lib/api/circlePooling";
import { useNotificationStore } from "@/stores";
import { GlassCard } from "@/components/ui/glass-card";

const containerVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.1 }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
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
    const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
    const [contributeModalOpen, setContributeModalOpen] = useState(false);

    // Fetch user's circles
    const { data: circles = [], isLoading: circlesLoading } = useQuery({
        queryKey: circlePoolingKeys.circles(),
        queryFn: getCircles,
    });

    // Auto-select first circle if none selected
    React.useEffect(() => {
        if (circles.length > 0 && !selectedCircleId) {
            setSelectedCircleId(circles[0].id);
        }
    }, [circles, selectedCircleId]);

    const selectedCircle = circles.find(c => c.id === selectedCircleId);

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
        mutationFn: ({ circleId, bandwidth }: { circleId: string; bandwidth: number }) =>
            contributeBandwidth(circleId, { bandwidth_gb: bandwidth }),
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
                message: `$${data.amount.toFixed(2)} credited to your local balance.`,
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

    const loading = circlesLoading || poolLoading || revenueLoading;

    if (loading && circles.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">Syncing Enterprise Pools...</p>
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
                    <GlassCard className="inline-block p-16 border-dashed border-white/10 opacity-50">
                        <CircleDot size={48} className="mx-auto mb-6 text-muted-foreground animate-pulse" />
                        <h3 className="text-[11px] font-black font-mono uppercase mb-2">No Active Circles Detected</h3>
                        <p className="text-[9px] font-mono uppercase max-w-xs mx-auto font-black leading-relaxed mb-8">
                            Join a cryptographic pooling circle to start distributing enterprise bandwidth.
                        </p>
                        <button className="px-8 py-3 bg-primary text-primary-foreground rounded-xl text-[10px] font-black font-mono uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2 mx-auto">
                            <Plus size={14} /> Browse Circles
                        </button>
                    </GlassCard>
                </motion.div>
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
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Activity size={12} className="animate-pulse" /> Revenue Distribution Network
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
                        Circle Pool
                    </h1>
                </div>
                <div className="flex flex-wrap gap-4">
                    {circles.length > 1 && (
                        <div className="bg-white/5 p-1 rounded-xl border border-white/10 flex items-center">
                            <select
                                value={selectedCircleId || ""}
                                onChange={(e) => setSelectedCircleId(e.target.value)}
                                className="bg-transparent border-0 outline-none px-4 py-2 font-mono text-[10px] font-black uppercase tracking-widest"
                            >
                                {circles.map((circle) => (
                                    <option key={circle.id} value={circle.id} className="bg-[#09090b]">
                                        {circle.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <button
                        onClick={() => setContributeModalOpen(true)}
                        className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-[10px] font-black font-mono uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-primary/20"
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
                                <h2 className="text-xl font-black font-mono uppercase tracking-tight">{selectedCircle.name}</h2>
                                <div className="flex items-center justify-center md:justify-start gap-4 mt-1 opacity-40">
                                    <span className="text-[10px] font-mono font-black uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap">
                                        <Users size={12} /> {selectedCircle.member_count} Members
                                    </span>
                                    <span className="text-[10px] font-mono font-black uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap">
                                        <Globe size={12} /> {selectedCircle.bandwidth_pool_gb.toFixed(0)} GB Committed
                                    </span>
                                </div>
                            </div>
                            <div className={`px-4 py-1.5 rounded-xl border font-mono text-[10px] font-black uppercase tracking-[0.2em] shadow-lg ${
                                selectedCircle.type === 'enterprise' 
                                    ? 'bg-purple-500/10 border-purple-500/20 text-purple-400 shadow-purple-500/5' 
                                    : selectedCircle.type === 'private'
                                    ? 'bg-amber-500/10 border-amber-400/20 text-amber-400 shadow-amber-400/5'
                                    : 'bg-blue-500/10 border-blue-500/20 text-blue-400 shadow-blue-500/5'
                            }`}>
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
                                    <h3 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2 mb-1">
                                        <Activity size={16} className="text-primary animate-pulse" /> Pool Telemetry
                                    </h3>
                                    <p className="text-[10px] font-mono font-black uppercase opacity-30">Real-time status monitor</p>
                                </div>
                                <div className={`px-4 py-1.5 rounded-xl border font-mono text-[10px] font-black uppercase tracking-widest transition-colors ${
                                    poolStatus.utilization_percent > 80 ? 'text-rose-400 border-rose-400/20 bg-rose-400/5' :
                                    poolStatus.utilization_percent > 50 ? 'text-amber-400 border-amber-400/20 bg-amber-400/5' :
                                    'text-emerald-400 border-emerald-400/20 bg-emerald-400/5'
                                }`}>
                                    {getUtilizationLabel(poolStatus.utilization_percent)} | {poolStatus.utilization_percent.toFixed(1)}%
                                </div>
                            </div>

                            <div className="space-y-8">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-[10px] font-mono font-black uppercase tracking-widest">
                                        <span className="opacity-40">Utilization Overlay</span>
                                        <span className="tabular-nums">
                                            {poolStatus.used_capacity_gb.toFixed(1)} / {poolStatus.total_capacity_gb.toFixed(0)} GB
                                        </span>
                                    </div>
                                    <div className="h-3 bg-white/5 rounded-full border border-white/5 overflow-hidden">
                                        <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${poolStatus.utilization_percent}%` }}
                                            transition={{ duration: 1.5, ease: "easeOut" }}
                                            className={`h-full relative overflow-hidden ${
                                                poolStatus.utilization_percent > 80 ? 'bg-rose-500' :
                                                poolStatus.utilization_percent > 50 ? 'bg-amber-500' :
                                                'bg-emerald-500'
                                            }`}
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 animate-shimmer" />
                                        </motion.div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-6 pt-6 border-t border-white/5">
                                    <div className="space-y-1">
                                        <p className="text-[8px] font-black font-mono uppercase opacity-30">Remaining</p>
                                        <p className="text-xl font-black font-mono tracking-tighter tabular-nums">{poolStatus.available_capacity_gb.toFixed(1)}GB</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[8px] font-black font-mono uppercase opacity-30">Nodes</p>
                                        <p className="text-xl font-black font-mono tracking-tighter tabular-nums">{poolStatus.member_count}</p>
                                    </div>
                                    <div className="space-y-1 text-right">
                                        <p className="text-[8px] font-black font-mono uppercase opacity-30">Live Streams</p>
                                        <p className="text-xl font-black font-mono tracking-tighter tabular-nums text-primary">{poolStatus.active_session_count}</p>
                                    </div>
                                </div>

                                {poolStatus.is_enterprise_ready && (
                                    <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center gap-3">
                                        <ShieldCheck className="text-indigo-400" size={20} />
                                        <div className="flex-1">
                                            <p className="text-[10px] font-black font-mono uppercase text-indigo-400 tracking-wider">Enterprise Integrity Verified</p>
                                            <p className="text-[8px] font-mono uppercase font-black opacity-40">Ready for high-concurrency contracts</p>
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
                                    <h3 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2 mb-1">
                                        <DollarSign size={16} className="text-amber-400" /> Economic Center
                                    </h3>
                                    <p className="text-[10px] font-mono font-black uppercase opacity-30">Revenue settlement engine</p>
                                </div>
                                {revenueData.available > 0 && (
                                    <button
                                        onClick={() => selectedCircleId && claimRevenueMutation.mutate(selectedCircleId)}
                                        disabled={claimRevenueMutation.isPending}
                                        className="px-6 py-2 bg-amber-500 text-black rounded-xl text-[10px] font-black font-mono uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
                                    >
                                        {claimRevenueMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap size={14} />} 
                                        Claim ${revenueData.available.toFixed(2)}
                                    </button>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-6 mb-8 pb-8 border-b border-white/5">
                                <div className="space-y-1">
                                    <p className="text-[8px] font-black font-mono uppercase opacity-30">Lifetime</p>
                                    <p className="text-xl font-black font-mono tracking-tighter tabular-nums text-emerald-400">${revenueData.total_earned.toFixed(2)}</p>
                                </div>
                                <div className="space-y-1">
                                    <p className="text-[8px] font-black font-mono uppercase opacity-30">Extracted</p>
                                    <p className="text-xl font-black font-mono tracking-tighter tabular-nums opacity-60">${revenueData.total_claimed.toFixed(2)}</p>
                                </div>
                                <div className="space-y-1 text-right">
                                    <p className="text-[8px] font-black font-mono uppercase opacity-30">Floating</p>
                                    <p className="text-xl font-black font-mono tracking-tighter tabular-nums text-amber-400">${revenueData.available.toFixed(2)}</p>
                                </div>
                            </div>

                            <div className="space-y-3 max-h-[180px] overflow-y-auto pr-2 custom-scrollbar">
                                {revenueData.revenues.length === 0 ? (
                                    <div className="py-12 text-center opacity-20">
                                        <PieChart size={32} className="mx-auto mb-2" />
                                        <p className="text-[9px] font-mono font-black uppercase">Awaiting Settlement Cycles</p>
                                    </div>
                                ) : (
                                    revenueData.revenues.map((revenue) => (
                                        <div key={revenue.revenue_id} className="p-4 bg-white/2 border border-white/5 rounded-2xl flex justify-between items-center group/item hover:bg-white/5 transition-all">
                                            <div>
                                                <p className="text-[10px] font-black font-mono uppercase">{new Date(revenue.period_start).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p>
                                                <p className="text-[8px] font-mono font-black uppercase tracking-tighter opacity-30">
                                                    {revenue.sessions_count} Sessions | {revenue.provider_share_percent.toFixed(1)}% Contribution
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[11px] font-black font-mono text-emerald-400">${revenue.provider_revenue.toFixed(2)}</p>
                                                <p className="text-[8px] font-black font-mono uppercase opacity-30 tracking-widest">{revenue.status}</p>
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
                                <h3 className="text-xs font-black font-mono uppercase tracking-[0.2em]">Member Registry</h3>
                                <p className="text-[10px] font-mono font-black uppercase opacity-30">Authorized sector participants</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {poolStatus.members.slice(0, 6).map((member) => (
                                <div key={member.provider_id} className="p-5 bg-white/2 border border-white/5 rounded-2xl flex items-center gap-4 group/member hover:border-blue-500/20 transition-all">
                                    <div className="relative">
                                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 group-hover/member:border-blue-500/40 transition-all overflow-hidden">
                                            {member.avatar_url ? (
                                                <img src={member.avatar_url} alt={member.provider_name} className="w-full h-full object-cover" />
                                            ) : (
                                                <Users size={24} className="text-muted-foreground opacity-20" />
                                            )}
                                        </div>
                                        {member.is_online && (
                                            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#09090b] shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-black font-mono uppercase truncate group-hover/member:text-blue-400 transition-colors">{member.provider_name || 'Anonymous Operator'}</p>
                                        <div className="flex items-center gap-3 mt-1 opacity-40">
                                            <span className="text-[8px] font-mono font-black uppercase tracking-tighter">{member.share_percent.toFixed(1)}% Share</span>
                                            <span className="text-[8px] font-mono font-black uppercase tracking-tighter group-hover/member:text-emerald-400 transition-all">${member.revenue_earned.toFixed(2)} total</span>
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
                            contributeMutation.mutate({ circleId: selectedCircleId, bandwidth: data.bandwidth_gb })
                        }
                        isSubmitting={contributeMutation.isPending}
                        poolStatus={poolStatus}
                    />
                )}
            </AnimatePresence>
        </motion.div>
    );
}

function ContributeModal({ onClose, onSubmit, isSubmitting, poolStatus }: ContributeModalProps) {
    const [bandwidthGb, setBandwidthGb] = useState(100);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4"
            onClick={onClose}
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
                            <h3 className="text-xl font-black font-mono uppercase text-primary tracking-tighter">Pool Contribution</h3>
                            <p className="text-[9px] font-mono uppercase text-muted-foreground tracking-widest opacity-40">Injecting sector bandwidth</p>
                        </div>
                    </div>

                    <div className="space-y-8">
                        <div className="space-y-4">
                            <div className="flex justify-between items-end">
                                <label className="text-[9px] font-black font-mono uppercase tracking-[0.2em] opacity-40">Required Capacity</label>
                                <span className="text-2xl font-black font-mono tabular-nums tracking-tighter">{bandwidthGb} <span className="text-[10px] opacity-20">GB</span></span>
                            </div>
                            <input
                                type="range"
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
                            <p className="text-[10px] font-black font-mono uppercase text-primary tracking-widest mb-1">Projected Reward Share</p>
                            <p className="text-3xl font-black font-mono tracking-tighter tabular-nums">
                                {poolStatus && poolStatus.total_capacity_gb > 0
                                    ? ((bandwidthGb / (poolStatus.total_capacity_gb + bandwidthGb)) * 100).toFixed(1)
                                    : "100"}<span className="text-sm opacity-20 ml-1">%</span>
                            </p>
                            <p className="text-[8px] font-mono uppercase font-black opacity-30 mt-2 tracking-tighter">Based on target pool saturation of {((poolStatus?.total_capacity_gb || 0) + bandwidthGb).toFixed(0)} GB</p>
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={onClose}
                                className="flex-1 py-4 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                            >
                                ABORT
                            </button>
                            <button
                                onClick={() => onSubmit({ bandwidth_gb: bandwidthGb })}
                                disabled={isSubmitting}
                                className="flex-1 py-4 bg-primary text-primary-foreground rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:brightness-110 transition-all shadow-xl shadow-primary/20 disabled:opacity-50"
                            >
                                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "ESTABLISH SYNC"}
                            </button>
                        </div>
                    </div>
                </GlassCard>
            </motion.div>
        </motion.div>
    );
}
