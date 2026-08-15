'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getBlockDetail, TransactionSummary } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowLeft,
    Box,
    Clock,
    Hash,
    Layers,
    ArrowRightLeft,
    CheckCircle,
    ChevronRight,
    ChevronLeft,
    Database,
    Cpu,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ExplorerErrorState } from '@/components/explorer/ExplorerErrorState';

export default function BlockDetailPage() {
    const params = useParams();
    const router = useRouter();
    const blockNumber = params.number as string;

    const { data: block, isLoading, error } = useQuery({
        queryKey: ['block-detail', blockNumber],
        queryFn: () => getBlockDetail(blockNumber),
    });

    const containerVariants = {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.08 } },
    };
    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 },
    };

    if (error) {
        return (
            <ExplorerErrorState
                error={error}
                entity="Block"
                backHref="/explorer/blocks"
                backLabel="Return to blocks"
            />
        );
    }

    const fields = block ? [
        { label: 'Block Number', value: block.block_number?.toLocaleString(), icon: Layers },
        { label: 'Chain', value: block.chain?.toUpperCase() || 'SOLANA', icon: Database },
        { label: 'Block Hash', value: block.block_hash, icon: Hash, mono: true, truncate: true },
        { label: 'Transactions', value: block.transaction_count?.toLocaleString() ?? '0', icon: ArrowRightLeft },
        { label: 'Timestamp', value: block.timestamp ? format(new Date(block.timestamp), 'PPpp') : '—', icon: Clock },
        { label: 'Validator', value: block.validator_pubkey || '—', icon: Cpu, mono: true, truncate: true },
    ] : [];

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-border pb-8">
                <div className="flex items-center gap-4">
                    <Link href="/explorer/blocks" className="flex items-center gap-2 text-[10px] font-black text-muted-foreground hover:text-primary transition-colors uppercase tracking-[0.3em]">
                        <ArrowLeft size={14} /> All Blocks
                    </Link>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em]">#{blockNumber}</span>
                </div>

                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Block</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-foreground flex items-center gap-4">
                            <Box className="text-primary" size={32} />
                            Block #{blockNumber}
                        </h1>
                        {block?.timestamp && (
                            <p className="text-[11px] font-black text-muted-foreground uppercase tracking-widest mt-2 flex items-center gap-2">
                                <Clock size={11} />
                                {formatDistanceToNow(new Date(block.timestamp), { addSuffix: true })}
                            </p>
                        )}
                    </div>

                    {/* Navigate between blocks */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => router.push(`/explorer/blocks/${Number(blockNumber) - 1}`)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-primary hover:border-primary/20 text-[9px] font-black uppercase tracking-widest transition-all"
                        >
                            <ChevronLeft size={12} /> Prev
                        </button>
                        <button
                            onClick={() => router.push(`/explorer/blocks/${Number(blockNumber) + 1}`)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-primary hover:border-primary/20 text-[9px] font-black uppercase tracking-widest transition-all"
                        >
                            Next <ChevronRight size={12} />
                        </button>
                    </div>
                </div>
            </motion.header>

            {isLoading ? (
                <div className="space-y-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-16 bg-card animate-pulse border border-border rounded-2xl" />
                    ))}
                </div>
            ) : error ? (
                <motion.div variants={itemVariants} className="py-20 text-center border-2 border-dashed border-rose-500/20 rounded-[2.5rem] bg-rose-500/5">
                    <Box size={48} className="mx-auto text-rose-500/20 mb-6" />
                    <p className="text-[10px] font-black text-rose-400/60 uppercase tracking-[0.5em]">Block not found or not yet indexed</p>
                    <Link href="/explorer/blocks" className="mt-4 inline-block text-[9px] font-black text-primary hover:text-primary/80 uppercase tracking-widest transition-colors">
                        ← View All Blocks
                    </Link>
                </motion.div>
            ) : (
                <>
                    {/* Block Fields */}
                    <motion.section variants={itemVariants}>
                        <GlassCard className="overflow-hidden border-border bg-card rounded-[2rem]">
                            <div className="divide-y divide-border">
                                {fields.map((f, i) => (
                                    <div key={i} className="flex items-start gap-6 px-8 py-5">
                                        <div className="flex items-center gap-3 w-40 flex-shrink-0">
                                            <f.icon size={14} className="text-muted-foreground" />
                                            <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">{f.label}</span>
                                        </div>
                                        <div className={`flex-1 min-w-0 text-[12px] font-black ${f.mono ? 'font-mono text-primary' : 'text-foreground'} ${f.truncate ? 'truncate' : 'break-all'}`}>
                                            {f.value || '—'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </GlassCard>
                    </motion.section>

                    {/* Transactions in this block */}
                    {(block?.transaction_count ?? 0) > 0 && (
                        <motion.section variants={itemVariants} className="space-y-5">
                            <div className="flex justify-between items-center px-2">
                                <h2 className="text-lg font-black uppercase tracking-tighter text-foreground flex items-center gap-3">
                                    <ArrowRightLeft size={16} className="text-primary" />
                                    Transactions ({block?.transaction_count?.toLocaleString()})
                                </h2>
                            </div>
                            <BlockTransactions transactions={block?.transactions} />
                        </motion.section>
                    )}
                </>
            )}
        </motion.div>
    );
}

function BlockTransactions({ transactions }: { transactions?: TransactionSummary[] }) {
    const txs = transactions || [];

    if (!txs.length) return (
        <div className="py-12 text-center border-2 border-dashed border-border rounded-[2rem]">
            <ArrowRightLeft size={36} className="mx-auto text-muted-foreground mb-4" />
            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">No transactions indexed for this block</p>
        </div>
    );

    return (
        <GlassCard className="overflow-hidden border-border bg-card rounded-[2rem]">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-muted text-muted-foreground text-[10px] uppercase tracking-[0.2em] font-black">
                            <th className="px-6 py-4">Tx Hash</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4 text-right">Amount</th>
                            <th className="px-6 py-4 text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {txs.map((tx: any) => (
                            <tr key={tx.tx_hash} className="hover:bg-surface-hover transition-colors">
                                <td className="px-6 py-4">
                                    <Link href={`/explorer/transactions/${tx.tx_hash}`} className="font-mono text-primary hover:text-primary/80 text-[11px] font-bold truncate max-w-[160px] block transition-colors">
                                        {tx.tx_hash?.slice(0, 12)}...{tx.tx_hash?.slice(-8)}
                                    </Link>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="px-2 py-1 rounded-lg text-[9px] font-black bg-muted text-muted-foreground uppercase tracking-wider">
                                        {tx.tx_type?.replace(/_/g, ' ')}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-foreground font-bold text-sm">
                                    {(tx.amount || 0).toFixed(4)} <span className="text-muted-foreground text-[9px]">{tx.currency || 'SOL'}</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                    {tx.status === 'confirmed' ? (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg uppercase">
                                            <CheckCircle size={9} /> OK
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-lg uppercase">
                                            {tx.status}
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </GlassCard>
    );
}
