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
    Filter,
    XCircle,
    AlertCircle,
    Download,
} from 'lucide-react';

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
    const content = [headers, ...rows]
        .map(r => r.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

const TX_TYPES = ['all', 'transfer', 'escrow_init', 'escrow_settle', 'escrow_refund', 'stake', 'unstake', 'session_payment', 'batch_payout'];
const TX_STATUSES = ['all', 'confirmed', 'pending', 'failed'];

const TX_TYPE_COLORS: Record<string, string> = {
    transfer: 'text-blue-400 bg-blue-400/10',
    escrow_init: 'text-violet-400 bg-violet-400/10',
    escrow_settle: 'text-emerald-400 bg-emerald-400/10',
    escrow_refund: 'text-orange-400 bg-orange-400/10',
    stake: 'text-yellow-400 bg-yellow-400/10',
    unstake: 'text-rose-400 bg-rose-400/10',
    session_payment: 'text-cyan-400 bg-cyan-400/10',
    batch_payout: 'text-pink-400 bg-pink-400/10',
};

function StatusBadge({ status }: { status: string }) {
    if (status === 'confirmed') return (
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-emerald-500 bg-emerald-500/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
            <CheckCircle size={10} /> Confirmed
        </span>
    );
    if (status === 'failed') return (
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-rose-500 bg-rose-500/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
            <XCircle size={10} /> Failed
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black text-yellow-500 bg-yellow-500/10 px-3 py-1.5 rounded-lg uppercase tracking-wider">
            <Clock size={10} /> {status || 'Pending'}
        </span>
    );
}

export default function TransactionsPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;
    const [chainFilter, setChainFilter] = useState<string | undefined>(undefined);
    const [typeFilter, setTypeFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showFilters, setShowFilters] = useState(false);

    const { data, isLoading, error } = useQuery({
        queryKey: ['transactions', page, chainFilter, typeFilter, statusFilter],
        queryFn: () => getRecentTransactions(
            page, pageSize, chainFilter,
            typeFilter !== 'all' ? typeFilter : undefined,
            statusFilter !== 'all' ? statusFilter : undefined,
        ),
        refetchInterval: 10000,
    });

    // Server handles type/status filtering; keep array assignment for clarity
    const displayTxs = data?.transactions || [];

    const hasFilters = typeFilter !== 'all' || statusFilter !== 'all' || !!chainFilter;

    const containerVariants = {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.05 } },
    };
    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 },
    };

    const handleExport = () => {
        if (!displayTxs.length) return;
        const headers = ['tx_hash', 'type', 'from', 'to', 'amount', 'currency', 'fee', 'status', 'timestamp'];
        const rows = displayTxs.map((tx: any) => [
            tx.tx_hash ?? '',
            tx.tx_type ?? '',
            tx.from_address ?? '',
            tx.to_address ?? '',
            String(tx.amount ?? ''),
            tx.currency ?? 'SOL',
            String(tx.fee ?? ''),
            tx.status ?? '',
            tx.timestamp ?? '',
        ]);
        const dateTag = new Date().toISOString().slice(0, 10);
        downloadCsv(`transactions_${dateTag}.csv`, headers, rows);
    };

    const clearFilters = () => {
        setTypeFilter('all');
        setStatusFilter('all');
        setChainFilter(undefined);
        setPage(1);
    };

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
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
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Total Transactions</p>
                            <p className="text-3xl font-black text-white tracking-tighter">{data?.total?.toLocaleString() || '0'}</p>
                        </div>
                        <button
                            onClick={handleExport}
                            disabled={!displayTxs.length}
                            title="Export current page as CSV"
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all bg-white/[0.02] border-white/5 text-white/30 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                            <Download size={12} />
                            CSV
                        </button>
                        <button
                            onClick={() => setShowFilters(v => !v)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all relative ${
                                hasFilters
                                    ? 'bg-primary/10 border-primary/30 text-primary'
                                    : 'bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60'
                            }`}
                        >
                            <Filter size={12} />
                            Filters
                            {hasFilters && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary animate-pulse" />
                            )}
                        </button>
                    </div>
                </div>
            </motion.header>

            {/* Filter Panel */}
            {showFilters && (
                <motion.section
                    variants={itemVariants}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <GlassCard className="!p-6 border-white/5 bg-primary/[0.02] rounded-[2rem] space-y-5">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[10px] font-black text-white/50 uppercase tracking-widest flex items-center gap-2">
                                <Filter size={12} /> Filter Options
                            </h3>
                            {hasFilters && (
                                <button onClick={clearFilters} className="text-[9px] font-black text-rose-400 hover:text-rose-300 uppercase tracking-widest transition-colors">
                                    Clear All
                                </button>
                            )}
                        </div>

                        {/* Transaction Type */}
                        <div>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mb-2">Type</p>
                            <div className="flex flex-wrap gap-1.5">
                                {TX_TYPES.map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => { setTypeFilter(t); setPage(1); }}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border ${
                                            typeFilter === t
                                                ? 'bg-primary text-black border-primary'
                                                : 'bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60 hover:border-white/10'
                                        }`}
                                    >
                                        {t.replace(/_/g, ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Status */}
                        <div>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mb-2">Status</p>
                            <div className="flex flex-wrap gap-1.5">
                                {TX_STATUSES.map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => { setStatusFilter(s); setPage(1); }}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border ${
                                            statusFilter === s
                                                ? 'bg-primary text-black border-primary'
                                                : 'bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60 hover:border-white/10'
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Chain */}
                        <div>
                            <p className="text-[9px] font-black text-white/20 uppercase tracking-widest mb-2">Chain</p>
                            <div className="flex flex-wrap gap-1.5">
                                {['all', 'solana'].map((c) => (
                                    <button
                                        key={c}
                                        onClick={() => { setChainFilter(c === 'all' ? undefined : c); setPage(1); }}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border ${
                                            (c === 'all' ? !chainFilter : chainFilter === c)
                                                ? 'bg-primary text-black border-primary'
                                                : 'bg-white/[0.02] border-white/5 text-white/30 hover:text-white/60 hover:border-white/10'
                                        }`}
                                    >
                                        {c}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </GlassCard>
                </motion.section>
            )}

            {/* Active Filter Chips */}
            {hasFilters && (
                <motion.div variants={itemVariants} className="flex flex-wrap gap-2">
                    {typeFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-wider">
                            Type: {typeFilter.replace(/_/g, ' ')}
                            <button onClick={() => setTypeFilter('all')} className="hover:text-white transition-colors"><XCircle size={10} /></button>
                        </span>
                    )}
                    {statusFilter !== 'all' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-wider">
                            Status: {statusFilter}
                            <button onClick={() => setStatusFilter('all')} className="hover:text-white transition-colors"><XCircle size={10} /></button>
                        </span>
                    )}
                    {chainFilter && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-wider">
                            Chain: {chainFilter}
                            <button onClick={() => setChainFilter(undefined)} className="hover:text-white transition-colors"><XCircle size={10} /></button>
                        </span>
                    )}
                </motion.div>
            )}

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
                                            <td colSpan={6} className="px-6 py-4 h-14 bg-white/5" />
                                        </tr>
                                    ))
                                ) : displayTxs.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <Fingerprint size={48} className="text-white/10" />
                                                <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
                                                    {hasFilters ? 'No transactions match the current filters' : 'No transactions indexed yet'}
                                                </p>
                                                {hasFilters && (
                                                    <button onClick={clearFilters} className="text-[9px] font-black text-primary hover:text-primary/80 uppercase tracking-widest transition-colors">
                                                        Clear Filters
                                                    </button>
                                                )}
                                                {!hasFilters && (
                                                    <p className="text-[10px] text-white/10 max-w-md">
                                                        The blockchain indexer is starting up. Transactions will appear here once the sync is complete.
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    displayTxs.map((tx: any) => {
                                        const typeColor = TX_TYPE_COLORS[tx.tx_type] || 'text-white/50 bg-white/5';
                                        return (
                                            <tr key={tx.tx_hash} className="hover:bg-white/[0.03] transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-1 h-8 rounded-full bg-primary/40" />
                                                        <Link
                                                            href={`/explorer/transactions/${tx.tx_hash}`}
                                                            className="font-mono text-primary hover:text-primary/80 text-[11px] font-bold truncate max-w-[150px] transition-colors"
                                                        >
                                                            {tx.tx_hash?.slice(0, 12)}...{tx.tx_hash?.slice(-8)}
                                                        </Link>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-3 py-1 rounded-lg text-[9px] font-black border border-transparent uppercase tracking-wider ${typeColor}`}>
                                                        {tx.tx_type?.replace(/_/g, ' ')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col gap-1 font-mono text-[10px]">
                                                        <Link href={`/explorer/wallets/${tx.from_address}`} className="text-white/30 hover:text-white/60 truncate max-w-[120px] transition-colors">
                                                            {tx.from_address?.slice(0, 8)}...{tx.from_address?.slice(-6)}
                                                        </Link>
                                                        <div className="flex items-center gap-1 text-white/10">
                                                            <ArrowRightLeft size={10} className="rotate-90" />
                                                            <Link href={`/explorer/wallets/${tx.to_address}`} className="text-white/30 hover:text-white/60 truncate max-w-[120px] transition-colors">
                                                                {tx.to_address?.slice(0, 8)}...{tx.to_address?.slice(-6)}
                                                            </Link>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="font-mono text-white font-bold text-sm">
                                                        {tx.amount != null ? tx.amount.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}
                                                    </div>
                                                    <div className="text-[9px] text-white/30 uppercase">{tx.currency || 'SOL'}</div>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <StatusBadge status={tx.status} />
                                                </td>
                                                <td className="px-6 py-4 text-right text-[11px] text-white/40">
                                                    {tx.timestamp
                                                        ? formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true })
                                                        : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="p-6 bg-white/[0.02] flex items-center justify-between border-t border-white/5">
                        <div className="flex items-center gap-4">
                            <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">
                                Page <span className="text-white">{page}</span>
                                {data?.total ? ` of ${Math.ceil(data.total / pageSize)}` : ''}
                            </p>
                            {hasFilters && (
                                <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">
                                    {displayTxs.length} results
                                </p>
                            )}
                        </div>
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
                                disabled={!data || page * pageSize >= (data.total ?? 0)}
                                className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </GlassCard>
            </motion.section>

            {error && (
                <motion.div variants={itemVariants} className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black uppercase tracking-widest text-center flex items-center justify-center gap-3">
                    <AlertCircle size={16} />
                    Failed to load transactions. Please check your connection to the ProxyHub network.
                </motion.div>
            )}
        </motion.div>
    );
}
