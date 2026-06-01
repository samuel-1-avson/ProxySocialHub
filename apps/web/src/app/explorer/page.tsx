'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
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
} from '@/lib/services/explorer';
import { useExplorerWS } from '@/lib/hooks/useExplorerWS';
import { buildExplorerSearchPath } from '@/lib/explorer-search';
import { MetricsUnavailableBanner } from '@/components/explorer/MetricsUnavailableBanner';
import { ExplorerApiError } from '@/lib/services/explorer-errors';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
    Radar,
    Fingerprint,
    History,
    Network,
    BarChart2,
    Trophy,
    MapPin,
    TrendingUp,
    TrendingDown,
    Minus,
    Radio,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';
import {
    AreaChart,
    Area,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

function SparkTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-black/80 border border-white/10 rounded-lg px-2 py-1 text-[8px] font-mono font-black text-white">
            {typeof payload[0].value === 'number' ? payload[0].value.toFixed(2) : payload[0].value}
        </div>
    );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
    if (trend === 'up') return <TrendingUp size={10} className="text-emerald-400" />;
    if (trend === 'down') return <TrendingDown size={10} className="text-rose-400" />;
    return <Minus size={10} className="text-white/20" />;
}

export default function ExplorerDashboard() {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = React.useState('');
    const [mounted, setMounted] = useState(false);
    const [explorerGateActive, setExplorerGateActive] = useState(false);
    const [wsLive, setWsLive] = useState(false);
    const [liveTxs, setLiveTxs] = useState<any[]>([]);
    const [liveBlocks, setLiveBlocks] = useState<any[]>([]);
    useEffect(() => { setMounted(true); }, []);

    const isFullGateError = React.useCallback((err: unknown): boolean => {
        if (!err || typeof err !== 'object') return false;
        const anyErr = err as { status?: number; message?: string; details?: string };
        if (anyErr.status !== 503) return false;
        const hay = `${anyErr.message || ''} ${anyErr.details || ''}`.toLowerCase();
        return hay.includes('full decentralization gate active') || hay.includes('quorum requirements not satisfied');
    }, []);

    const { data: metrics, isLoading: loadingMetrics, error: metricsError } = useQuery({
        queryKey: ['explorer-metrics'],
        queryFn: async () => {
            try {
                return await getExplorerMetrics('all');
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

    const { data: transactions, isLoading: loadingTx, error: txError } = useQuery({
        queryKey: ['recent-transactions'],
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

    const { data: blocks, isLoading: loadingBlocks, error: blocksError } = useQuery({
        queryKey: ['recent-blocks'],
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
        queryKey: ['network-health'],
        queryFn: ({ signal }) => getNetworkHealth(signal),
        refetchInterval: 30000,
    });

    const { data: topNodes } = useQuery({
        queryKey: ['top-nodes'],
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
        queryKey: ['analytics-dashboard', '24h'],
        queryFn: async () => {
            try {
                return await getAnalytics('24h');
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
        queryKey: ['explorer-decentralization-status', 256],
        queryFn: () => getExplorerDecentralizationStatus(256),
        refetchInterval: 20000,
        retry: false,
    });

    const { data: writerHealth } = useQuery({
        queryKey: ['explorer-decentralization-writers', 256],
        queryFn: () => getExplorerDecentralizationWriters(256),
        refetchInterval: 20000,
        retry: false,
    });

    useEffect(() => {
        if (transactions?.transactions?.length) {
            setLiveTxs(transactions.transactions);
        }
    }, [transactions]);

    useEffect(() => {
        if (blocks?.blocks?.length) {
            setLiveBlocks(blocks.blocks);
        }
    }, [blocks]);

    useExplorerWS({
        enabled: !explorerGateActive,
        onOpen: () => setWsLive(true),
        onInitial: (data) => {
            setWsLive(true);
            if (Array.isArray(data?.transactions) && data.transactions.length > 0) {
                setLiveTxs(data.transactions.map((tx: any) => ({
                    tx_hash: tx.tx_hash,
                    from_address: tx.from,
                    to_address: tx.to,
                    amount: tx.amount,
                    currency: tx.currency,
                    tx_type: tx.tx_type,
                    status: tx.status || 'confirmed',
                    timestamp: tx.timestamp || new Date().toISOString(),
                })));
            }
            if (Array.isArray(data?.blocks) && data.blocks.length > 0) {
                setLiveBlocks(data.blocks.map((b: any) => ({
                    block_hash: b.block_hash,
                    block_number: b.block_number,
                    transaction_count: b.transaction_count,
                    timestamp: b.timestamp || new Date().toISOString(),
                })));
            }
        },
        onNewTransaction: (data) => {
            setWsLive(true);
            setLiveTxs(prev => [
                { tx_hash: data.tx_hash, from_address: data.from, to_address: data.to, amount: data.amount, currency: data.currency, tx_type: data.tx_type, status: data.status || 'pending', timestamp: data.timestamp || new Date().toISOString() },
                ...prev,
            ].slice(0, 10));
        },
        onNewBlock: (data) => {
            setWsLive(true);
            setLiveBlocks(prev => [
                { block_hash: data.block_hash, block_number: data.block_number, transaction_count: data.transaction_count, timestamp: data.timestamp || new Date().toISOString() },
                ...prev,
            ].slice(0, 5));
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

    const volume = metrics?.total_volume || 0;
    const nodes = metrics?.active_nodes || 0;
    const bandwidth = metrics?.total_bandwidth_gb || 0;
    const blockHeight = metrics?.block_height || 0;

    // Real sparkline data from analytics API (24h history)
    const volSparkData = (analytics?.transaction_volume || []).map(p => ({ v: p.value }));
    const bwSparkData = (analytics?.bandwidth_gb || []).map(p => ({ v: p.value }));
    const nodeSparkData = (analytics?.active_nodes || []).map(p => ({ v: p.value }));

    const metricCards = [
        {
            label: 'Block Height',
            value: blockHeight ? blockHeight.toLocaleString() : '—',
            icon: Database,
            color: 'text-primary',
            sparkColor: '#6366f1',
            sparkData: null, // no time series for block height
            trend: blockHeight > 0 ? 'up' as const : 'flat' as const,
            sub: metrics?.avg_block_time_ms != null ? `~${Number(metrics.avg_block_time_ms).toFixed(0)}ms per block` : null,
        },
        {
            label: 'Active Relays',
            value: nodes ? nodes.toLocaleString() : '—',
            icon: Server,
            color: 'text-blue-500',
            sparkColor: '#3b82f6',
            sparkData: nodeSparkData.length > 0 ? nodeSparkData : null,
            trend: nodes > 0 ? 'up' as const : 'flat' as const,
            sub: metrics ? `${metrics.active_wallets || 0} wallets active` : null,
        },
        {
            label: '24H Volume',
            value: volume ? `${Number(volume).toFixed(2)} SOL` : '—',
            icon: ArrowRightLeft,
            color: 'text-emerald-500',
            sparkColor: '#10b981',
            sparkData: volSparkData.length > 0 ? volSparkData : null,
            trend: volume > 0 ? 'up' as const : 'flat' as const,
            sub: metrics ? `${Number(metrics.transactions_per_second || 0).toFixed(2)} avg TPS (24h)` : null,
        },
        {
            label: 'Throughput',
            value: bandwidth ? `${Number(bandwidth).toFixed(2)} GB` : '—',
            icon: Zap,
            color: 'text-yellow-500',
            sparkColor: '#eab308',
            sparkData: bwSparkData.length > 0 ? bwSparkData : null,
            trend: bandwidth > 0 ? 'up' as const : 'flat' as const,
            sub: 'Cumulative indexed node bandwidth',
        },
    ];

    // System health status color
    const healthStatus = health?.status?.toLowerCase() || 'optimal';
    const healthColor = healthStatus === 'optimal' ? 'text-emerald-500' : healthStatus === 'degraded' ? 'text-yellow-500' : 'text-rose-500';
    const healthBg = healthStatus === 'optimal' ? 'bg-emerald-500/10 border-emerald-500/20' : healthStatus === 'degraded' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-rose-500/10 border-rose-500/20';

    const sortedTopNodes = [...(topNodes?.nodes || [])].sort((a: any, b: any) => (b.uptime_percent || 0) - (a.uptime_percent || 0));

    const consensusRate = decentralization && decentralization.recent_slots_analyzed > 0
        ? `${(decentralization.quorum_ratio * 100).toFixed(1)}%`
        : '—';
    const consensusColor = !decentralization || decentralization.recent_slots_analyzed === 0
        ? 'text-white/40'
        : decentralization.conflicting_slots > 0
            ? 'text-rose-400'
            : decentralization.fully_decentralized
                ? 'text-emerald-400'
                : 'text-yellow-400';

    const trustLabel = !decentralization || decentralization.recent_slots_analyzed === 0
        ? 'Bootstrapping'
        : decentralization.fully_decentralized
            ? 'Verified Multi-Writer'
            : decentralization.conflicting_slots > 0
                ? 'Conflicting Views'
                : 'Partial Quorum';

    const trustColor = !decentralization || decentralization.recent_slots_analyzed === 0
        ? 'text-white/40'
        : decentralization.fully_decentralized
            ? 'text-emerald-400'
            : decentralization.conflicting_slots > 0
                ? 'text-rose-400'
                : 'text-yellow-400';

    const writerRows = (writerHealth?.writers || []).slice(0, 5);

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-12 font-mono">
            {/* Tactical HUD Header */}
            <motion.header variants={itemVariants} className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-10 border-b border-white/5 pb-10">
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center relative group overflow-hidden">
                            <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                            <Radar size={24} className="text-primary group-hover:scale-110 transition-transform" />
                        </div>
                        <div>
                            <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // System 1.0</div>
                            <h1 className="text-4xl font-black uppercase tracking-tighter text-white">ProxyExplorer</h1>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-6 w-full xl:w-auto">
                    <div className="flex-1 xl:w-96 relative group">
                        <div className="absolute -inset-1 bg-primary/5 blur-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 w-4 h-4 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="INTERCEPT ID, HASH, OR WALLET..."
                            className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-4 pl-14 pr-24 text-[10px] uppercase font-black tracking-widest text-white placeholder:text-white/10 outline-none focus:border-primary/40 focus:bg-white/[0.05] transition-all"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(searchQuery); }}
                        />
                        <button
                            onClick={() => handleSearch(searchQuery)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-primary/20 hover:bg-primary/40 border border-primary/20 text-primary text-[9px] font-black uppercase rounded-lg transition-all"
                        >
                            Scan
                        </button>
                    </div>

                    <div className="flex items-center gap-3 px-5 py-4 rounded-2xl bg-white/[0.02] border border-white/5">
                        <div className={`w-2 h-2 rounded-full ${healthStatus === 'optimal' ? 'bg-emerald-500 animate-pulse' : healthStatus === 'degraded' ? 'bg-yellow-500' : 'bg-rose-500'}`} />
                        <div className="flex flex-col items-end">
                            <div className="text-[8px] font-black text-white/10 uppercase tracking-widest">Network Load</div>
                            <div className={`text-[11px] font-black uppercase flex items-center gap-2 ${healthColor}`}>
                                <Activity size={12} /> {healthStatus.charAt(0).toUpperCase() + healthStatus.slice(1)}
                            </div>
                        </div>
                    </div>
                </div>
            </motion.header>

            {/* Quick Nav Links */}
            <motion.section variants={itemVariants} className="flex flex-wrap gap-3">
                {[
                    { href: '/treasury', label: 'Treasury', icon: ShieldCheck },
                    { href: '/explorer/transactions', label: 'Transactions', icon: ArrowRightLeft },
                    { href: '/explorer/nodes', label: 'Nodes', icon: Server },
                    { href: '/explorer/blocks', label: 'Blocks', icon: Box },
                    { href: '/explorer/analytics', label: 'Analytics', icon: BarChart2 },
                    { href: '/explorer/map', label: 'Node Map', icon: MapPin },
                    { href: '/explorer/leaderboard', label: 'Leaderboard', icon: Trophy },
                    { href: '/explorer/sessions', label: 'Sessions', icon: Radio },
                    { href: '/explorer/earnings', label: 'Earnings', icon: TrendingUp },
                    { href: '/explorer/health', label: 'Health', icon: ShieldCheck },
                    { href: '/explorer/search', label: 'Search', icon: Fingerprint },
                    { href: '/explorer/wallets', label: 'Wallets', icon: Database },
                    { href: '/explorer/contracts', label: 'Contracts', icon: Network },
                ].map((nav) => (
                    <Link key={nav.href} href={nav.href} prefetch={false} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/30 hover:text-primary hover:border-primary/20 hover:bg-primary/5 text-[9px] font-black uppercase tracking-widest transition-all">
                        <nav.icon size={11} /> {nav.label}
                    </Link>
                ))}
            </motion.section>

            {/* Live Metrics Matrix with Sparklines */}
            <motion.section variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {metricCards.map((stat, i) => (
                    <GlassCard key={i} className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem] group hover:bg-white/[0.03] transition-all overflow-hidden relative">
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <stat.icon size={18} className={`${stat.color} opacity-40 group-hover:opacity-100 transition-opacity`} />
                            <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-white/20">
                                <TrendIcon trend={stat.trend} />
                                {stat.trend !== 'flat' ? stat.trend : 'stable'}
                            </div>
                        </div>
                        <div className="text-2xl font-black text-white tracking-tighter mb-0.5 relative z-10">
                            {loadingMetrics
                                ? <div className="h-7 w-24 bg-white/5 animate-pulse rounded" />
                                : stat.value
                            }
                        </div>
                        <div className="text-[9px] font-black uppercase text-white/20 tracking-[0.2em] mb-3 relative z-10">{stat.label}</div>
                        {stat.sub && (
                            <div className="text-[8px] text-white/20 font-mono relative z-10 mb-2">{stat.sub}</div>
                        )}
                        {/* Sparkline — only rendered when real 24h data is available */}
                        {mounted && stat.sparkData && stat.sparkData.length > 1 && (
                            <div className="h-10 -mx-2 opacity-30 group-hover:opacity-60 transition-opacity" style={{ minHeight: 40 }}>
                                <ResponsiveContainer width="100%" height={40} minWidth={1} minHeight={1}>
                                    <AreaChart data={stat.sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id={`spark${i}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={stat.sparkColor} stopOpacity={0.4} />
                                                <stop offset="95%" stopColor={stat.sparkColor} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="v" hide />
                                        <YAxis hide />
                                        <Area type="monotone" dataKey="v" stroke={stat.sparkColor} strokeWidth={1.5} fill={`url(#spark${i})`} dot={false} />
                                        <Tooltip content={<SparkTooltip />} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </GlassCard>
                ))}
            </motion.section>

            {/* System Health HUD */}
            <motion.section variants={itemVariants}>
                <GlassCard className={`!p-8 border rounded-[2.5rem] relative overflow-hidden group ${healthBg}`}>
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                        <Network size={120} />
                    </div>
                    <div className="flex flex-col lg:flex-row justify-between items-center gap-10 relative z-10">
                        <div className="flex items-center gap-8">
                            <div className={`w-16 h-16 rounded-[1.8rem] ${healthBg} flex items-center justify-center ${healthColor}`}>
                                <ShieldCheck size={32} />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-white">
                                    System Status: {(health?.status || 'OPTIMAL').toUpperCase()}
                                </h3>
                                <div className="flex flex-wrap items-center gap-6 text-[10px] font-black uppercase tracking-widest text-white/30">
                                    <span className="flex items-center gap-2">
                                        <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${health?.solana_health === 'healthy' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                        Blockchain Indexer
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span className={`w-1.5 h-1.5 rounded-full ${health?.database_health === 'healthy' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                        Telemetry Vault
                                    </span>
                                    <span className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        {health?.active_nodes || 0} Nodes Online
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-12 items-center">
                            <div className="text-right">
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] mb-1">Response Latency</div>
                                <div className={`text-3xl font-black ${(health?.avg_response_time_ms || 0) < 50 ? 'text-emerald-400' : (health?.avg_response_time_ms || 0) < 200 ? 'text-yellow-400' : 'text-rose-400'}`}>
                                    {health?.avg_response_time_ms?.toFixed(0) || '—'}<span className="text-sm opacity-40 ml-1">ms</span>
                                </div>
                            </div>
                            <div className="w-px h-12 bg-white/5 hidden lg:block" />
                            <div className="text-right">
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] mb-1">Consensus Rate</div>
                                <div className={`text-3xl font-black ${consensusColor}`}>{consensusRate}</div>
                            </div>
                            <div className="w-px h-12 bg-white/5 hidden lg:block" />
                            <div className="text-right">
                                <Link href="/explorer/analytics" prefetch={false} className="flex items-center gap-2 text-[9px] font-black text-primary/60 hover:text-primary uppercase tracking-widest transition-colors">
                                    Analytics <ChevronRight size={12} />
                                </Link>
                                <div className="text-[8px] text-white/20 mt-0.5">View full charts</div>
                            </div>
                        </div>
                    </div>
                </GlassCard>
            </motion.section>

            {/* Decentralization Trust Panel */}
            <motion.section variants={itemVariants} className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <GlassCard className="xl:col-span-5 !p-6 border-white/5 bg-white/[0.01] rounded-[2rem]">
                    <div className="flex items-center justify-between mb-5">
                        <h3 className="text-lg font-black uppercase tracking-tighter text-white flex items-center gap-2">
                            <ShieldCheck size={16} className="text-primary" /> Explorer Trust
                        </h3>
                        <div className={`text-[9px] font-black uppercase tracking-widest ${trustColor}`}>{trustLabel}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                            <div className="text-[8px] font-black uppercase tracking-widest text-white/20">Writers</div>
                            <div className="text-xl font-black text-white mt-1">
                                {decentralization?.unique_writers ?? 0}
                                <span className="text-[10px] text-white/30 ml-1">/ {decentralization?.min_writers_required ?? 0}</span>
                            </div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                            <div className="text-[8px] font-black uppercase tracking-widest text-white/20">Quorum Slots</div>
                            <div className="text-xl font-black text-white mt-1">
                                {decentralization?.slots_meeting_quorum ?? 0}
                                <span className="text-[10px] text-white/30 ml-1">/ {decentralization?.recent_slots_analyzed ?? 0}</span>
                            </div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                            <div className="text-[8px] font-black uppercase tracking-widest text-white/20">Conflicting Slots</div>
                            <div className={`text-xl font-black mt-1 ${(decentralization?.conflicting_slots || 0) > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                {decentralization?.conflicting_slots ?? 0}
                            </div>
                        </div>
                        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                            <div className="text-[8px] font-black uppercase tracking-widest text-white/20">Mode</div>
                            <div className="text-[10px] font-black text-white mt-2 uppercase tracking-wider truncate">
                                {(decentralization?.explorer_mode || 'unknown').replaceAll('_', ' ')}
                            </div>
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="xl:col-span-7 !p-6 border-white/5 bg-white/[0.01] rounded-[2rem]">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-black uppercase tracking-tighter text-white flex items-center gap-2">
                            <Server size={16} className="text-primary" /> Writer Health
                        </h3>
                        <div className="text-[8px] text-white/30 uppercase tracking-widest">identity / lag / conflicts / participation</div>
                    </div>

                    {!writerRows.length ? (
                        <div className="text-[10px] text-white/30 uppercase tracking-widest py-10 text-center border border-dashed border-white/10 rounded-2xl">
                            No writer attestations in current window
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {writerRows.map((w) => (
                                <div key={w.writer_id} className="grid grid-cols-12 gap-3 items-center rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                                    <div className="col-span-5 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className="text-[10px] font-black text-primary truncate">{w.writer_id}</div>
                                            <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${w.identity_verified ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10' : 'border-white/20 text-white/50 bg-white/5'}`}>
                                                {w.identity_verified ? 'verified' : 'unverified'}
                                            </span>
                                        </div>
                                        <div className="text-[8px] text-white/25 truncate">{w.rpc_endpoint || 'rpc endpoint hidden'}</div>
                                    </div>
                                    <div className="col-span-2 text-right">
                                        <div className="text-[8px] text-white/20 uppercase tracking-widest">Lag</div>
                                        <div className={`text-[11px] font-black ${w.lag_slots === 0 ? 'text-emerald-400' : w.lag_slots <= 2 ? 'text-yellow-400' : 'text-rose-400'}`}>
                                            {w.lag_slots}
                                        </div>
                                    </div>
                                    <div className="col-span-2 text-right">
                                        <div className="text-[8px] text-white/20 uppercase tracking-widest">Conflicts</div>
                                        <div className={`text-[11px] font-black ${w.conflicting_slots > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                            {w.conflicting_slots}
                                        </div>
                                    </div>
                                    <div className="col-span-3 text-right">
                                        <div className="text-[8px] text-white/20 uppercase tracking-widest">Participation</div>
                                        <div className="text-[11px] font-black text-white">
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
                {/* Settlement Stream */}
                <motion.section variants={itemVariants} className="xl:col-span-8 space-y-6">
                    <div className="flex justify-between items-end px-4">
                        <div className="space-y-1">
                            <h2 className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                                <Activity size={18} className="text-primary" /> Settlement Stream
                            </h2>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Live protocol transactions</p>
                        </div>
                        <Link href="/explorer/transactions" className="text-[9px] font-black uppercase tracking-[0.3em] text-white/20 hover:text-primary transition-colors flex items-center gap-2">
                            Full Ledger <ChevronRight size={12} />
                        </Link>
                    </div>

                    <div className="space-y-3">
                        {loadingTx ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-16 bg-white/[0.01] animate-pulse border border-white/5 rounded-2xl" />
                            ))
                        ) : !liveTxs.length ? (
                            <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-[2.5rem] bg-white/[0.01]">
                                <Fingerprint size={48} className="mx-auto text-white/5 mb-6" />
                                <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.5em]">No activity detected in segment</p>
                            </div>
                        ) : (
                            liveTxs.map((tx: any, i: number) => (
                                <GlassCard key={tx.tx_hash || i} className="group !p-4 border-white/5 bg-white/[0.01] rounded-2xl hover:bg-white/[0.03] transition-all">
                                    <div className="flex items-center justify-between gap-6">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-9 h-9 rounded-xl bg-black border border-white/5 flex items-center justify-center text-primary group-hover:border-primary/20 transition-colors flex-shrink-0">
                                                <Target size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <Link href={`/explorer/transactions/${tx.tx_hash}`} className="text-[11px] font-black text-primary hover:text-primary/80 truncate uppercase tracking-wider block transition-colors">
                                                    {tx.tx_hash?.slice(0, 14)}...{tx.tx_hash?.slice(-8)}
                                                </Link>
                                                <div className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-0.5 flex items-center gap-2">
                                                    <Clock size={9} />
                                                    {tx.timestamp ? formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true }) : 'Processing...'}
                                                    {tx.tx_type && (
                                                        <span className="text-white/30 bg-white/5 px-1.5 py-0.5 rounded text-[8px]">
                                                            {tx.tx_type.replace(/_/g, ' ')}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-sm font-black text-white">{(tx.amount || 0).toFixed(4)} {tx.currency || 'SOL'}</div>
                                            <div className={`text-[8px] font-black uppercase tracking-widest mt-1 ${tx.status === 'confirmed' ? 'text-emerald-500' : tx.status === 'failed' ? 'text-rose-500' : 'text-yellow-500'}`}>
                                                {tx.status || 'Processing'}
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
                    {/* Sequence Blocks */}
                    <motion.section variants={itemVariants} className="space-y-4">
                        <div className="space-y-1 px-4 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                                    <Box size={18} className="text-primary" /> Sequence Blocks
                                </h2>
                                <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-0.5">Verified segment hashes</p>
                            </div>
                            <Link href="/explorer/blocks" className="text-[9px] font-black text-white/20 hover:text-primary uppercase tracking-widest flex items-center gap-1 transition-colors">
                                All <ChevronRight size={10} />
                            </Link>
                        </div>

                        <div className="space-y-3">
                            {loadingBlocks ? (
                                Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="h-20 bg-white/[0.01] animate-pulse border border-white/5 rounded-[1.5rem]" />
                                ))
                            ) : !liveBlocks.length ? (
                                <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-[2rem] bg-white/[0.01]">
                                    <Hexagon size={36} className="mx-auto text-white/5 mb-4" />
                                    <p className="text-[9px] font-black text-white/10 uppercase tracking-widest">Syncing chain state...</p>
                                </div>
                            ) : (
                                liveBlocks.map((block: any, i: number) => (
                                    <Link key={block.block_hash || i} href={`/explorer/blocks/${block.block_number}`}>
                                        <GlassCard className="group !p-5 border-white/5 bg-white/[0.01] rounded-2xl hover:bg-white/[0.03] transition-all relative overflow-hidden">
                                            <div className="absolute right-0 top-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity">
                                                <History size={32} />
                                            </div>
                                            <div className="flex items-center justify-between relative z-10">
                                                <div>
                                                    <div className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Block</div>
                                                    <div className="text-xl font-black text-white tracking-tighter">#{(block.block_number || 0).toLocaleString()}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[8px] text-white/20 font-black uppercase tracking-widest">{block.transaction_count ?? 0} txs</div>
                                                    <div className="text-[8px] text-white/20 mt-0.5">
                                                        {block.timestamp ? formatDistanceToNow(new Date(block.timestamp), { addSuffix: true }) : '—'}
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
                                <h2 className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                                    <Trophy size={18} className="text-yellow-400" /> Top Relays
                                </h2>
                                <Link href="/explorer/nodes" className="text-[9px] font-black text-white/20 hover:text-primary uppercase tracking-widest flex items-center gap-1 transition-colors">
                                    All <ChevronRight size={10} />
                                </Link>
                            </div>
                            <GlassCard className="!p-0 border-white/5 bg-white/[0.01] rounded-[2rem] overflow-hidden divide-y divide-white/5">
                                {sortedTopNodes.map((node: any, i) => (
                                    <Link key={node.node_id} href={`/explorer/nodes/${node.node_id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors">
                                        <div className="text-[10px] font-black text-white/20 w-4">{i + 1}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[10px] font-black text-primary truncate">{node.node_id?.slice(0, 14)}...</div>
                                            <div className="flex items-center gap-1 text-[8px] text-white/30 mt-0.5">
                                                <MapPin size={8} /> {node.country}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-[11px] font-black ${(node.uptime_percent || 0) > 98 ? 'text-emerald-400' : 'text-yellow-400'}`}>
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
                <motion.div variants={itemVariants} className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[9px] font-black uppercase tracking-widest">
                    <span className="text-rose-500">⚠</span>
                    {explorerGateActive ? 'Explorer full decentralization gate is active — detailed feeds are paused until quorum is satisfied' :
                     metricsError instanceof ExplorerApiError && metricsError.kind === 'not_found' ? 'Requested explorer resource was not found' :
                     metricsError && txError ? 'Network metrics and transaction data unavailable' :
                     metricsError ? (metricsError instanceof Error ? metricsError.message : 'Network metrics unavailable') :
                     txError ? 'Transaction feed unavailable' :
                     'Block data unavailable'}
                    <span className="ml-auto text-[8px] text-rose-400/50">{explorerGateActive ? 'Follow /explorer/decentralization/status' : 'Check API connection'}</span>
                </motion.div>
            )}
        </motion.div>
    );
}
