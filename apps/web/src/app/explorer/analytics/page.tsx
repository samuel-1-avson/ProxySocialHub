'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import {
    getExplorerMetrics,
    getNodes,
    getAnalytics,
    getLeaderboard,
} from '@/lib/services/explorer';
import Link from 'next/link';
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
} from 'recharts';
import {
    ArrowLeft,
    BarChart2,
    TrendingUp,
    Zap,
    Server,
    Trophy,
    Shield,
    Cloud,
    Star,
    Activity,
    Globe,
    Calendar,
    X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

const PERIODS = [
    { label: '1H', value: '1h' },
    { label: '24H', value: '24h' },
    { label: '7D', value: '7d' },
    { label: '30D', value: '30d' },
];

const LEADERBOARD_CATEGORIES = [
    { label: 'Uptime', value: 'uptime', icon: Activity },
    { label: 'Bandwidth', value: 'bandwidth', icon: Zap },
    { label: 'Sessions', value: 'sessions', icon: Server },
];

const PIE_COLORS = ['#6366f1', '#22d3ee', '#10b981', '#f59e0b', '#f43f5e', '#a855f7'];

function ChartTooltip({ active, payload, label, unit = '' }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-black/90 border border-white/10 rounded-xl p-3 text-[10px] font-mono font-black uppercase tracking-wider">
            <div className="text-white/40 mb-1">{label}</div>
            {payload.map((p: any, i: number) => (
                <div key={i} style={{ color: p.color }} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
                    {p.name}: <span className="text-white">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{unit}</span>
                </div>
            ))}
        </div>
    );
}

function EmptyChart({ height, label }: { height: number; label?: string }) {
    return (
        <div className={`flex flex-col items-center justify-center bg-white/[0.01] border border-dashed border-white/5 rounded-xl`} style={{ height }}>
            <BarChart2 size={24} className="text-white/10 mb-2" />
            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest">{label || 'No data yet'}</p>
        </div>
    );
}

// Returns today's date as "YYYY-MM-DD" in local time
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AnalyticsPage() {
    const [period, setPeriod] = useState('24h');
    const [leaderboardCategory, setLeaderboardCategory] = useState('uptime');
    const [mounted, setMounted] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [appliedFrom, setAppliedFrom] = useState('');
    const [appliedTo, setAppliedTo] = useState('');
    useEffect(() => { setMounted(true); }, []);

    const isCustomActive = !!(appliedFrom && appliedTo);

    const applyCustomRange = () => {
        if (!customFrom || !customTo || customFrom > customTo) return;
        setAppliedFrom(customFrom);
        setAppliedTo(customTo);
        setShowDatePicker(false);
    };

    const clearCustomRange = () => {
        setAppliedFrom('');
        setAppliedTo('');
        setCustomFrom('');
        setCustomTo('');
    };

    const { data: metrics } = useQuery({
        queryKey: ['explorer-metrics', 'all'],
        queryFn: () => getExplorerMetrics('all'),
        refetchInterval: 30000,
    });

    const { data: nodesData } = useQuery({
        queryKey: ['nodes-analytics'],
        queryFn: () => getNodes(1, 50, true),
        refetchInterval: 60000,
    });

    const { data: analytics, isLoading: loadingAnalytics } = useQuery({
        queryKey: ['analytics', period, appliedFrom, appliedTo],
        queryFn: () => getAnalytics(period, appliedFrom || undefined, appliedTo || undefined),
        refetchInterval: isCustomActive ? 0 : 60000,
        retry: false,
    });

    const { data: leaderboard, isLoading: loadingLeaderboard, error: leaderboardError } = useQuery({
        queryKey: ['leaderboard', leaderboardCategory, period],
        queryFn: () => getLeaderboard(leaderboardCategory, period),
        retry: false,
    });

    // Map real AnalyticsPoint[] to chart-friendly format
    const formatTime = (ts: string) => {
        try {
            if (isCustomActive) {
                const days = Math.round((new Date(appliedTo).getTime() - new Date(appliedFrom).getTime()) / 86400000);
                return format(new Date(ts), days <= 2 ? 'HH:mm' : 'MMM d');
            }
            return format(new Date(ts), period === '30d' || period === '7d' ? 'MMM d' : 'HH:mm');
        }
        catch { return ts; }
    };

    const volumeData = (analytics?.transaction_volume || []).map(p => ({
        t: formatTime(p.timestamp),
        value: p.value,
    }));
    const bandwidthData = (analytics?.bandwidth_gb || []).map(p => ({
        t: formatTime(p.timestamp),
        value: p.value,
    }));
    const nodeData = (analytics?.active_nodes || []).map(p => ({
        t: formatTime(p.timestamp),
        value: p.value,
    }));

    // Region distribution from real metrics
    const regionMap = metrics?.region_distribution || {};
    const regionData = Object.entries(regionMap).map(([name, value]) => ({ name, value: value as number }));

    // Leaderboard: prefer API response, fall back to sorted nodes (no random data)
    const nodes = nodesData?.nodes || [];
    const localLeaderboard = [...nodes].sort((a: any, b: any) => {
        if (leaderboardCategory === 'uptime') return (b.uptime_percent || 0) - (a.uptime_percent || 0);
        if (leaderboardCategory === 'bandwidth') return (b.bandwidth_gb || 0) - (a.bandwidth_gb || 0);
        return (b.active_sessions || 0) - (a.active_sessions || 0);
    }).slice(0, 10).map((n, i) => ({ ...n, rank: i + 1 }));

    const usingLocalLeaderboard = !leaderboard?.entries?.length && localLeaderboard.length > 0 && !!leaderboardError;
    const displayLeaderboard = leaderboard?.entries?.length ? leaderboard.entries : localLeaderboard;

    const containerVariants = {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.08 } },
    };
    const itemVariants = {
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0 },
    };

    const getRankIcon = (rank: number) => {
        if (rank === 1) return <Trophy size={14} className="text-yellow-400" />;
        if (rank === 2) return <Star size={14} className="text-slate-300" />;
        if (rank === 3) return <Star size={14} className="text-amber-600" />;
        return <span className="text-[10px] font-black text-white/20">#{rank}</span>;
    };

    const getLeaderboardValue = (node: any) => {
        if (leaderboardCategory === 'uptime') return `${(node.uptime_percent || 0).toFixed(2)}%`;
        if (leaderboardCategory === 'bandwidth') return `${(node.bandwidth_gb || 0).toFixed(2)} GB`;
        return `${node.active_sessions || 0} sessions`;
    };

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-10 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>

                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Analytics</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <BarChart2 className="text-primary" size={32} />
                            Network Analytics
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Historical performance, throughput, and node intelligence
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                            {/* Preset buttons — dimmed when custom range is active */}
                            <div className={`flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-2xl p-1.5 transition-opacity ${isCustomActive ? 'opacity-30 pointer-events-none' : ''}`}>
                                {PERIODS.map((p) => (
                                    <button
                                        key={p.value}
                                        onClick={() => { setPeriod(p.value); clearCustomRange(); }}
                                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${period === p.value && !isCustomActive ? 'bg-primary text-black' : 'text-white/30 hover:text-white/60'}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {/* Custom date range toggle */}
                            <button
                                onClick={() => setShowDatePicker(v => !v)}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all ${isCustomActive ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60'}`}
                            >
                                <Calendar size={12} />
                                {isCustomActive ? `${appliedFrom} → ${appliedTo}` : 'Custom'}
                            </button>
                            {isCustomActive && (
                                <button onClick={clearCustomRange} className="p-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/30 hover:text-rose-400 hover:border-rose-500/30 transition-all">
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        {/* Date picker panel */}
                        {showDatePicker && (
                            <div className="flex items-end gap-3 bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[8px] font-black text-white/30 uppercase tracking-widest">From</label>
                                    <input
                                        type="date"
                                        value={customFrom}
                                        max={customTo || todayStr()}
                                        onChange={e => setCustomFrom(e.target.value)}
                                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-mono text-white focus:outline-none focus:border-primary/50 [color-scheme:dark]"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[8px] font-black text-white/30 uppercase tracking-widest">To</label>
                                    <input
                                        type="date"
                                        value={customTo}
                                        min={customFrom}
                                        max={todayStr()}
                                        onChange={e => setCustomTo(e.target.value)}
                                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-mono text-white focus:outline-none focus:border-primary/50 [color-scheme:dark]"
                                    />
                                </div>
                                <button
                                    onClick={applyCustomRange}
                                    disabled={!customFrom || !customTo || customFrom > customTo}
                                    className="px-4 py-1.5 rounded-lg bg-primary text-black text-[9px] font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-primary/90 transition-all"
                                >
                                    Apply
                                </button>
                                <button onClick={() => setShowDatePicker(false)} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </motion.header>

            {/* Summary Stats */}
            <motion.section variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Avg TPS', value: metrics ? `${metrics.transactions_per_second.toFixed(2)}` : '—', icon: Activity, color: 'text-primary' },
                    { label: 'Total Volume', value: metrics ? `${metrics.total_volume.toFixed(1)} SOL` : '—', icon: TrendingUp, color: 'text-emerald-500' },
                    { label: 'Bandwidth Served', value: metrics ? `${metrics.total_bandwidth_gb.toFixed(1)} GB` : '—', icon: Zap, color: 'text-yellow-500' },
                    { label: 'Active Wallets', value: metrics ? metrics.active_wallets.toLocaleString() : '—', icon: Globe, color: 'text-blue-500' },
                ].map((stat, i) => (
                    <GlassCard key={i} className="!p-5 border-white/5 bg-white/[0.01] rounded-[1.5rem]">
                        <stat.icon size={16} className={`${stat.color} mb-3 opacity-60`} />
                        <div className="text-2xl font-black text-white tracking-tighter">{stat.value}</div>
                        <div className="text-[9px] font-black uppercase text-white/20 tracking-[0.2em] mt-1">{stat.label}</div>
                    </GlassCard>
                ))}
            </motion.section>

            {/* Charts Row */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <motion.section variants={itemVariants}>
                    <GlassCard className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem]">
                        <div className="mb-6">
                            <h3 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2">
                                <TrendingUp size={14} className="text-primary" /> Transaction Volume
                            </h3>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1">SOL settled on-chain</p>
                        </div>
                        {loadingAnalytics ? (
                            <div className="h-[180px] animate-pulse bg-white/5 rounded-xl" />
                        ) : !mounted || volumeData.length === 0 ? (
                            <EmptyChart height={180} label="Awaiting indexed data" />
                        ) : (
                            <ResponsiveContainer width="100%" height={180}>
                                <AreaChart data={volumeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <defs>
                                        <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                    <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                    <Tooltip content={<ChartTooltip unit=" SOL" />} />
                                    <Area type="monotone" dataKey="value" name="Volume" stroke="#6366f1" strokeWidth={2} fill="url(#volGrad)" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </GlassCard>
                </motion.section>

                <motion.section variants={itemVariants}>
                    <GlassCard className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem]">
                        <div className="mb-6">
                            <h3 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2">
                                <Zap size={14} className="text-yellow-500" /> Bandwidth Throughput
                            </h3>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1">GB proxied through network</p>
                        </div>
                        {loadingAnalytics ? (
                            <div className="h-[180px] animate-pulse bg-white/5 rounded-xl" />
                        ) : !mounted || bandwidthData.length === 0 ? (
                            <EmptyChart height={180} label="Awaiting indexed data" />
                        ) : (
                            <ResponsiveContainer width="100%" height={180}>
                                <AreaChart data={bandwidthData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <defs>
                                        <linearGradient id="bwGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                    <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                    <Tooltip content={<ChartTooltip unit=" GB" />} />
                                    <Area type="monotone" dataKey="value" name="Bandwidth" stroke="#eab308" strokeWidth={2} fill="url(#bwGrad)" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </GlassCard>
                </motion.section>
            </div>

            {/* Active Nodes Chart + Region Pie */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                <motion.section variants={itemVariants} className="xl:col-span-2">
                    <GlassCard className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem]">
                        <div className="mb-6">
                            <h3 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2">
                                <Server size={14} className="text-blue-500" /> Active Relay Nodes
                            </h3>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1">Node count over time</p>
                        </div>
                        {loadingAnalytics ? (
                            <div className="h-[160px] animate-pulse bg-white/5 rounded-xl" />
                        ) : !mounted || nodeData.length === 0 ? (
                            <EmptyChart height={160} label="Awaiting indexed data" />
                        ) : (
                            <ResponsiveContainer width="100%" height={160}>
                                <BarChart data={nodeData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                    <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Bar dataKey="value" name="Nodes" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </GlassCard>
                </motion.section>

                <motion.section variants={itemVariants}>
                    <GlassCard className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem] h-full flex flex-col">
                        <div className="mb-4">
                            <h3 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2">
                                <Globe size={14} className="text-emerald-500" /> Region Split
                            </h3>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1">Nodes by region</p>
                        </div>
                        {!mounted || regionData.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <Globe size={40} className="text-white/5 mx-auto mb-3" />
                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">No region data</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 flex items-center justify-center">
                                    <ResponsiveContainer width="100%" height={140}>
                                        <PieChart>
                                            <Pie data={regionData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                                                {regionData.map((_, i) => (
                                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip content={<ChartTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="space-y-1.5 mt-2">
                                    {regionData.slice(0, 5).map((r, i) => (
                                        <div key={r.name} className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                                <span className="text-white/50">{r.name}</span>
                                            </div>
                                            <span className="text-white">{r.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </GlassCard>
                </motion.section>
            </div>

            {/* Leaderboard */}
            <motion.section variants={itemVariants}>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                            <Trophy size={18} className="text-yellow-400" /> Node Leaderboard
                        </h2>
                        <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-1">Top performers ranked by category</p>
                    </div>
                    <div className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-2xl p-1.5">
                        {LEADERBOARD_CATEGORIES.map((cat) => (
                            <button
                                key={cat.value}
                                onClick={() => setLeaderboardCategory(cat.value)}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${leaderboardCategory === cat.value ? 'bg-primary text-black' : 'text-white/30 hover:text-white/60'}`}
                            >
                                <cat.icon size={10} /> {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                {usingLocalLeaderboard && (
                    <div className="mb-3 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-widest">
                        <span className="text-amber-500">⚠</span> Leaderboard API unavailable — showing locally-sorted node data
                    </div>
                )}
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01]">
                    {loadingLeaderboard ? (
                        <div className="space-y-0 divide-y divide-white/5">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-14 animate-pulse bg-white/[0.01]" />
                            ))}
                        </div>
                    ) : displayLeaderboard.length === 0 ? (
                        <div className="py-20 text-center">
                            <Trophy size={48} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">No nodes registered yet</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {displayLeaderboard.map((node: any, i: number) => {
                                const rank = node.rank ?? i + 1;
                                return (
                                    <Link key={node.node_id} href={`/explorer/nodes/${node.node_id}`} className="flex items-center gap-6 px-6 py-4 hover:bg-white/[0.03] transition-colors group">
                                        <div className="w-8 flex items-center justify-center flex-shrink-0">{getRankIcon(rank)}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[11px] font-black text-primary truncate">{node.node_id?.slice(0, 18)}...</div>
                                            {node.name && <div className="text-[9px] text-white/30 mt-0.5">{node.name}</div>}
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {node.is_validator ? (
                                                <span className="inline-flex items-center gap-1 text-[8px] font-black text-purple-400 bg-purple-400/10 px-2 py-1 rounded-md uppercase">
                                                    <Shield size={8} /> Val
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[8px] font-black text-blue-400 bg-blue-400/10 px-2 py-1 rounded-md uppercase">
                                                    <Cloud size={8} /> Proxy
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-sm font-black text-white">{getLeaderboardValue(node)}</div>
                                            <div className="text-[9px] text-white/30">{node.country}{node.region ? `, ${node.region}` : ''}</div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </GlassCard>
            </motion.section>
        </motion.div>
    );
}
