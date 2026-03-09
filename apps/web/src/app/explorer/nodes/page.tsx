'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getNodes } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    Server,
    MapPin,
    Shield,
    Cloud,
    ChevronLeft,
    ChevronRight,
    ArrowLeft,
    Radio,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

export default function NodesPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: ['nodes', page],
        queryFn: () => getNodes(page, pageSize, true),
        refetchInterval: 30000,
    });

    const containerVariants = {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.05 } }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-8 font-mono"
        >
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link
                    href="/explorer"
                    className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit"
                >
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Nodes</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <Server className="text-primary" size={32} /> 
                            Network Relays
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Active validators and proxy nodes powering the network
                        </p>
                    </div>
                    
                    <div className="text-right">
                        <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Active Nodes</p>
                        <p className="text-3xl font-black text-white tracking-tighter">
                            {data?.active?.toLocaleString() || '0'}
                        </p>
                    </div>
                </div>
            </motion.header>

            {/* Nodes Table */}
            <motion.section variants={itemVariants}>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/5 text-white/40 text-[10px] uppercase tracking-[0.2em] font-black">
                                    <th className="px-6 py-4">Node ID</th>
                                    <th className="px-6 py-4">Location</th>
                                    <th className="px-6 py-4">Type</th>
                                    <th className="px-6 py-4 text-center">Uptime</th>
                                    <th className="px-6 py-4 text-right">Bandwidth</th>
                                    <th className="px-6 py-4 text-right">Last Seen</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {isLoading ? (
                                    Array.from({ length: 10 }).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={6} className="px-6 py-4 h-14 bg-white/5"></td>
                                        </tr>
                                    ))
                                ) : data?.nodes?.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <Radio size={48} className="text-white/10" />
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
                                                    No active nodes detected
                                                </p>
                                                <p className="text-[10px] text-white/10 max-w-md">
                                                    Nodes will appear here once they register on the network and pass health checks.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    data?.nodes?.map((node: any) => (
                                        <tr key={node.node_id} className="hover:bg-white/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="font-mono text-primary text-[11px] font-bold">
                                                    {node.node_id?.slice(0, 16)}...
                                                </div>
                                                {node.name && <div className="text-[9px] text-white/30">{node.name}</div>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2 text-[11px] text-white/60">
                                                    <MapPin size={12} className="text-white/20" />
                                                    {node.country}, {node.region}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {node.is_validator ? (
                                                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-purple-400 bg-purple-400/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
                                                        <Shield size={10} /> Validator
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-blue-400 bg-blue-400/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
                                                        <Cloud size={10} /> Proxy Node
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="flex items-center justify-center gap-3">
                                                    <div className="w-16 bg-white/5 rounded-full h-1.5 overflow-hidden">
                                                        <div
                                                            className={`h-full ${node.uptime_percent > 98 ? 'bg-emerald-500' : node.uptime_percent > 90 ? 'bg-yellow-500' : 'bg-rose-500'}`}
                                                            style={{ width: `${Math.min(node.uptime_percent, 100)}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] font-black text-white/60">{node.uptime_percent?.toFixed(1)}%</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="font-mono text-white font-bold text-sm">{node.bandwidth_gb?.toFixed(2)} GB</div>
                                                <div className="text-[9px] text-white/30">{node.active_sessions} sessions</div>
                                            </td>
                                            <td className="px-6 py-4 text-right text-[11px] text-white/40">
                                                {node.last_heartbeat ? formatDistanceToNow(new Date(node.last_heartbeat), { addSuffix: true }) : '-'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="p-6 bg-white/5 flex items-center justify-between border-t border-white/5">
                        <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">
                            Page <span className="text-white">{page}</span>
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={page === 1 || isLoading}
                                className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => setPage(page + 1)}
                                disabled={data && page * pageSize >= data.total}
                                className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </GlassCard>
            </motion.section>

            {error && (
                <motion.div 
                    variants={itemVariants}
                    className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black uppercase tracking-widest text-center"
                >
                    Failed to load nodes. Please check your connection to the ProxyHub network.
                </motion.div>
            )}
        </motion.div>
    );
}
