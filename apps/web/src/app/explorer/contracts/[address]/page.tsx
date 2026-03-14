'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getContractDetails } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowLeft,
    FileCode,
    ShieldCheck,
    XCircle,
    Copy,
    ExternalLink,
    Code2,
    Activity,
    Calendar,
    User,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';

export default function ContractInspectorPage() {
    const params = useParams();
    const address = params.address as string;

    const { data: contract, isLoading, error } = useQuery({
        queryKey: ['contract', address],
        queryFn: () => getContractDetails(address),
    });

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    if (error) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center font-mono">
                <div className="text-center space-y-4">
                    <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Contract Not Found</h1>
                    <p className="text-white/30 text-[11px] uppercase tracking-widest">This address may not be a registered contract.</p>
                    <Link href="/explorer/contracts" className="text-primary hover:text-primary/80 text-[10px] font-black uppercase tracking-widest">
                        Return to Contracts
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-8 font-mono"
        >
            {/* Header */}
            <header className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <div className="flex items-center gap-4">
                    <Link
                        href="/explorer/contracts"
                        className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em]"
                    >
                        <ArrowLeft size={14} /> Back to Contracts
                    </Link>
                </div>

                <GlassCard className="p-8 relative overflow-hidden border-white/5 bg-white/[0.01]">
                    <div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                    <div className="relative z-10">
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
                            <div className="flex items-start gap-4">
                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                                    <FileCode size={28} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Smart Contract</div>
                                    {isLoading ? (
                                        <div className="h-8 w-48 bg-white/5 animate-pulse rounded" />
                                    ) : (
                                        <h1 className="text-2xl font-black text-white tracking-tighter">{contract?.name || 'Unknown Contract'}</h1>
                                    )}
                                    <div className="flex items-center gap-3 mt-2">
                                        <span className="font-mono text-white/50 text-[11px] break-all">{address}</span>
                                        <button
                                            onClick={() => copyToClipboard(address)}
                                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors"
                                            title="Copy Address"
                                        >
                                            <Copy size={12} />
                                        </button>
                                        <a
                                            href={`https://solscan.io/account/${address}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/30 hover:text-primary transition-colors"
                                            title="View on Solscan"
                                        >
                                            <ExternalLink size={12} />
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-end gap-3">
                                {isLoading ? (
                                    <div className="h-8 w-32 bg-white/5 animate-pulse rounded" />
                                ) : contract?.is_verified ? (
                                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-black uppercase tracking-wider">
                                        <ShieldCheck size={14} /> Verified
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/30 text-[10px] font-black uppercase tracking-wider">
                                        <XCircle size={14} /> Unverified
                                    </div>
                                )}
                                {contract?.contract_type && (
                                    <span className="px-3 py-1 rounded-lg text-[9px] font-black bg-white/5 text-white/60 border border-white/10 uppercase tracking-wider">
                                        {contract.contract_type}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-8 border-t border-white/5">
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                <div className="flex items-center gap-2 mb-1">
                                    <Activity size={12} className="text-white/20" />
                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Total Calls</p>
                                </div>
                                {isLoading ? (
                                    <div className="h-6 w-24 bg-white/5 animate-pulse rounded" />
                                ) : (
                                    <p className="font-mono text-lg font-bold">{contract?.total_calls?.toLocaleString() || '0'}</p>
                                )}
                            </div>
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                <div className="flex items-center gap-2 mb-1">
                                    <Code2 size={12} className="text-white/20" />
                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Chain</p>
                                </div>
                                {isLoading ? (
                                    <div className="h-6 w-20 bg-white/5 animate-pulse rounded" />
                                ) : (
                                    <p className="font-mono text-lg font-bold uppercase">{contract?.chain || '-'}</p>
                                )}
                            </div>
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                <div className="flex items-center gap-2 mb-1">
                                    <User size={12} className="text-white/20" />
                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Deployer</p>
                                </div>
                                {isLoading ? (
                                    <div className="h-6 w-28 bg-white/5 animate-pulse rounded" />
                                ) : contract?.deployer_address ? (
                                    <Link
                                        href={`/explorer/wallets/${contract.deployer_address}`}
                                        className="font-mono text-sm text-primary hover:text-primary/80 font-bold"
                                    >
                                        {contract.deployer_address.slice(0, 8)}...
                                    </Link>
                                ) : (
                                    <p className="font-mono text-sm text-white/30">Unknown</p>
                                )}
                            </div>
                            <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                                <div className="flex items-center gap-2 mb-1">
                                    <Calendar size={12} className="text-white/20" />
                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">Deployed</p>
                                </div>
                                {isLoading ? (
                                    <div className="h-6 w-28 bg-white/5 animate-pulse rounded" />
                                ) : contract?.deployed_at ? (
                                    <div>
                                        <p className="font-mono text-sm text-white/60">
                                            {formatDistanceToNow(new Date(contract.deployed_at), { addSuffix: true })}
                                        </p>
                                        <p className="text-[9px] text-white/20 mt-0.5">
                                            {format(new Date(contract.deployed_at), 'MMM d, yyyy')}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="font-mono text-sm text-white/30">-</p>
                                )}
                            </div>
                        </div>
                    </div>
                </GlassCard>
            </header>

            {/* Description */}
            {(isLoading || contract?.description) && (
                <GlassCard className="p-6 border-white/5 bg-white/[0.01]">
                    <h2 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-3">Description</h2>
                    {isLoading ? (
                        <div className="space-y-2">
                            <div className="h-4 w-full bg-white/5 animate-pulse rounded" />
                            <div className="h-4 w-3/4 bg-white/5 animate-pulse rounded" />
                        </div>
                    ) : (
                        <p className="text-white/60 text-sm leading-relaxed">{contract?.description}</p>
                    )}
                </GlassCard>
            )}

            {/* Source Code / ABI placeholder */}
            {!isLoading && contract?.is_verified && (
                <GlassCard className="p-6 border-white/5 bg-white/[0.01]">
                    <h2 className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em] mb-3">Contract ABI</h2>
                    {contract?.abi ? (
                        <pre className="text-[10px] text-white/50 bg-white/5 rounded-xl p-4 overflow-x-auto max-h-64 border border-white/5">
                            {JSON.stringify(contract.abi, null, 2)}
                        </pre>
                    ) : (
                        <p className="text-white/20 text-[11px] uppercase tracking-widest">ABI not available</p>
                    )}
                </GlassCard>
            )}
        </motion.div>
    );
}
