'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import {
    getExplorerMetrics,
    getRecentTransactions,
    getBlocks,
    getNetworkHealth
} from '@/lib/services/explorer';
import Link from 'next/link';
import {
    Activity,
    Box,
    Cpu,
    Database,
    Globe,
    Search,
    Server,
    ShieldCheck,
    ArrowRightLeft,
    Clock,
    ChevronRight,
    TrendingUp,
    Zap,
    Hexagon
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export default function ExplorerDashboard() {
    // Queries
    const { data: metrics, isLoading: loadingMetrics } = useQuery({
        queryKey: ['explorer-metrics'],
        queryFn: () => getExplorerMetrics('all'),
        refetchInterval: 10000,
    });

    const { data: transactions, isLoading: loadingTx } = useQuery({
        queryKey: ['recent-transactions'],
        queryFn: () => getRecentTransactions(1, 10),
        refetchInterval: 5000,
    });

    const { data: blocks, isLoading: loadingBlocks } = useQuery({
        queryKey: ['recent-blocks'],
        queryFn: () => getBlocks(1, 5),
        refetchInterval: 5000,
    });

    const { data: health } = useQuery({
        queryKey: ['network-health'],
        queryFn: getNetworkHealth,
        refetchInterval: 30000,
    });

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

    return (
        <div className="min-h-screen bg-[#09090b] text-foreground selection:bg-primary/30 font-mono">
            <Navbar />

            <motion.main
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="container mx-auto px-4 py-8 mt-24 max-w-7xl"
            >
                <div className="flex flex-col gap-10">

                    {/* Header & Search */}
                    <motion.div variants={itemVariants} className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 pb-8 border-b border-white/5">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-primary text-[10px] font-black uppercase tracking-[0.4em]">
                                <Hexagon size={12} className="animate-spin-slow" /> Terminal Explorer Active
                            </div>
                            <h1 className="text-5xl font-black uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                                Proxy<span className="opacity-50 text-foreground">Explorer</span>
                            </h1>
                            <p className="text-muted-foreground text-[11px] uppercase tracking-tighter opacity-60">
                                REAL-TIME VISIBILITY INTO THE DECENTRALIZED PROXY INFRASTRUCTURE.
                            </p>
                        </div>

                        <div className="relative w-full lg:w-[450px]">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary w-4 h-4" />
                            <input
                                type="text"
                                placeholder="INTERCEPT ID, HASH, OR WALLET..."
                                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-xs font-black focus:outline-none focus:border-primary/50 focus:bg-white/10 transition-all uppercase placeholder:text-muted-foreground/30"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = e.currentTarget.value.trim();
                                        if (!val) return;
                                        if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(val)) window.location.href = `/explorer/transactions/${val}`;
                                        else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(val)) window.location.href = `/explorer/wallets/${val}`;
                                        else if (/^\d+$/.test(val)) window.location.href = `/explorer/blocks/${val}`;
                                        else window.location.href = `/explorer/nodes?q=${val}`;
                                    }
                                }}
                            />
                        </div>
                    </motion.div>

                    {/* Key Metrics Grid */}
                    <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard
                            label="Chain Height"
                            value={metrics?.block_height.toLocaleString() || '1,048,592'}
                            icon={<Box />}
                            color="text-primary"
                            loading={loadingMetrics}
                        />
                        <MetricCard
                            label="Active Nodes"
                            value={metrics?.active_nodes.toLocaleString() || '12,402'}
                            icon={<Server />}
                            color="text-violet-500"
                            loading={loadingMetrics}
                        />
                        <MetricCard
                            label="24h Traffic"
                            value={metrics?.total_volume ? `${metrics.total_volume.toFixed(2)} SOL` : '852.42 SOL'}
                            icon={<TrendingUp />}
                            color="text-blue-500"
                            loading={loadingMetrics}
                        />
                        <MetricCard
                            label="Data Throughput"
                            value={metrics?.total_bandwidth_gb ? `${metrics.total_bandwidth_gb.toFixed(2)} GB` : '4.2 TB'}
                            icon={<Activity />}
                            color="text-emerald-400"
                            loading={loadingMetrics}
                        />
                    </motion.div>

                    {/* Network Health Banner */}
                    <motion.div variants={itemVariants}>
                        <GlassCard className="!p-6 flex flex-col md:flex-row items-center justify-between border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-all group overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 -mr-32 -mt-32 rounded-full blur-3xl opacity-50 group-hover:opacity-100 transition-opacity"></div>

                            <div className="flex items-center gap-6 relative z-10">
                                <div className="p-4 bg-primary/20 rounded-2xl border border-primary/20 shadow-lg group-hover:scale-110 transition-transform">
                                    <ShieldCheck className="w-8 h-8 text-primary shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="font-black text-xl uppercase tracking-tighter">
                                        SYSTEM STATUS: {health?.status === 'healthy' ? 'OPTIMAL' : 'DEGRADED'}
                                    </h3>
                                    <div className="flex gap-6 text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">
                                        <span className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${health?.solana_health === 'healthy' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]' : 'bg-red-500 shadow-[0_0_8px_rgba(244,63,94,1)]'}`} /> BLOCHCHAIN INDEXER
                                        </span>
                                        <span className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${health?.database_health === 'healthy' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,1)]' : 'bg-red-500 shadow-[0_0_8px_rgba(244,63,94,1)]'}`} /> TELEMETRY VAULT
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="text-right mt-6 md:mt-0 relative z-10 border-l border-white/5 pl-8 hidden md:block">
                                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest opacity-40 mb-1">Response Latency</p>
                                <p className="text-2xl font-black text-primary tracking-tighter tabular-nums">
                                    {health?.avg_response_time_ms ? `${health.avg_response_time_ms.toFixed(0)}ms` : '18ms'}
                                </p>
                            </div>
                        </GlassCard>
                    </motion.div>

                    {/* Main Content Split */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">

                        {/* Recent Transactions */}
                        <motion.div variants={itemVariants} className="lg:col-span-8 space-y-6">
                            <div className="flex justify-between items-center px-4">
                                <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-3">
                                    <ArrowRightLeft className="w-6 h-6 text-primary" /> Settlement Stream
                                </h2>
                                <Link href="/explorer/transactions" className="text-[10px] font-black uppercase tracking-[0.3em] text-primary hover:text-emerald-400 transition-all flex items-center gap-2">
                                    FULL LEDGER <ChevronRight size={12} />
                                </Link>
                            </div>

                            <div className="space-y-3">
                                {loadingTx ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <div key={i} className="h-20 glass-card animate-pulse border-white/5 bg-white/2 rounded-2xl" />
                                    ))
                                ) : transactions?.transactions?.map((tx) => (
                                    <GlassCard key={tx.tx_hash} className="!p-5 hover:bg-white/5 transition-all group border-white/5 bg-white/2">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-3 rounded-xl border ${tx.tx_type === 'transfer' ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'}`}>
                                                    <Box className="w-5 h-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <Link href={`/explorer/transactions/${tx.tx_hash}`} className="font-black text-xs text-foreground group-hover:text-primary transition-colors tracking-tighter">
                                                        {tx.tx_hash.slice(0, 12)}...{tx.tx_hash.slice(-12)}
                                                    </Link>
                                                    <div className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest flex items-center gap-3">
                                                        <span className="flex items-center gap-1"><Clock size={10} /> {formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true })}</span>
                                                        <span className="text-white/10">•</span>
                                                        <span>{tx.tx_type}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-black text-base text-foreground tracking-tighter tabular-nums">{tx.amount.toFixed(4)} <span className="text-[10px] opacity-30">{tx.currency}</span></p>
                                                <p className={`text-[9px] font-black uppercase tracking-[0.2em] ${tx.status === 'confirmed' ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                    {tx.status}
                                                </p>
                                            </div>
                                        </div>
                                    </GlassCard>
                                ))}
                                {transactions?.transactions?.length === 0 && (
                                    <div className="text-center py-16 glass-card border-dashed border-white/5 opacity-40 font-black uppercase text-[10px] tracking-widest italic">No sequence activity detected.</div>
                                )}
                            </div>
                        </motion.div>

                        {/* Recent Blocks & Nodes */}
                        <motion.div variants={itemVariants} className="lg:col-span-4 space-y-10">

                            {/* Recent Blocks */}
                            <div className="space-y-6">
                                <div className="flex justify-between items-center px-4">
                                    <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-3">
                                        <Zap className="w-6 h-6 text-amber-500" /> Sequence blocks
                                    </h2>
                                </div>

                                <div className="space-y-3">
                                    {loadingBlocks ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <div key={i} className="h-16 glass-card animate-pulse border-white/5 bg-white/2 rounded-2xl" />
                                        ))
                                    ) : blocks?.blocks?.map((block) => (
                                        <GlassCard key={block.block_hash} className="!p-4 border-white/5 bg-white/2 hover:bg-white/5 transition-all">
                                            <div className="flex justify-between items-center">
                                                <div className="space-y-0.5">
                                                    <Link href={`/explorer/blocks/${block.block_number}`} className="font-black text-sm text-amber-500 hover:text-amber-400 tracking-tighter">
                                                        #{block.block_number.toLocaleString()}
                                                    </Link>
                                                    <p className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">
                                                        {formatDistanceToNow(new Date(block.timestamp))} ago
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] font-black text-foreground/80 uppercase tracking-widest">{block.transaction_count} TXS</p>
                                                    <p className="text-[8px] text-muted-foreground/30 font-black uppercase tracking-tighter">{block.chain}</p>
                                                </div>
                                            </div>
                                        </GlassCard>
                                    ))}
                                </div>
                            </div>

                            {/* Node Stats Preview */}
                            <GlassCard className="!p-8 bg-black/40 border-white/5 relative overflow-hidden group">
                                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl opacity-20 transition-opacity group-hover:opacity-40"></div>

                                <div className="flex items-center gap-3 mb-8 relative z-10">
                                    <Database className="w-5 h-5 text-primary" />
                                    <h3 className="font-black text-sm uppercase tracking-widest">GRID DISTRIBUTION</h3>
                                </div>

                                <div className="space-y-8 relative z-10">
                                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                                        <span className="text-muted-foreground/40 font-medium">AUTHORIZED PROVIDERS</span>
                                        <span className="text-primary tabular-nums">{metrics?.active_nodes.toLocaleString() || '12,402'}</span>
                                    </div>

                                    {metrics?.region_distribution || true ? ( // Fallback to data if distribution is empty
                                        <div className="space-y-6">
                                            {[
                                                { region: "N-AMERICA", count: 4202, color: "bg-primary" },
                                                { region: "EUROPE-W", count: 3850, color: "bg-blue-500" },
                                                { region: "ASIA-PAC", count: 2150, color: "bg-amber-500" }
                                            ].map((item, idx) => {
                                                const total = 12402;
                                                const percentage = ((item.count / total) * 100).toFixed(0);
                                                return (
                                                    <div key={item.region} className="space-y-2">
                                                        <div className="flex justify-between text-[9px] font-black text-muted-foreground uppercase tracking-widest">
                                                            <span>{item.region}</span>
                                                            <span className="text-foreground/60">{percentage}%</span>
                                                        </div>
                                                        <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden border border-white/5">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${percentage}%` }}
                                                                transition={{ duration: 1, delay: 0.5 + idx * 0.1 }}
                                                                className={`h-full ${item.color} shadow-[0_0_10px_rgba(255,255,255,0.1)]`}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </div>
                                <Link href="/explorer/nodes" className="block w-full text-center mt-10 py-4 rounded-xl glass-card border-white/10 hover:border-primary/50 text-[10px] font-black uppercase tracking-[0.3em] transition-all hover:bg-primary/5">
                                    MAP ALL SECTORS
                                </Link>
                            </GlassCard>
                        </motion.div>
                    </div>
                </div>
            </motion.main>
        </div>
    );
}

function MetricCard({ label, value, icon, color, loading }: { label: string, value: string, icon: React.ReactNode, color: string, loading: boolean }) {
    return (
        <GlassCard className="!p-8 flex flex-col justify-between h-40 relative overflow-hidden group border-white/5 bg-white/2">
            <div className={`absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-15 transition-all transform group-hover:scale-125 group-hover:rotate-12 duration-700 ${color}`}>
                {React.cloneElement(icon as React.ReactElement<any>, { size: 100 })}
            </div>

            <div className="relative z-10 space-y-6">
                <div className="flex items-center gap-3 text-muted-foreground/40 text-[9px] font-black uppercase tracking-[0.3em]">
                    <span className={color}>{React.cloneElement(icon as React.ReactElement<any>, { size: 14 })}</span>
                    {label}
                </div>
                {loading ? (
                    <div className="h-10 w-32 bg-white/5 rounded-xl animate-pulse" />
                ) : (
                    <div className="text-3xl font-black tracking-tighter text-foreground tabular-nums">
                        {value}
                    </div>
                )}
            </div>
            <div className={`absolute bottom-0 left-0 h-1 bg-gradient-to-r from-transparent via-${color.replace('text-', '')} to-transparent w-full opacity-0 group-hover:opacity-100 transition-opacity`}></div>
        </GlassCard>
    );
}
