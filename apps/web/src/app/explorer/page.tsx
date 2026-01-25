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
    Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

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

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16">
                <div className="flex flex-col gap-8">

                    {/* Header & Search */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-600">
                                System Explorer
                            </h1>
                            <p className="text-gray-400 mt-2">
                                Real-time visibility into the ProxyHub Hybrid Blockchain Network
                            </p>
                        </div>

                        <div className="relative w-full md:w-96">
                            <input
                                type="text"
                                placeholder="Search tx hash, address, or block..."
                                className="w-full bg-white/5 border border-white/10 rounded-full py-3 px-12 focus:outline-none focus:border-cyan-500/50 transition-colors"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        // Implement search navigation
                                        const val = e.currentTarget.value;
                                        if (val.length > 60) window.location.href = `/explorer/transactions/${val}`;
                                        else if (val.length > 30) window.location.href = `/explorer/wallets/${val}`;
                                        else window.location.href = `/explorer/blocks/${val}`;
                                    }
                                }}
                            />
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                        </div>
                    </div>

                    {/* Key Metrics Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <MetricCard
                            label="Block Height"
                            value={metrics?.block_height.toLocaleString() || '-'}
                            icon={<Box className="text-cyan-400" />}
                            loading={loadingMetrics}
                        />
                        <MetricCard
                            label="Active Nodes"
                            value={metrics?.active_nodes.toLocaleString() || '-'}
                            icon={<Server className="text-purple-400" />}
                            loading={loadingMetrics}
                        />
                        <MetricCard
                            label="24h Volume (SOL)"
                            value={metrics?.total_volume ? metrics.total_volume.toFixed(2) : '-'}
                            icon={<Activity className="text-green-400" />}
                            loading={loadingMetrics}
                        />
                        <MetricCard
                            label="Bandwidth / 24h"
                            value={metrics?.total_bandwidth_gb ? `${metrics.total_bandwidth_gb.toFixed(2)} GB` : '-'}
                            icon={<Globe className="text-orange-400" />}
                            loading={loadingMetrics}
                        />
                    </div>

                    {/* Network Health Banner */}
                    <GlassCard className="p-4 flex items-center justify-between border-l-4 border-l-cyan-500 bg-cyan-950/10">
                        <div className="flex items-center gap-4">
                            <ShieldCheck className="w-8 h-8 text-cyan-500" />
                            <div>
                                <h3 className="font-semibold text-lg">Network Status: {health?.status === 'healthy' ? 'Operational' : 'Degraded'}</h3>
                                <div className="flex gap-4 text-sm text-gray-400">
                                    <span className="flex items-center gap-1">
                                        <span className={`w-2 h-2 rounded-full ${health?.solana_health === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`} /> Solana
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <span className={`w-2 h-2 rounded-full ${health?.database_health === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`} /> Indexer
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="text-right hidden sm:block">
                            <p className="text-xs text-gray-500">Avg Response</p>
                            <p className="font-mono text-cyan-300">{health?.avg_response_time_ms ? `${health.avg_response_time_ms.toFixed(0)}ms` : '-'}</p>
                        </div>
                    </GlassCard>

                    {/* Main Content Split */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                        {/* Recent Transactions */}
                        <div className="lg:col-span-2 space-y-4">
                            <div className="flex justify-between items-center">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <ArrowRightLeft className="w-5 h-5 text-cyan-400" /> Recent Transactions
                                </h2>
                                <Link href="/explorer/transactions" className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors">
                                    View All
                                </Link>
                            </div>

                            <div className="space-y-3">
                                {loadingTx ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
                                    ))
                                ) : transactions?.transactions?.map((tx) => (
                                    <GlassCard key={tx.tx_hash} className="p-4 hover:bg-white/5 transition-colors group">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${tx.tx_type === 'transfer' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                                                    <ArrowRightLeft className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <Link href={`/explorer/transactions/${tx.tx_hash}`} className="font-mono text-sm text-cyan-300 group-hover:underline">
                                                        {tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-8)}
                                                    </Link>
                                                    <div className="text-xs text-gray-500 mt-1 flex gap-2">
                                                        <span>{formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true })}</span>
                                                        <span className="text-gray-600">•</span>
                                                        <span>{tx.tx_type}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-mono text-white">{tx.amount.toFixed(4)} {tx.currency}</p>
                                                <p className={`text-xs ${tx.status === 'confirmed' ? 'text-green-400' : 'text-yellow-400'}`}>
                                                    {tx.status}
                                                </p>
                                            </div>
                                        </div>
                                    </GlassCard>
                                ))}
                                {transactions?.transactions?.length === 0 && (
                                    <div className="text-center py-8 text-gray-500">No recent transactions found</div>
                                )}
                            </div>
                        </div>

                        {/* Recent Blocks & Nodes */}
                        <div className="space-y-8">

                            {/* Recent Blocks */}
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <h2 className="text-xl font-semibold flex items-center gap-2">
                                        <Box className="w-5 h-5 text-purple-400" /> Recent Blocks
                                    </h2>
                                    <Link href="/explorer/blocks" className="text-sm text-purple-400 hover:text-purple-300 transition-colors">
                                        View All
                                    </Link>
                                </div>

                                <div className="space-y-3">
                                    {loadingBlocks ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <div key={i} className="h-14 bg-white/5 rounded-xl animate-pulse" />
                                        ))
                                    ) : blocks?.blocks?.map((block) => (
                                        <GlassCard key={block.block_hash} className="p-3">
                                            <div className="flex justify-between items-center">
                                                <div>
                                                    <Link href={`/explorer/blocks/${block.block_number}`} className="font-mono text-sm text-purple-300 hover:underline">
                                                        #{block.block_number}
                                                    </Link>
                                                    <p className="text-xs text-gray-500 mt-0.5">
                                                        {formatDistanceToNow(new Date(block.timestamp))} ago
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-gray-400">{block.transaction_count} txs</p>
                                                    <p className="text-[10px] text-gray-600 font-mono">{block.chain}</p>
                                                </div>
                                            </div>
                                        </GlassCard>
                                    ))}
                                </div>
                            </div>

                            {/* Node Stats Preview */}
                            <GlassCard className="p-6 bg-gradient-to-br from-gray-900 to-black border-gray-800">
                                <div className="flex items-center gap-3 mb-4">
                                    <Database className="w-5 h-5 text-gray-400" />
                                    <h3 className="font-semibold text-gray-300">Node Distribution</h3>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-500">Active Validators</span>
                                        <span className="text-white font-mono">{metrics?.active_nodes || '-'}</span>
                                    </div>
                                    <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                                        <div className="bg-cyan-500 h-full w-[70%]" />
                                    </div>
                                    <div className="flex justify-between text-xs text-gray-500 pt-2">
                                        <span>North America (70%)</span>
                                        <span>Europe (30%)</span>
                                    </div>
                                </div>
                                <Link href="/explorer/nodes" className="block w-full text-center mt-6 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors">
                                    View Node Map
                                </Link>
                            </GlassCard>

                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

function MetricCard({ label, value, icon, loading }: { label: string, value: string, icon: React.ReactNode, loading: boolean }) {
    return (
        <GlassCard className="p-6 flex flex-col justify-between h-32 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-3 opacity-20 group-hover:opacity-40 transition-opacity transform group-hover:scale-110 duration-500">
                {React.cloneElement(icon as React.ReactElement<any>, { size: 48 })}
            </div>
            <div className="relative z-10">
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
                    {icon}
                    {label}
                </div>
                {loading ? (
                    <div className="h-8 w-24 bg-white/10 rounded animate-pulse" />
                ) : (
                    <div className="text-2xl font-bold font-mono tracking-tight text-white">
                        {value}
                    </div>
                )}
            </div>
        </GlassCard>
    );
}
