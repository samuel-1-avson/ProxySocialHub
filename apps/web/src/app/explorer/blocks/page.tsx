'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { getBlocks } from '@/lib/services/explorer';
import Link from 'next/link';
import { Box, ChevronLeft, ChevronRight, Clock, Database } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useState } from 'react';

export default function BlocksExplorer() {
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: ['explorer-blocks', page],
        queryFn: () => getBlocks(page, pageSize),
        refetchInterval: 10000,
    });

    const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16">
                <div className="flex flex-col gap-6">
                    {/* Breadcrumbs */}
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Link href="/explorer" className="hover:text-cyan-400 transition-colors">Explorer</Link>
                        <span>/</span>
                        <span className="text-gray-300">Blocks</span>
                    </div>

                    <div className="flex justify-between items-end">
                        <div>
                            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                                <Box className="text-purple-500" /> Blockchain Blocks
                            </h1>
                            <p className="text-gray-400 mt-1">
                                Historical record of all blocks processed by the network
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-gray-500 uppercase tracking-widest">Total Blocks</p>
                            <p className="text-2xl font-mono font-bold text-cyan-400">{data?.total?.toLocaleString() || '-'}</p>
                        </div>
                    </div>

                    <GlassCard className="overflow-hidden border-white/5">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-white/5 text-gray-400 text-xs uppercase tracking-wider font-semibold">
                                        <th className="px-6 py-4">Block</th>
                                        <th className="px-6 py-4">Hash</th>
                                        <th className="px-6 py-4">Time</th>
                                        <th className="px-6 py-4">Transactions</th>
                                        <th className="px-6 py-4">Chain</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {isLoading ? (
                                        Array.from({ length: 10 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td colSpan={5} className="px-6 py-4 h-12 bg-white/5"></td>
                                            </tr>
                                        ))
                                    ) : data?.blocks?.map((block) => (
                                        <tr key={block.block_hash} className="hover:bg-white/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <Link
                                                    href={`/explorer/blocks/${block.block_number}`}
                                                    className="font-mono text-purple-400 hover:text-purple-300 font-bold"
                                                >
                                                    #{block.block_number}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="font-mono text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
                                                    {block.block_hash.slice(0, 16)}...{block.block_hash.slice(-16)}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-400">
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-3 h-3" />
                                                    {formatDistanceToNow(new Date(block.timestamp), { addSuffix: true })}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-2 py-1 rounded bg-white/5 text-xs text-gray-300 border border-white/10">
                                                    {block.transaction_count} txs
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-xs text-gray-500 font-mono uppercase">
                                                    {block.chain}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="p-6 bg-white/5 flex items-center justify-between border-t border-white/5">
                            <p className="text-sm text-gray-500">
                                Showing page <span className="text-white">{page}</span> of <span className="text-white">{totalPages || 1}</span>
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPage(Math.max(1, page - 1))}
                                    disabled={page === 1}
                                    className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                                    disabled={page >= totalPages}
                                    className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </GlassCard>

                    {error && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
                            Failed to load blocks. Please check your connection to the ProxyHub network.
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
