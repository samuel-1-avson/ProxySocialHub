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
    Medal,
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
import { MetricsUnavailableBanner } from '@/components/explorer/MetricsUnavailableBanner';

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
        <div className="bg-card border border-border rounded-lg p-3 text-xs font-mono font-semibold">
            <div className="text-muted-foreground mb-1">{label}</div>
            {payload.map((p: any, i: number) => (
                <div key={i} style={{ color: p.color }} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
                    {p.name}: <span className="text-foreground">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{unit}</span>
                </div>
            ))}
        </div>
    );
}

function EmptyChart({ height, label }: { height: number; label?: string }) {
    return (
        <div className={`flex flex-col items-center justify-center bg-card border border-dashed border-border rounded-lg`} style={{ height }}>
            <BarChart2 size={24} className="text-muted-foreground mb-2" />
            <p className="text-xs font-semibold text-muted-foreground">{label || 'No data yet'}</p>
        </div>
    );
}

function getRankIcon(rank: number) {
    if (rank === 1) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-warning/10 border border-warning/20">
            <Trophy size={14} className="text-warning" />
        </div>
    );
    if (rank === 2) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/10 border border-border">
            <Medal size={14} className="text-muted-foreground" />
        </div>
    );
    if (rank === 3) return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-warning/10 border border-warning/20">
            <Medal size={14} className="text-warning" />
        </div>
    );
    return (
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted border border-border">
            <span className="text-xs font-semibold text-muted-foreground">#{rank}</span>
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

    const displayLeaderboard = leaderboard?.entries ?? [];
    const emptySeriesLabel =
        analytics?.message ||
        (isCustomActive ? 'No aggregated data in this date range' : 'No activity in this period');

    const containerVariants = {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.08 } },
    };
    const itemVariants = {
        hidden: { opacity: 0, y: 12 },
        show: { opacity: 1, y: 0 },
    };

    const getLeaderboardValue = (node: any) => {
        if (leaderboardCategory === 'uptime') return `${(Number(node.uptime_percent || 0)).toFixed(2)}%`;
        if (leaderboardCategory === 'bandwidth') return `${(Number(node.bandwidth_gb || 0)).toFixed(2)} GB`;
        return `${node.active_sessions || 0} sessions`;
    };

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-10 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-border pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>

                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                    <div>
                        <div className="text-xs font-semibold text-primary mb-1">Grid Telemetry // Analytics</div>
                        <h1 className="text-4xl font-semibold tracking-tight text-foreground flex items-center gap-4">
                            <BarChart2 className="text-primary" size={32} />
                            Network Analytics
                        </h1>
                        <p className="text-xs font-semibold text-muted-foreground mt-2">
                            Historical performance, throughput, and node intelligence
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                            {/* Preset buttons — dimmed when custom range is active */}
                            <div className={`flex items-center gap-2 bg-muted border border-border rounded-lg p-1.5 transition-opacity ${isCustomActive ? 'opacity-30 pointer-events-none' : ''}`}>
                                {PERIODS.map((p) => (
                                    <button
                                        key={p.value}
                                        onClick={() => { setPeriod(p.value); clearCustomRange(); }}
                                        className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${period === p.value && !isCustomActive ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground'}`}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                            {/* Custom date range toggle */}
                            <button
                                onClick={() => setShowDatePicker(v => !v)}
                                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-semibold transition-all ${isCustomActive ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted border-border text-muted-foreground hover:text-foreground'}`}
                            >
                                <Calendar size={12} />
                                {isCustomActive ? `${appliedFrom} → ${appliedTo}` : 'Custom'}
                            </button>
                            {isCustomActive && (
                                <button onClick={clearCustomRange} className="p-2 rounded-lg bg-muted border border-border text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-all">
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                        {/* Date picker panel */}
                        {showDatePicker && (
                            <div className="flex items-end gap-3 bg-muted border border-border rounded-lg px-4 py-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-muted-foreground">From</label>
                                    <input
                                        type="date"
                                        value={customFrom}
                                        max={customTo || todayStr()}
                                        onChange={e => setCustomFrom(e.target.value)}
                                        className="bg-muted border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs font-semibold text-muted-foreground">To</label>
                                    <input
                                        type="date"
                                        value={customTo}
                                        min={customFrom}
                                        max={todayStr()}
                                        onChange={e => setCustomTo(e.target.value)}
                                        className="bg-muted border border-border rounded-lg px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50"
                                    />
                                </div>
                                <button
                                    onClick={applyCustomRange}
                                    disabled={!customFrom || !customTo || customFrom > customTo}
                                    className="px-4 py-1.5 rounded-lg bg-primary text-black text-xs font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-primary/90 transition-all"
                                >
                                    Apply
                                </button>
                                <button onClick={() => setShowDatePicker(false)} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </motion.header>

            {analytics && analytics.metrics_available === false && (
                <motion.div variants={itemVariants}>
                    <MetricsUnavailableBanner message={analytics.message} />
                </motion.div>
            )}

            {/* Summary Stats */}
            <motion.section variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Avg TPS', value: metrics ? `${Number(metrics.transactions_per_second || 0).toFixed(2)}` : 'Unavailable', icon: Activity, color: 'text-primary' },
                    { label: 'Total Volume', value: metrics ? `${Number(metrics.total_volume || 0).toFixed(1)} SOL` : 'Unavailable', icon: TrendingUp, color: 'text-success' },
                    { label: 'Bandwidth (cumulative)', value: metrics ? `${Number(metrics.total_bandwidth_gb || 0).toFixed(1)} GB` : 'Unavailable', icon: Zap, color: 'text-warning' },
                    { label: 'Active Wallets', value: metrics ? (metrics.active_wallets || 0).toLocaleString() : 'Unavailable', icon: Globe, color: 'text-info' },
                ].map((stat, i) => (
                    <GlassCard key={i} className="!p-5 border-border bg-card rounded-[1.5rem]">
                        <stat.icon size={16} className={`${stat.color} mb-3 opacity-60`} />
                        <div className="text-2xl font-semibold text-foreground tracking-tight">{stat.value}</div>
                        <div className="text-xs font-semibold text-muted-foreground mt-1">{stat.label}</div>
                    </GlassCard>
                ))}
            </motion.section>

            {/* Charts Row */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <motion.section variants={itemVariants}>
                    <GlassCard className="!p-6 border-border bg-card rounded-lg">
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                                <TrendingUp size={14} className="text-primary" /> Transaction Volume
                            </h3>
                            <p className="text-xs font-semibold text-muted-foreground mt-1">SOL settled on-chain</p>
                        </div>
                        {loadingAnalytics ? (
                            <div className="h-[180px] animate-pulse bg-muted rounded-lg" />
                        ) : !mounted || volumeData.length === 0 ? (
                            <EmptyChart height={180} label={emptySeriesLabel} />
                        ) : (
                            <ResponsiveContainer width="100%" height={180} minWidth={0} minHeight={0}>
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
                    <GlassCard className="!p-6 border-border bg-card rounded-lg">
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                                <Zap size={14} className="text-warning" /> Bandwidth Throughput
                            </h3>
                            <p className="text-xs font-semibold text-muted-foreground mt-1">GB proxied through network</p>
                        </div>
                        {loadingAnalytics ? (
                            <div className="h-[180px] animate-pulse bg-muted rounded-lg" />
                        ) : !mounted || bandwidthData.length === 0 ? (
                            <EmptyChart height={180} label={emptySeriesLabel} />
                        ) : (
                            <ResponsiveContainer width="100%" height={180} minWidth={0} minHeight={0}>
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
                    <GlassCard className="!p-6 border-border bg-card rounded-lg">
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                                <Server size={14} className="text-info" /> Active Relay Nodes
                            </h3>
                            <p className="text-xs font-semibold text-muted-foreground mt-1">Node count over time</p>
                        </div>
                        {loadingAnalytics ? (
                            <div className="h-[160px] animate-pulse bg-muted rounded-lg" />
                        ) : !mounted || nodeData.length === 0 ? (
                            <EmptyChart height={160} label={emptySeriesLabel} />
                        ) : (
                            <ResponsiveContainer width="100%" height={160} minWidth={0} minHeight={0}>
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
                    <GlassCard className="!p-6 border-border bg-card rounded-lg h-full flex flex-col">
                        <div className="mb-4">
                            <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                                <Globe size={14} className="text-success" /> Region Split
                            </h3>
                            <p className="text-xs font-semibold text-muted-foreground mt-1">Nodes by region</p>
                        </div>
                        {!mounted || regionData.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <Globe size={40} className="text-muted-foreground mx-auto mb-3" />
                                    <p className="text-xs font-semibold text-muted-foreground">No region data</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 flex items-center justify-center">
                                    <ResponsiveContainer width="100%" height={140} minWidth={0} minHeight={0}>
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
                                        <div key={r.name} className="flex items-center justify-between text-xs font-semibold">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                                <span className="text-muted-foreground">{r.name}</span>
                                            </div>
                                            <span className="text-foreground">{r.value}</span>
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
                        <h2 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-3">
                            <Trophy size={18} className="text-warning" /> Node Leaderboard
                        </h2>
                        <p className="text-xs font-semibold text-muted-foreground mt-1">Top performers ranked by category</p>
                    </div>
                    <div className="flex items-center gap-2 bg-muted border border-border rounded-lg p-1.5">
                        {LEADERBOARD_CATEGORIES.map((cat) => (
                            <button
                                key={cat.value}
                                onClick={() => setLeaderboardCategory(cat.value)}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${leaderboardCategory === cat.value ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                <cat.icon size={10} /> {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                {leaderboardError && (
                    <div className="mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-warning/10 border border-warning/20 text-warning text-xs font-semibold">
                        Leaderboard API unavailable
                    </div>
                )}
                <GlassCard className="overflow-hidden border-border bg-card">
                    {loadingLeaderboard ? (
                        <div className="space-y-0 divide-y divide-border">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-14 animate-pulse bg-card" />
                            ))}
                        </div>
                    ) : displayLeaderboard.length === 0 ? (
                        <div className="py-20 text-center">
                            <Trophy size={48} className="text-muted-foreground mx-auto mb-4" />
                            <p className="text-xs font-semibold text-muted-foreground">No nodes registered yet</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {displayLeaderboard.map((node: any, i: number) => {
                                const rank = node.rank ?? i + 1;
                                return (
                                    <Link key={node.node_id} href={`/explorer/nodes/${node.node_id}`} className="flex items-center gap-6 px-6 py-4 hover:bg-surface-hover transition-colors group">
                                        <div className="w-8 flex items-center justify-center flex-shrink-0">{getRankIcon(rank)}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-semibold text-primary truncate">{node.node_id?.slice(0, 18)}...</div>
                                            {node.name && <div className="text-xs text-muted-foreground mt-0.5">{node.name}</div>}
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {node.is_validator ? (
                                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary bg-primary/10 px-2 py-1 rounded-md">
                                                    <Shield size={8} /> Val
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-info bg-info/10 px-2 py-1 rounded-md">
                                                    <Cloud size={8} /> Proxy
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-sm font-semibold text-foreground">{getLeaderboardValue(node)}</div>
                                            <div className="text-xs text-muted-foreground">{node.country}{node.region ? `, ${node.region}` : ''}</div>
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
