'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navbar } from '@/components/Navbar';
import { GlassCard } from '@/components/ui/glass-card';
import { getTransactionDetails } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowRightLeft,
    ChevronLeft,
    CheckCircle,
    Clock,
    ExternalLink,
    Copy,
    Box,
    FileCode
} from 'lucide-react';
import { format } from 'date-fns';
import { useParams, notFound } from 'next/navigation';

export default function TransactionDetailPage() {
    const params = useParams();
    const hash = params.hash as string;

    const { data: tx, isLoading, error } = useQuery({
        queryKey: ['transaction', hash],
        queryFn: () => getTransactionDetails(hash),
    });

    if (error) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold mb-2">Transaction Not Found</h1>
                    <Link href="/explorer" className="text-cyan-400 hover:underline">Return to Explorer</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
            <Navbar />

            <main className="container mx-auto px-4 py-8 mt-16 max-w-5xl">
                <div className="flex flex-col gap-6">

                    <div className="flex items-center gap-2 mb-2">
                        <Link href="/explorer/transactions" className="text-gray-400 hover:text-cyan-400 transition-colors flex items-center gap-1">
                            <ChevronLeft className="w-4 h-4" /> Transactions
                        </Link>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-cyan-500/20 rounded-xl text-cyan-400">
                            <ArrowRightLeft className="w-8 h-8" />
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold font-mono break-all">{hash}</h1>
                            <div className="flex items-center gap-2 text-sm text-gray-400 mt-1">
                                <span className="uppercase px-2 py-0.5 rounded bg-white/10 text-xs">{tx?.chain || '...'}</span>
                                <span>{isLoading ? 'Loading...' : tx?.status}</span>
                            </div>
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="space-y-4 animate-pulse">
                            <div className="h-40 bg-white/5 rounded-xl" />
                            <div className="h-60 bg-white/5 rounded-xl" />
                        </div>
                    ) : (
                        <>
                            {/* Main Status Card */}
                            <GlassCard className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <h3 className="text-sm text-gray-500 mb-1">Status</h3>
                                    <div className={`flex items-center gap-2 font-medium ${tx?.status === 'confirmed' ? 'text-green-400' : 'text-yellow-400'}`}>
                                        {tx?.status === 'confirmed' ? <CheckCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                                        <span className="capitalize">{tx?.status}</span>
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm text-gray-500 mb-1">Block</h3>
                                    <Link href={`/explorer/blocks/${tx?.block_number}`} className="flex items-center gap-2 text-purple-400 hover:text-purple-300">
                                        <Box className="w-5 h-5" />
                                        <span>#{tx?.block_number}</span>
                                    </Link>
                                </div>
                                <div>
                                    <h3 className="text-sm text-gray-500 mb-1">Timestamp</h3>
                                    <div className="text-gray-200">
                                        {tx?.timestamp && format(new Date(tx.timestamp), 'PPpp')}
                                    </div>
                                </div>
                            </GlassCard>

                            {/* Transaction Details */}
                            <GlassCard className="overflow-hidden">
                                <div className="p-4 border-b border-white/10 bg-white/5">
                                    <h3 className="font-semibold">Transfer Details</h3>
                                </div>
                                <div className="p-6 space-y-6">

                                    {/* From -> To */}
                                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
                                        <div className="flex-1">
                                            <p className="text-xs text-gray-500 mb-1 pl-1">From</p>
                                            <Link href={`/explorer/wallets/${tx?.from_address}`} className="font-mono text-cyan-400 hover:underline block break-all">
                                                {tx?.from_address}
                                            </Link>
                                        </div>
                                        <div className="hidden md:block text-gray-600">
                                            <ArrowRightLeft className="w-6 h-6" />
                                        </div>
                                        <div className="flex-1 text-right md:text-left">
                                            <p className="text-xs text-gray-500 mb-1 pl-1">To</p>
                                            <Link href={`/explorer/wallets/${tx?.to_address}`} className="font-mono text-cyan-400 hover:underline block break-all">
                                                {tx?.to_address}
                                            </Link>
                                        </div>
                                    </div>

                                    {/* Amounts */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div>
                                            <h4 className="text-sm text-gray-500 mb-1">Amount</h4>
                                            <p className="text-2xl font-mono text-white">
                                                {tx?.amount.toLocaleString()} <span className="text-lg text-gray-400">{tx?.currency}</span>
                                            </p>
                                        </div>
                                        <div>
                                            <h4 className="text-sm text-gray-500 mb-1">Fee</h4>
                                            <p className="text-lg font-mono text-gray-300">
                                                {tx?.fee.toFixed(6)} <span className="text-sm text-gray-500">{tx?.currency}</span>
                                            </p>
                                        </div>
                                    </div>

                                    {/* Program Info */}
                                    {tx?.program_id && (
                                        <div className="pt-6 border-t border-white/10">
                                            <h4 className="text-sm text-gray-500 mb-2 flex items-center gap-2">
                                                <FileCode className="w-4 h-4" /> Program Interaction
                                            </h4>
                                            <code className="block p-3 rounded bg-black/50 font-mono text-xs text-green-300 break-all border border-green-900/30">
                                                {tx.program_id}
                                            </code>
                                        </div>
                                    )}

                                </div>
                            </GlassCard>

                            {/* Raw Data (Expandable) */}
                            <GlassCard className="p-4">
                                <details>
                                    <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-300 select-none">Show Raw Data</summary>
                                    <pre className="mt-4 p-4 rounded bg-black/50 overflow-x-auto text-xs font-mono text-gray-400">
                                        {JSON.stringify(tx?.raw_data || {}, null, 2)}
                                    </pre>
                                </details>
                            </GlassCard>
                        </>
                    )}

                </div>
            </main>
        </div>
    );
}
