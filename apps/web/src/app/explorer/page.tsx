'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import {
    getExplorerMetrics,
    getRecentTransactions,
    getBlocks,
    getNetworkHealth
} from '@/lib/services/explorer';
import { useRouter } from 'next/navigation';
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
    Hexagon,
    Target,
    Radar,
    Terminal,
    Fingerprint,
    History,
    Network
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export default function ExplorerDashboard() {
    const router = useRouter();
    const [searchQuery, setSearchQuery] = React.useState('');

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
        hidden: { opacity: 0, scale: 0.98, y: 10 },
        show: { opacity: 1, scale: 1, y: 0 }
    };

    const handleSearch = (val: string) => {
        const query = val.trim();
        if (!query) return;

        // Solana Transaction Hash (64-90 chars, base58)
        if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(query)) {
            router.push(`/explorer/transactions/${query}`);
        }
        // Solana Wallet Address (32-44 chars, base58)
        else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)) {
            router.push(`/explorer/wallets/${query}`);
        }
        // Block Number (numeric)
        else if (/^\d+$/.test(query)) {
            router.push(`/explorer/blocks/${query}`);
        }
        // Default to node search
        else {
            router.push(`/explorer/nodes?q=${query}`);
        }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 font-mono"
        >
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
                        <div className="absolute -inset-1 bg-primary/5 blur-lg opacity-0 group-hover:opacity-100 transition-opacity" />
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-white/20 w-4 h-4" />
                        <input
                            type="text"
                            placeholder="INTERCEPT ID, HASH, OR WALLET..."
                            className="w-full bg-white/[0.02] border border-white/5 rounded-2xl py-4 pl-14 pr-24 text-[10px] uppercase font-black tracking-widest text-white placeholder:text-white/10 outline-none focus:border-primary/40 focus:bg-white/[0.05] transition-all"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSearch(searchQuery);
                            }}
                        />
                        <button
                            onClick={() => handleSearch(searchQuery)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-primary/20 hover:bg-primary/40 border border-primary/20 text-primary text-[9px] font-black uppercase rounded-lg transition-all"
                        >
                            Scan
                        </button>
                    </div>
                    <div className="flex items-center gap-4 px-6 py-4 rounded-2xl bg-white/[0.02] border border-white/5">
                        <div className="flex flex-col items-end">
                            <div className="text-[8px] font-black text-white/10 uppercase tracking-widest">Network Load</div>
                            <div className="text-[11px] font-black text-emerald-500 uppercase flex items-center gap-2">
                                <Activity size={12} className="animate-pulse" /> Optimal
                            </div>
                        </div>
                    </div>
                </div>
            </motion.header>

            {/* Live Metrics Matrix */}
            <motion.section variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: 'Block Height', value: metrics?.block_height?.toLocaleString() || '0', icon: Database, color: 'text-primary' },
                    { label: 'Active Relays', value: metrics?.active_nodes?.toLocaleString() || '0', icon: Server, color: 'text-blue-500' },
                    { label: '24H Volume', value: `${metrics?.total_volume?.toFixed(2) || '0'} SOL`, icon: ArrowRightLeft, color: 'text-emerald-500' },
                    { label: 'Throughput', value: `${metrics?.total_bandwidth_gb?.toFixed(2) || '0'} GB`, icon: Zap, color: 'text-yellow-500' }
                ].map((stat, i) => (
                    <GlassCard key={i} className="!p-6 border-white/5 bg-white/[0.01] rounded-[2rem] group hover:bg-white/[0.03] transition-all">
                        <div className="flex justify-between items-start mb-4">
                            <stat.icon size={18} className={`${stat.color} opacity-40 group-hover:opacity-100 transition-opacity`} />
                            <div className="w-8 h-1 bg-white/5 rounded-full overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: loadingMetrics ? 0 : '100%' }}
                                    className={`h-full ${stat.color.replace('text-', 'bg-')}/40`}
                                />
                            </div>
                        </div>
                        <div className="text-3xl font-black text-white tracking-tighter mb-1">
                            {loadingMetrics ? <div className="h-8 w-24 bg-white/5 animate-pulse rounded" /> : stat.value}
                        </div>
                        <div className="text-[9px] font-black uppercase text-white/20 tracking-[0.2em]">{stat.label}</div>
                    </GlassCard>
                ))}
            </motion.section>

            {/* System Health HUD */}
            <motion.section variants={itemVariants}>
                <GlassCard className="!p-8 border-white/5 bg-primary/[0.02] rounded-[2.5rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
                        <Network size={120} />
                    </div>
                    <div className="flex flex-col lg:flex-row justify-between items-center gap-10 relative z-10">
                        <div className="flex items-center gap-8">
                            <div className="w-16 h-16 rounded-[1.8rem] bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
                                <ShieldCheck size={32} />
                            </div>
                            <div className="space-y-1">
                                <h3 className="text-2xl font-black uppercase tracking-tighter text-white">System Status: {health?.status?.toUpperCase() || 'OPTIMAL'}</h3>
                                <div className="flex items-center gap-6 text-[10px] font-black uppercase tracking-widest text-white/30">
                                    <span className="flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${health?.solana_health === 'healthy' ? 'bg-emerald-500' : 'bg-rose-500'}`} /> Blockchain Indexer</span>
                                    <span className="flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${health?.database_health === 'healthy' ? 'bg-emerald-500' : 'bg-rose-500'}`} /> Telemetry Vault</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-12 items-center">
                            <div className="text-right">
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] mb-1">Response Latency</div>
                                <div className="text-3xl font-black text-white">{health?.avg_response_time_ms?.toFixed(0) || '18'}<span className="text-sm opacity-20 ml-1">ms</span></div>
                            </div>
                            <div className="w-px h-12 bg-white/5 hidden lg:block" />
                            <div className="text-right">
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] mb-1">Consensus Rate</div>
                                <div className="text-3xl font-black text-white">99.9<span className="text-sm opacity-20 ml-1">%</span></div>
                            </div>
                        </div>
                    </div>
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

                    <div className="space-y-4">
                        {loadingTx ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-20 bg-white/[0.01] animate-pulse border border-white/5 rounded-2xl" />
                            ))
                        ) : (!transactions?.transactions || transactions.transactions.length === 0) ? (
                            <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-[2.5rem] bg-white/[0.01]">
                                <Fingerprint size={48} className="mx-auto text-white/5 mb-6" />
                                <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.5em]">No activity detected in segment</p>
                            </div>
                        ) : (
                            transactions.transactions.map((tx: any, i: number) => (
                                <GlassCard key={tx.tx_hash || i} className="group !p-5 border-white/5 bg-white/[0.01] rounded-2xl hover:bg-white/[0.03] transition-all">
                                    <div className="flex items-center justify-between gap-6">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="w-10 h-10 rounded-xl bg-black border border-white/5 flex items-center justify-center text-primary group-hover:border-primary/20 transition-colors">
                                                <Target size={16} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-[11px] font-black text-white truncate uppercase tracking-wider">{tx.tx_hash}</div>
                                                <div className="text-[9px] font-black text-white/20 uppercase tracking-widest mt-0.5 flex items-center gap-2">
                                                    <Clock size={10} /> {tx.timestamp ? formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true }) : 'Processing...'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <div className="text-sm font-black text-white">{(tx.amount || 0).toFixed(4)} {tx.currency || 'SOL'}</div>
                                            <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mt-1">{tx.status || 'Confirmed'}</div>
                                        </div>
                                    </div>
                                </GlassCard>
                            ))
                        )}
                    </div>
                </motion.section>

                {/* Sequence Blocks */}
                <motion.section variants={itemVariants} className="xl:col-span-4 space-y-6">
                    <div className="space-y-1 px-4">
                        <h2 className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                            <Box size={18} className="text-primary" /> Sequence Blocks
                        </h2>
                        <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Verified segment hashes</p>
                    </div>

                    <div className="space-y-4">
                        {loadingBlocks ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="h-28 bg-white/[0.01] animate-pulse border border-white/5 rounded-[2rem]" />
                            ))
                        ) : (!blocks?.blocks || blocks.blocks.length === 0) ? (
                            <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-[2.5rem] bg-white/[0.01]">
                                <Hexagon size={48} className="mx-auto text-white/5 mb-6 animate-spin-slow" />
                                <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.5em]">Syncing chain state...</p>
                            </div>
                        ) : (
                            blocks.blocks.map((block: any, i: number) => (
                                <GlassCard key={block.block_hash || i} className="group !p-6 border-white/5 bg-white/[0.01] rounded-2xl hover:bg-white/[0.03] transition-all relative overflow-hidden">
                                    <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                        <History size={40} />
                                    </div>
                                    <div className="flex items-center justify-between relative z-10">
                                        <div className="space-y-1">
                                            <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Block Height</div>
                                            <div className="text-2xl font-black text-white tracking-tighter">{(block.block_number || 0).toLocaleString()}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em] mb-1">Grid Distribution</div>
                                            <div className="flex gap-1 justify-end">
                                                {[1, 1, 0.7, 0.4].map((v, i) => (
                                                    <div key={i} className="w-1.5 h-3 bg-white/5 rounded-full overflow-hidden">
                                                        <div className="h-full bg-primary/40" style={{ height: `${v * 100}%` }} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </GlassCard>
                            ))
                        )}
                    </div>
                </motion.section>
            </div>
        </motion.div>
    );
}
