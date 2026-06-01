'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getBlocks } from '@/lib/services/explorer';
import Link from 'next/link';
import { Box, ChevronLeft, ChevronRight, Clock, Database, ArrowLeft } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';
import { motion } from 'framer-motion';

export default function BlocksExplorer() {
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: ['explorer-blocks', page],
        queryFn: () => getBlocks(page, pageSize),
        refetchInterval: 10000,
    });

    const total = data?.total ?? 0;
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    const hasBlocks = total > 0;

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
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Blocks</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <Box className="text-primary" size={32} /> 
                            Sequence Blocks
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Historical record of all verified segment hashes
                        </p>
                    </div>
                    
                    <div className="text-right">
                        <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Total Blocks</p>
                        <p className="text-3xl font-black text-white tracking-tighter">
                            {data?.total?.toLocaleString() || '0'}
                        </p>
                    </div>
                </div>
            </motion.header>

            {/* Blocks Table */}
            <motion.section variants={itemVariants}>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/5 text-white/40 text-[10px] uppercase tracking-[0.2em] font-black">
                                    <th className="px-6 py-4">Block</th>
                                    <th className="px-6 py-4">Hash</th>
                                    <th className="px-6 py-4">Time</th>
                                    <th className="px-6 py-4 text-center">Transactions</th>
                                    <th className="px-6 py-4">Chain</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {isLoading ? (
                                    Array.from({ length: 10 }).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={5} className="px-6 py-4 h-14 bg-white/5"></td>
                                        </tr>
                                    ))
                                ) : data?.blocks?.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <Database size={48} className="text-white/10" />
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
                                                    No blocks indexed yet
                                                </p>
                                                <p className="text-[10px] text-white/10 max-w-md">
                                                    The blockchain indexer is starting up. Blocks will appear here once the sync is complete.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    data?.blocks?.map((block: any) => (
                                        <tr key={block.block_hash} className="hover:bg-white/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/explorer/blocks/${block.block_number}`}
                                                    className="font-mono text-primary font-bold text-sm hover:underline"
                                                >
                                                    #{block.block_number?.toLocaleString()}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-[10px] text-white/30 group-hover:text-white/50 transition-colors">
                                                    {block.block_hash?.slice(0, 20)}...{block.block_hash?.slice(-12)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-[11px] text-white/40">
                                                <div className="flex items-center gap-2">
                                                    <Clock size={12} />
                                                    {block.timestamp ? formatDistanceToNow(new Date(block.timestamp), { addSuffix: true }) : '-'}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="px-3 py-1 rounded-lg bg-white/5 text-[10px] text-white/60 font-bold border border-white/10">
                                                    {block.transaction_count} TXS
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-[10px] text-white/30 font-mono uppercase tracking-widest">
                                                    {block.chain}
                                                </span>
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
                            {hasBlocks ? (
                                <>
                                    Page <span className="text-white">{page}</span> of{' '}
                                    <span className="text-white">{totalPages}</span>
                                </>
                            ) : (
                                <span className="text-white/20">No blocks indexed</span>
                            )}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={!hasBlocks || page === 1}
                                className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => setPage(Math.min(totalPages, page + 1))}
                                disabled={!hasBlocks || page >= totalPages}
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
                    Failed to load blocks. Please check your connection to the ProxyHub network.
                </motion.div>
            )}
        </motion.div>
    );
}
