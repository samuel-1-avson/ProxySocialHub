'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { getPublicTreasury } from '@/lib/api/treasury';
import { ArrowLeft, ExternalLink, Wallet, Shield, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

function formatSOL(n: number) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function TreasuryPage() {
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ['treasury-public'],
        queryFn: ({ signal }) => getPublicTreasury(signal),
        refetchInterval: 60_000,
    });

    const treasury = data?.treasury;
    const cluster = data?.network === 'mainnet-beta' || data?.network === 'mainnet' ? 'mainnet' : data?.network;

    return (
        <div className="min-h-screen bg-[#050508] text-white pb-24">
            <div className="max-w-5xl mx-auto px-4 pt-8">
                <Link
                    href="/explorer"
                    className="inline-flex items-center gap-2 text-white/40 hover:text-white text-xs font-black uppercase tracking-widest mb-8"
                >
                    <ArrowLeft size={14} /> Explorer
                </Link>

                <div className="mb-10">
                    <p className="text-[10px] font-black text-emerald-400/80 uppercase tracking-[0.3em] mb-2">Transparency</p>
                    <h1 className="text-4xl font-black tracking-tighter uppercase">Platform Treasury</h1>
                    <p className="text-white/40 text-sm mt-2 max-w-xl">
                        On-chain hot and cold balances, recent provider batch payouts, and network health. No login required.
                    </p>
                </div>

                {error && (
                    <GlassCard className="!p-6 border border-rose-500/30 mb-6">
                        <p className="text-rose-400 text-sm">{(error as Error).message}</p>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            className="mt-3 text-xs font-black uppercase tracking-widest text-white/60 hover:text-white"
                        >
                            Retry
                        </button>
                    </GlassCard>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <GlassCard className="!p-5 border border-white/5">
                        <Wallet size={18} className="text-emerald-400/70 mb-3" />
                        <div className="text-[9px] font-black text-white/30 uppercase tracking-widest">Hot wallet</div>
                        <div className="text-2xl font-black mt-1">
                            {mounted && !isLoading ? formatSOL(treasury?.hot?.balance_sol ?? 0) : '—'} SOL
                        </div>
                        {treasury?.hot?.needs_replenish && (
                            <p className="text-[9px] text-amber-400 font-black uppercase tracking-widest mt-2">Below minimum</p>
                        )}
                    </GlassCard>
                    <GlassCard className="!p-5 border border-white/5">
                        <Shield size={18} className="text-blue-400/70 mb-3" />
                        <div className="text-[9px] font-black text-white/30 uppercase tracking-widest">Cold wallet</div>
                        <div className="text-2xl font-black mt-1">
                            {treasury?.cold
                                ? `${formatSOL(treasury.cold.balance_sol)} SOL`
                                : 'Not configured'}
                        </div>
                    </GlassCard>
                    <GlassCard className="!p-5 border border-white/5">
                        <Activity size={18} className="text-violet-400/70 mb-3" />
                        <div className="text-[9px] font-black text-white/30 uppercase tracking-widest">Lifetime paid</div>
                        <div className="text-2xl font-black mt-1">
                            {mounted && !isLoading ? formatSOL(data?.lifetime_provider_paid_sol ?? 0) : '—'} SOL
                        </div>
                        <p className="text-[9px] text-white/30 mt-2">
                            Native settlement: SOL · {data?.network ?? '—'}
                        </p>
                    </GlassCard>
                </div>

                {treasury && (
                    <GlassCard className="!p-6 border border-white/5 mb-8">
                        <h2 className="text-sm font-black uppercase tracking-tighter mb-4">Addresses</h2>
                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="text-[9px] font-black text-white/30 uppercase tracking-widest">Hot</dt>
                                <dd className="font-mono text-xs break-all mt-1">{treasury.hot.address}</dd>
                            </div>
                            {treasury.cold && (
                                <div>
                                    <dt className="text-[9px] font-black text-white/30 uppercase tracking-widest">Cold</dt>
                                    <dd className="font-mono text-xs break-all mt-1">{treasury.cold.address}</dd>
                                </div>
                            )}
                            <div>
                                <dt className="text-[9px] font-black text-white/30 uppercase tracking-widest">Combined</dt>
                                <dd className="font-black mt-1">{formatSOL(treasury.combined_balance_sol)} SOL · {treasury.status}</dd>
                            </div>
                        </dl>
                        <div className="flex flex-wrap gap-3 mt-4">
                            <a
                                href={`https://solscan.io/account/${treasury.hot.address}${cluster && cluster !== 'mainnet' ? `?cluster=${cluster}` : ''}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-emerald-400/80 hover:text-emerald-300"
                            >
                                Solscan (hot) <ExternalLink size={12} />
                            </a>
                            {treasury.cold && (
                                <a
                                    href={`https://solscan.io/account/${treasury.cold.address}${cluster && cluster !== 'mainnet' ? `?cluster=${cluster}` : ''}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-blue-400/80 hover:text-blue-300"
                                >
                                    Solscan (cold) <ExternalLink size={12} />
                                </a>
                            )}
                        </div>
                    </GlassCard>
                )}

                <GlassCard className="!p-6 border border-white/5">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-black uppercase tracking-tighter">Recent batch payouts</h2>
                        {isFetching && (
                            <span className="text-[9px] text-white/30 font-black uppercase tracking-widest">Updating…</span>
                        )}
                    </div>
                    {!data?.recent_batch_payouts?.length && !isLoading && (
                        <p className="text-white/30 text-sm">No completed batch payouts yet.</p>
                    )}
                    <ul className="space-y-3">
                        {(data?.recent_batch_payouts ?? []).map((p) => (
                            <li
                                key={p.id}
                                className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-white/5 last:border-0"
                            >
                                <div>
                                    <span className="text-xs font-black">{formatSOL(p.total_amount)} SOL</span>
                                    <span className="text-[9px] text-white/30 ml-2 uppercase tracking-widest">
                                        {p.success_count}/{p.total_count} · {p.status}
                                    </span>
                                </div>
                                {p.solscan_url && (
                                    <a
                                        href={p.solscan_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-white"
                                    >
                                        Tx <ExternalLink size={12} />
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                </GlassCard>

                <p className="text-center text-[9px] text-white/20 font-black uppercase tracking-widest mt-8">
                    Oracle {data?.oracle_configured ? 'online' : 'offline'} ·{' '}
                    {data?.operational_healthy ? 'operational healthy' : 'degraded'}
                </p>
            </div>
        </div>
    );
}
