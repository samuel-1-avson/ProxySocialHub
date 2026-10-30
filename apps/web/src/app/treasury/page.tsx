'use client';

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/glass-card';
import { getPublicTreasury, type WalletBalanceView } from '@/lib/api/treasury';
import { ArrowLeft, ExternalLink, Wallet, Shield, Activity } from 'lucide-react';

function formatSOL(n: number) {
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function balanceLabel(wallet: WalletBalanceView | undefined, emptyLabel: string) {
    if (!wallet?.address) return emptyLabel;
    if (wallet.balance_unavailable) return 'Unavailable';
    return `${formatSOL(wallet.balance_sol ?? 0)} SOL`;
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
    const rpcDegraded = treasury?.status === 'RPC_UNAVAILABLE'
        || treasury?.hot?.balance_unavailable
        || treasury?.cold?.balance_unavailable;

    return (
        <div className="min-h-screen bg-[#050508] text-foreground pb-24">
            <div className="max-w-5xl mx-auto px-4 pt-8">
                <Link
                    href="/explorer"
                    className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground text-xs font-semibold mb-8"
                >
                    <ArrowLeft size={14} /> Explorer
                </Link>

                <div className="mb-10">
                    <p className="text-xs font-semibold text-success/80 mb-2">Transparency</p>
                    <h1 className="text-4xl font-semibold tracking-tight">Platform Treasury</h1>
                    <p className="text-muted-foreground text-sm mt-2 max-w-xl">
                        On-chain hot and cold balances, recent provider batch payouts, and network health. No login required.
                    </p>
                </div>

                {error && (
                    <GlassCard className="!p-6 border border-destructive/30 mb-6">
                        <p className="text-destructive text-sm">{(error as Error).message}</p>
                        <button
                            type="button"
                            onClick={() => refetch()}
                            className="mt-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        >
                            Retry
                        </button>
                    </GlassCard>
                )}

                {rpcDegraded && (
                    <GlassCard className="!p-4 border border-warning/30 mb-6">
                        <p className="text-warning/90 text-xs">
                            Solana RPC could not refresh balances. Addresses below are still configured. Try again shortly.
                        </p>
                    </GlassCard>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <GlassCard className="!p-5 border border-border">
                        <Wallet size={18} className="text-success/70 mb-3" />
                        <div className="text-xs font-semibold text-muted-foreground">Hot wallet</div>
                        <div className="text-2xl font-semibold mt-1">
                            {mounted && !isLoading
                                ? balanceLabel(treasury?.hot, 'Not configured')
                                : '…'}
                        </div>
                        {treasury?.hot?.needs_replenish && !treasury.hot.balance_unavailable && (
                            <p className="text-xs text-warning font-semibold mt-2">Below minimum</p>
                        )}
                    </GlassCard>
                    <GlassCard className="!p-5 border border-border">
                        <Shield size={18} className="text-info/70 mb-3" />
                        <div className="text-xs font-semibold text-muted-foreground">Cold wallet</div>
                        <div className="text-2xl font-semibold mt-1">
                            {mounted && !isLoading
                                ? balanceLabel(treasury?.cold, 'Not configured')
                                : '…'}
                        </div>
                    </GlassCard>
                    <GlassCard className="!p-5 border border-border">
                        <Activity size={18} className="text-primary/70 mb-3" />
                        <div className="text-xs font-semibold text-muted-foreground">Lifetime paid</div>
                        <div className="text-2xl font-semibold mt-1">
                            {mounted && !isLoading ? formatSOL(data?.lifetime_provider_paid_sol ?? 0) : '…'} SOL
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            Native settlement: SOL · {data?.network ?? 'Unknown'}
                        </p>
                    </GlassCard>
                </div>

                {(treasury?.vault?.address || treasury?.liquidity) && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        {treasury?.vault?.address && (
                            <GlassCard className="!p-5 border border-border">
                                <div className="text-xs font-semibold text-muted-foreground">Deposit vault</div>
                                <div className="text-2xl font-semibold mt-1">
                                    {mounted && !isLoading
                                        ? balanceLabel(treasury.vault, 'Not configured')
                                        : '…'}
                                </div>
                            </GlassCard>
                        )}
                        <GlassCard className="!p-5 border border-border">
                            <div className="text-xs font-semibold text-muted-foreground">Payout queue</div>
                            <div className="text-2xl font-semibold mt-1">
                                {mounted && !isLoading ? (treasury?.liquidity?.queue_depth ?? 0) : '…'}
                            </div>
                            {(treasury?.liquidity?.queue_oldest_age_secs ?? 0) > 0 && (
                                <p className="text-xs text-muted-foreground mt-2">
                                    Oldest ~{Math.round((treasury?.liquidity?.queue_oldest_age_secs ?? 0) / 60)} min
                                </p>
                            )}
                        </GlassCard>
                        <GlassCard className="!p-5 border border-border">
                            <div className="text-xs font-semibold text-muted-foreground">Last vault→hot</div>
                            <div className="text-lg font-semibold mt-1">
                                {mounted && !isLoading && treasury?.liquidity?.last_topup_sol
                                    ? `${formatSOL(treasury.liquidity.last_topup_sol)} SOL`
                                    : '…'}
                            </div>
                            {treasury?.liquidity?.last_topup_at && (
                                <p className="text-xs text-muted-foreground mt-2 font-mono">
                                    {new Date(treasury.liquidity.last_topup_at).toLocaleString()}
                                    {treasury.liquidity.last_topup_source
                                        ? ` · ${treasury.liquidity.last_topup_source}`
                                        : ''}
                                </p>
                            )}
                        </GlassCard>
                    </div>
                )}

                {treasury?.hot?.address && (
                    <GlassCard className="!p-6 border border-border mb-8">
                        <h2 className="text-sm font-semibold tracking-tight mb-4">Addresses</h2>
                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="text-xs font-semibold text-muted-foreground">Hot</dt>
                                <dd className="font-mono text-xs break-all mt-1">{treasury.hot.address}</dd>
                            </div>
                            {treasury.cold?.address && (
                                <div>
                                    <dt className="text-xs font-semibold text-muted-foreground">Cold</dt>
                                    <dd className="font-mono text-xs break-all mt-1">{treasury.cold.address}</dd>
                                </div>
                            )}
                            {treasury.vault?.address && (
                                <div>
                                    <dt className="text-xs font-semibold text-muted-foreground">Vault</dt>
                                    <dd className="font-mono text-xs break-all mt-1">{treasury.vault.address}</dd>
                                </div>
                            )}
                            <div>
                                <dt className="text-xs font-semibold text-muted-foreground">Combined</dt>
                                <dd className="font-semibold mt-1">
                                    {treasury.hot.balance_unavailable || treasury.cold?.balance_unavailable
                                        ? `Balances unavailable · ${treasury.status}`
                                        : `${formatSOL(treasury.combined_balance_sol)} SOL · ${treasury.status}`}
                                </dd>
                            </div>
                        </dl>
                        <div className="flex flex-wrap gap-3 mt-4">
                            <a
                                href={`https://solscan.io/account/${treasury.hot.address}${cluster && cluster !== 'mainnet' ? `?cluster=${cluster}` : ''}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-success/80 hover:text-success"
                            >
                                Solscan (hot) <ExternalLink size={12} />
                            </a>
                            {treasury.cold?.address && (
                                <a
                                    href={`https://solscan.io/account/${treasury.cold.address}${cluster && cluster !== 'mainnet' ? `?cluster=${cluster}` : ''}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-info/80 hover:text-info"
                                >
                                    Solscan (cold) <ExternalLink size={12} />
                                </a>
                            )}
                            {treasury.vault?.address && (
                                <a
                                    href={`https://solscan.io/account/${treasury.vault.address}${cluster && cluster !== 'mainnet' ? `?cluster=${cluster}` : ''}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary/80 hover:text-primary"
                                >
                                    Solscan (vault) <ExternalLink size={12} />
                                </a>
                            )}
                        </div>
                    </GlassCard>
                )}

                <GlassCard className="!p-6 border border-border">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold tracking-tight">Recent batch payouts</h2>
                        {isFetching && (
                            <span className="text-xs text-muted-foreground font-semibold">Updating…</span>
                        )}
                    </div>
                    {!data?.recent_batch_payouts?.length && !isLoading && (
                        <p className="text-muted-foreground text-sm">No completed batch payouts yet.</p>
                    )}
                    <ul className="space-y-3">
                        {(data?.recent_batch_payouts ?? []).map((p) => (
                            <li
                                key={p.id}
                                className="flex flex-wrap items-center justify-between gap-2 py-3 border-b border-border last:border-0"
                            >
                                <div>
                                    <span className="text-xs font-semibold">{formatSOL(p.total_amount)} SOL</span>
                                    <span className="text-xs text-muted-foreground ml-2">
                                        {p.success_count}/{p.total_count} · {p.status}
                                    </span>
                                </div>
                                {p.solscan_url && (
                                    <a
                                        href={p.solscan_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                                    >
                                        Tx <ExternalLink size={12} />
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                </GlassCard>

                <p className="text-center text-xs text-muted-foreground font-semibold mt-8">
                    Oracle {data?.oracle_configured ? 'online' : 'offline'} ·{' '}
                    {data?.operational_healthy ? 'operational healthy' : 'degraded'}
                </p>
            </div>
        </div>
    );
}
