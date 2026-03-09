'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getRecentTransactions } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowRightLeft,
    ChevronLeft,
    ChevronRight,
    CheckCircle,
    Clock,
    ArrowLeft,
    Fingerprint,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

export default function TransactionsPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const [chainFilter, setChainFilter] = useState<string | undefined>(undefined);

    const { data, isLoading, error } = useQuery({
        queryKey: ['transactions', page, chainFilter],
        queryFn: () => getRecentTransactions(page, pageSize, chainFilter),
        refetchInterval: 10000,
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
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Transactions</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <ArrowRightLeft className="text-primary" size={32} /> 
                            Settlement Stream
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            Live protocol transaction history
                        </p>
                    </div>
                    
                    <div className="text-right">
                        <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Total Transactions</p>
                        <p className="text-3xl font-black text-white tracking-tighter">
                            {data?.total?.toLocaleString() || '0'}
                        </p>
                    </div>
                </div>
            </motion.header>

            {/* Transactions Table */}
            <motion.section variants={itemVariants}>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-white/5 text-white/40 text-[10px] uppercase tracking-[0.2em] font-black">
                                    <th className="px-6 py-4">Tx Hash</th>
                                    <th className="px-6 py-4">Type</th>
                                    <th className="px-6 py-4">From / To</th>
                                    <th className="px-6 py-4 text-right">Amount</th>
                                    <th className="px-6 py-4 text-center">Status</th>
                                    <th className="px-6 py-4 text-right">Time</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {isLoading ? (
                                    Array.from({ length: 10 }).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={6} className="px-6 py-4 h-14 bg-white/5"></td>
                                        </tr>
                                    ))
                                ) : data?.transactions?.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <Fingerprint size={48} className="text-white/10" />
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
                                                    No transactions indexed yet
                                                </p>
                                                <p className="text-[10px] text-white/10 max-w-md">
                                                    The blockchain indexer is starting up. Transactions will appear here once the sync is complete.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    data?.transactions?.map((tx: any) => (
                                        <tr key={tx.tx_hash} className="hover:bg-white/5 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-1 h-8 rounded-full bg-primary/40" />
                                                    <Link 
                                                        href={`/explorer/transactions/${tx.tx_hash}`}
                                                        className="font-mono text-primary hover:text-primary/80 text-[11px] font-bold truncate max-w-[150px]"
                                                    >
                                                        {tx.tx_hash?.slice(0, 12)}...{tx.tx_hash?.slice(-8)}
                                                    </Link>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-3 py-1 rounded-lg text-[9px] font-black bg-white/5 text-white/60 border border-white/10 uppercase tracking-wider">
                                                    {tx.tx_type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1 font-mono text-[10px]">
                                                    <Link 
                                                        href={`/explorer/wallets/${tx.from_address}`}
                                                        className="text-white/30 hover:text-white/60 truncate max-w-[120px] transition-colors"
                                                    >
                                                        {tx.from_address?.slice(0, 8)}...{tx.from_address?.slice(-6)}
                                                    </Link>
                                                    <div className="flex items-center gap-1 text-white/10">
                                                        <ArrowRightLeft size={10} className="rotate-90" />
                                                        <Link 
                                                            href={`/explorer/wallets/${tx.to_address}`}
                                                            className="text-white/30 hover:text-white/60 truncate max-w-[120px] transition-colors"
                                                        >
                                                            {tx.to_address?.slice(0, 8)}...{tx.to_address?.slice(-6)}
                                                        </Link>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="font-mono text-white font-bold text-sm">{tx.amount?.toLocaleString()}</div>
                                                <div className="text-[9px] text-white/30 uppercase">{tx.currency}</div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {tx.status === 'confirmed' ? (
                                                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
                                                        <CheckCircle size={10} /> Confirmed
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
                                                        <Clock size={10} /> {tx.status}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right text-[11px] text-white/40">
                                                {tx.timestamp ? formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true }) : '-'}
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
                            Page <span className="text-white">{page}</span> {data?.total ? `of ${Math.ceil(data.total / pageSize)}` : ''}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1 || isLoading}
                                className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => setPage(p => p + 1)}
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
                    Failed to load transactions. Please check your connection to the ProxyHub network.
                </motion.div>
            )}
        </motion.div>
    );
}
