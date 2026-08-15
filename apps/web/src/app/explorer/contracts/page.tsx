'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getContracts } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    FileCode,
    CheckCircle,
    XCircle,
    ChevronLeft,
    ChevronRight,
    Code2,
    ShieldCheck,
    ArrowLeft,
    Boxes,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion } from 'framer-motion';

export default function ContractsPage() {
    const [page, setPage] = useState(1);
    const pageSize = 20;

    const { data, isLoading, error } = useQuery({
        queryKey: ['contracts', page],
        queryFn: () => getContracts(page),
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
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-border pb-8">
                <Link
                    href="/explorer"
                    className="flex items-center gap-2 text-[10px] font-black text-muted-foreground hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit"
                >
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Contracts</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-foreground flex items-center gap-4">
                            <FileCode className="text-primary" size={32} /> 
                            Smart Contracts
                        </h1>
                        <p className="text-[11px] font-black text-muted-foreground uppercase tracking-widest mt-2">
                            Verified programs running on the ProxyHub Network
                        </p>
                    </div>
                    
                    <div className="text-right">
                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.3em]">Total Contracts</p>
                        <p className="text-3xl font-black text-foreground tracking-tighter">
                            {data?.total?.toLocaleString() || '0'}
                        </p>
                    </div>
                </div>
            </motion.header>

            {/* Contracts Table */}
            <motion.section variants={itemVariants}>
                <GlassCard className="overflow-hidden border-border bg-card">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-muted text-muted-foreground text-[10px] uppercase tracking-[0.2em] font-black">
                                    <th className="px-6 py-4">Contract Name</th>
                                    <th className="px-6 py-4">Address</th>
                                    <th className="px-6 py-4">Type</th>
                                    <th className="px-6 py-4 text-center">Verified</th>
                                    <th className="px-6 py-4 text-right">Calls</th>
                                    <th className="px-6 py-4 text-right">Deployed</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {isLoading ? (
                                    Array.from({ length: 10 }).map((_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={6} className="px-6 py-4 h-14 bg-muted"></td>
                                        </tr>
                                    ))
                                ) : data?.contracts?.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center gap-4">
                                                <Boxes size={48} className="text-muted-foreground" />
                                                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em]">
                                                    No contracts registered yet
                                                </p>
                                                <p className="text-[10px] text-muted-foreground max-w-md">
                                                    Smart contracts will be automatically registered when they are deployed to the network.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    data?.contracts?.map((contract: any) => (
                                        <tr key={contract.address} className="hover:bg-surface-hover transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-foreground flex items-center gap-3">
                                                    <Code2 size={16} className="text-primary" />
                                                    <span className="text-sm">{contract.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <Link 
                                                    href={`/explorer/contracts/${contract.address}`}
                                                    className="font-mono text-primary hover:text-primary/80 text-[10px] font-bold"
                                                >
                                                    {contract.address?.slice(0, 20)}...{contract.address?.slice(-8)}
                                                </Link>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="px-3 py-1 rounded-lg text-[9px] font-black bg-muted text-muted-foreground border border-border uppercase tracking-wider">
                                                    {contract.contract_type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {contract.is_verified ? (
                                                    <div className="flex items-center justify-center gap-1.5 text-emerald-500 text-[10px] font-black uppercase">
                                                        <ShieldCheck size={14} /> Verified
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-center gap-1.5 text-muted-foreground text-[10px] font-black uppercase">
                                                        <XCircle size={14} /> Unverified
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <span className="font-mono font-bold text-sm">{contract.total_calls?.toLocaleString()}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right text-[11px] text-muted-foreground">
                                                {contract.deployed_at ? formatDistanceToNow(new Date(contract.deployed_at), { addSuffix: true }) : '-'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="p-6 bg-muted flex items-center justify-between border-t border-border">
                        <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                            Page <span className="text-foreground">{page}</span>
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(Math.max(1, page - 1))}
                                disabled={page === 1 || isLoading}
                                className="p-2 rounded-lg bg-muted border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                                onClick={() => setPage(page + 1)}
                                disabled={data && page * pageSize >= data.total}
                                className="p-2 rounded-lg bg-muted border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                    Failed to load contracts. Please check your connection to the ProxyHub network.
                </motion.div>
            )}
        </motion.div>
    );
}
