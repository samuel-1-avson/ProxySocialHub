'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { getRecentTransactions } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowRightLeft,
    ChevronLeft,
    ChevronRight,
    Search,
    Filter,
    CheckCircle,
    Clock,
    ExternalLink
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function TransactionsPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const [chainFilter, setChainFilter] = useState<string | undefined>(undefined);

    const { data, isLoading } = useQuery({
        queryKey: ['transactions', page, chainFilter],
        queryFn: () => getRecentTransactions(page, pageSize, chainFilter),
        refetchInterval: 10000,
    });

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16">
                <div className="flex flex-col gap-8">

                    <div className="flex justify-between items-end">
                        <div>
                            <Link href="/explorer" className="text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-1 mb-2">
                                <ChevronLeft className="w-4 h-4" /> Back to Dashboard
                            </Link>
                            <h1 className="text-3xl font-bold">Transactions</h1>
                        </div>

                        <div className="flex gap-2">
                            <select
                                className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50"
                                value={chainFilter || ''}
                                onChange={(e) => setChainFilter(e.target.value || undefined)}
                            >
                                <option value="">All Chains</option>
                                <option value="solana">Solana</option>
                                <option value="bittensor">Bittensor</option>
                            </select>
                        </div>
                    </div>

                    <GlassCard className="overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10 text-left text-gray-400 text-sm">
                                        <th className="p-4 font-medium">Tx Hash</th>
                                        <th className="p-4 font-medium">Type</th>
                                        <th className="p-4 font-medium">From / To</th>
                                        <th className="p-4 font-medium text-right">Amount</th>
                                        <th className="p-4 font-medium text-center">Status</th>
                                        <th className="p-4 font-medium text-right">Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {isLoading ? (
                                        Array.from({ length: 10 }).map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-32" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-16" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-48" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-20 ml-auto" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-16 mx-auto" /></td>
                                                <td className="p-4"><div className="h-4 bg-white/5 rounded w-24 ml-auto" /></td>
                                            </tr>
                                        ))
                                    ) : data?.transactions?.map((tx) => (
                                        <tr key={tx.tx_hash} className="hover:bg-white/5 transition-colors group">
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <span className={`w-1 h-8 rounded-full ${tx.chain === 'solana' ? 'bg-green-500' : 'bg-purple-500'}`} />
                                                    <Link href={`/explorer/transactions/${tx.tx_hash}`} className="font-mono text-cyan-400 hover:underline flex items-center gap-1">
                                                        {tx.tx_hash.slice(0, 8)}...{tx.tx_hash.slice(-8)}
                                                    </Link>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="px-2 py-1 rounded text-xs bg-white/5 text-gray-300 border border-white/10 uppercase tracking-wider">
                                                    {tx.tx_type}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col gap-1 font-mono text-xs">
                                                    <Link href={`/explorer/wallets/${tx.from_address}`} className="text-gray-400 hover:text-white truncate max-w-[150px]">
                                                        {tx.from_address.slice(0, 6)}...{tx.from_address.slice(-6)}
                                                    </Link>
                                                    <div className="flex items-center gap-1 text-gray-600">
                                                        <ArrowRightLeft className="w-3 h-3 rotate-90" />
                                                        <Link href={`/explorer/wallets/${tx.to_address}`} className="text-gray-400 hover:text-white truncate max-w-[150px]">
                                                            {tx.to_address.slice(0, 6)}...{tx.to_address.slice(-6)}
                                                        </Link>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="font-mono text-white">{tx.amount.toLocaleString()}</div>
                                                <div className="text-xs text-gray-500">{tx.currency}</div>
                                            </td>
                                            <td className="p-4 text-center">
                                                {tx.status === 'confirmed' ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                                                        <CheckCircle className="w-3 h-3" /> Confirmed
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded-full">
                                                        <Clock className="w-3 h-3" /> {tx.status}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-4 text-right text-sm text-gray-400">
                                                {formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {data?.transactions?.length === 0 && (
                                <div className="p-12 text-center text-gray-500">
                                    No transactions found
                                </div>
                            )}
                        </div>

                        {/* Pagination */}
                        <div className="p-4 border-t border-white/10 flex justify-between items-center">
                            <button
                                className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1 || isLoading}
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <span className="text-sm text-gray-400">
                                Page {page} {data?.total ? `of ${Math.ceil(data.total / pageSize)}` : ''}
                            </span>
                            <button
                                className="p-2 hover:bg-white/10 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => setPage(p => p + 1)}
                                disabled={data && page * pageSize >= data.total}
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </GlassCard>

                </div>
            </main>
        </div>
    );
}
