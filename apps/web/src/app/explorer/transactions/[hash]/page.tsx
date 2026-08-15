'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getTransactionDetails } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowRightLeft,
    ChevronLeft,
    CheckCircle,
    Clock,
    ExternalLink,
    Box,
    FileCode,
    Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { ExplorerErrorState } from '@/components/explorer/ExplorerErrorState';

export default function TransactionDetailPage() {
    const params = useParams();
    const hash = params.hash as string;

    const { data: tx, isLoading, error } = useQuery({
        queryKey: ['transaction', hash],
        queryFn: () => getTransactionDetails(hash),
    });

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    if (error) {
        return (
            <ExplorerErrorState
                error={error}
                entity="Transaction"
                backHref="/explorer/transactions"
                backLabel="Return to transactions"
            />
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8 font-mono"
        >
            {/* Header */}
            <header className="flex flex-col gap-6 border-b border-border pb-8">
                <div className="flex items-center gap-4">
                    <Link
                        href="/explorer/transactions"
                        className="flex items-center gap-2 text-[10px] font-black text-muted-foreground hover:text-primary transition-colors uppercase tracking-[0.3em]"
                    >
                        <ChevronLeft size={14} /> Back to Stream
                    </Link>
                </div>

                <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6">
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                        <ArrowRightLeft size={28} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Transaction Hash</div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-xl md:text-2xl font-black text-foreground break-all font-mono tracking-tighter">{hash}</h1>
                            <button
                                onClick={() => copyToClipboard(hash)}
                                className="p-2 rounded-lg bg-muted hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                                title="Copy Hash"
                            >
                                <Copy size={14} />
                            </button>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-2">
                            <span className="px-2 py-1 rounded bg-muted">{tx?.chain || 'SOLANA'}</span>
                            <span className={tx?.status === 'confirmed' ? 'text-emerald-500' : 'text-yellow-500'}>
                                {isLoading ? 'Loading...' : tx?.status}
                            </span>
                            {!isLoading && (
                                <a
                                    href={`https://solscan.io/tx/${hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                                >
                                    <ExternalLink size={10} />
                                    SOLSCAN
                                </a>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {isLoading ? (
                <div className="space-y-4 animate-pulse">
                    <div className="h-40 bg-muted rounded-2xl" />
                    <div className="h-60 bg-muted rounded-2xl" />
                </div>
            ) : (
                <>
                    {/* Status Card */}
                    <GlassCard className="p-8 border-border bg-card grid grid-cols-1 md:grid-cols-3 gap-8">
                        <div>
                            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">Status</h3>
                            <div className={`flex items-center gap-2 font-black text-lg ${tx?.status === 'confirmed' ? 'text-emerald-500' : 'text-yellow-500'}`}>
                                {tx?.status === 'confirmed' ? <CheckCircle size={20} /> : <Clock size={20} />}
                                <span className="uppercase">{tx?.status}</span>
                            </div>
                        </div>
                        <div>
                            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">Block</h3>
                            <Link href={`/explorer/blocks/${tx?.block_number}`} className="flex items-center gap-2 text-primary hover:text-primary/80 font-black text-lg">
                                <Box size={18} />
                                <span>#{tx?.block_number?.toLocaleString()}</span>
                            </Link>
                        </div>
                        <div>
                            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">Timestamp</h3>
                            <div className="text-foreground font-mono text-sm">
                                {tx?.timestamp && format(new Date(tx.timestamp), 'PPpp')}
                            </div>
                        </div>
                    </GlassCard>

                    {/* Transfer Details */}
                    <GlassCard className="overflow-hidden border-border bg-card">
                        <div className="p-6 border-b border-border bg-muted">
                            <h3 className="font-black text-sm uppercase tracking-widest text-muted-foreground">Transfer Details</h3>
                        </div>
                        <div className="p-8 space-y-8">
                            {/* From -> To */}
                            <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl bg-muted border border-border">
                                <div className="flex-1 w-full">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">From</p>
                                    <div className="flex items-center gap-2">
                                        <Link href={`/explorer/wallets/${tx?.from_address}`} className="font-mono text-primary hover:text-primary/80 block break-all text-sm font-bold">
                                            {tx?.from_address}
                                        </Link>
                                        <button
                                            onClick={() => copyToClipboard(tx?.from_address || '')}
                                            className="p-1.5 rounded bg-muted hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    </div>
                                </div>
                                <div className="hidden md:block text-muted-foreground">
                                    <ArrowRightLeft size={24} />
                                </div>
                                <div className="flex-1 w-full md:text-right">
                                    <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">To</p>
                                    <div className="flex items-center justify-start md:justify-end gap-2">
                                        <Link href={`/explorer/wallets/${tx?.to_address}`} className="font-mono text-primary hover:text-primary/80 block break-all text-sm font-bold">
                                            {tx?.to_address}
                                        </Link>
                                        <button
                                            onClick={() => copyToClipboard(tx?.to_address || '')}
                                            className="p-1.5 rounded bg-muted hover:bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <Copy size={12} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Amounts */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">Amount</h4>
                                    <p className="text-3xl font-black text-foreground tracking-tighter">
                                        {tx?.amount?.toLocaleString()} <span className="text-lg text-muted-foreground">{tx?.currency}</span>
                                    </p>
                                </div>
                                <div>
                                    <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-2">Fee</h4>
                                    <p className="text-xl font-black text-muted-foreground">
                                        {tx?.fee?.toFixed(6)} <span className="text-sm text-muted-foreground">{tx?.currency}</span>
                                    </p>
                                </div>
                            </div>

                            {/* Program Info */}
                            {tx?.program_id && (
                                <div className="pt-8 border-t border-border">
                                    <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mb-3 flex items-center gap-2">
                                        <FileCode size={14} /> Program Interaction
                                    </h4>
                                    <code className="block p-4 rounded-xl bg-black/50 font-mono text-[11px] text-emerald-400 break-all border border-emerald-500/20">
                                        {tx.program_id}
                                    </code>
                                </div>
                            )}
                        </div>
                    </GlassCard>

                    {/* Raw Data */}
                    <GlassCard className="p-6 border-border bg-card">
                        <details>
                            <summary className="cursor-pointer text-[10px] font-black text-muted-foreground hover:text-foreground uppercase tracking-[0.3em] select-none">
                                Show Raw Data
                            </summary>
                            <pre className="mt-6 p-6 rounded-xl bg-black/50 overflow-x-auto text-[10px] font-mono text-white/40">
                                {JSON.stringify(tx?.raw_data || {}, null, 2)}
                            </pre>
                        </details>
                    </GlassCard>
                </>
            )}
        </motion.div>
    );
}
