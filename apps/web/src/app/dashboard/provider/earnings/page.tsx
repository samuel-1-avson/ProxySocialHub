'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { 
    Wallet, TrendingUp, Activity, ArrowLeft, 
    Coins, Clock, ExternalLink, Download,
    ChevronLeft, ChevronRight, Loader2, AlertCircle
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { getProviderEarnings, getProviderEarningsSummary } from '@/lib/api/provider';
import { GlassCard } from '@/components/ui/glass-card';
import { ProviderClaimPanel } from '@/components/ProviderClaimPanel';
import { format } from 'date-fns';

export default function ProviderEarningsPage() {
    const [page, setPage] = useState(1);
    const limit = 10;

    const { data: summary, isLoading: summaryLoading } = useQuery({
        queryKey: ['provider-earnings-summary'],
        queryFn: getProviderEarningsSummary,
    });

    const { data: earningsData, isLoading: earningsLoading } = useQuery({
        queryKey: ['provider-earnings', page],
        queryFn: () => getProviderEarnings({ page, limit }),
    });

    const earnings = earningsData?.earnings ?? [];
    const totalItems = earningsData?.total ?? 0;
    const totalPages = Math.ceil(totalItems / limit);

    if (summaryLoading || (earningsLoading && page === 1)) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
                <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Syncing Ledger Data...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-20 animate-in fade-in duration-700">
            {/* Header */}
            <div className="flex flex-col gap-4">
                <Link 
                    href="/dashboard/provider" 
                    className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground hover:text-purple-400 transition-colors uppercase tracking-widest w-fit"
                >
                    <ArrowLeft size={12} /> Back to Dashboard
                </Link>
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-purple-500 font-bold uppercase tracking-wider text-xs mb-2">
                            <Wallet size={14} />
                            Financial Overview
                        </div>
                        <h1 className="text-3xl font-black tracking-tighter uppercase italic">
                            Earnings & <span className="text-purple-500">Payouts</span>
                        </h1>
                        <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                            Track your real-time SOL accumulation and historical node distributions.
                        </p>
                    </div>
                    <button 
                        className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-2"
                        onClick={() => {/* TODO: Export logic */}}
                    >
                        <Download size={14} /> Export CSV
                    </button>
                </div>
            </div>

            {/* Summary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <GlassCard className="p-6 border-purple-500/10 bg-purple-500/5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 text-purple-400">
                            <Coins size={20} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Total Earned</span>
                    </div>
                    <div className="text-3xl font-black font-mono text-purple-400 tracking-tighter">
                        {summary?.total_earned_sol.toFixed(6)} <span className="text-sm opacity-50">SOL</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 italic">Lifetime grid contribution rewards</p>
                </GlassCard>

                <GlassCard className="p-6 border-amber-500/10 bg-amber-500/5 hover:-translate-y-1 transition-transform relative overflow-hidden group">
                    {/* Background glow for progress */}
                    <div 
                        className="absolute bottom-0 left-0 h-1 bg-amber-500/50 transition-all duration-1000 ease-out" 
                        style={{ width: `${Math.min(100, ((summary?.pending_sol || 0) / 0.01) * 100)}%` }}
                    />
                    
                    <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
                                <TrendingUp size={20} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pending Payout</span>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] font-bold text-amber-500/70">TARGET: 0.01 SOL</div>
                        </div>
                    </div>
                    
                    <div className="text-3xl font-black font-mono text-amber-500 tracking-tighter relative z-10">
                        {summary?.pending_sol.toFixed(6)} <span className="text-sm opacity-50">SOL</span>
                    </div>
                    
                    <div className="mt-3 relative z-10">
                        <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                            <span>Progress</span>
                            <span>{Math.min(100, ((summary?.pending_sol || 0) / 0.01) * 100).toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                            <div 
                                className="h-full bg-gradient-to-r from-amber-500/50 to-amber-400 rounded-full"
                                style={{ width: `${Math.min(100, ((summary?.pending_sol || 0) / 0.01) * 100)}%` }}
                            />
                        </div>
                    </div>
                </GlassCard>

                <GlassCard className="p-6 border-emerald-500/10 bg-emerald-500/5">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400">
                            <Activity size={20} />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Efficiency</span>
                    </div>
                    <div className="text-3xl font-black font-mono text-emerald-400 tracking-tighter">
                        {summary?.total_bandwidth_gb.toFixed(2)} <span className="text-sm opacity-50">GB</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2 italic">Total bandwidth relayed through nodes</p>
                </GlassCard>
            </div>

            <ProviderClaimPanel />

            {/* Earnings History */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                        <Clock size={16} className="text-purple-500" /> Recent Activity
                    </h3>
                </div>

                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01]">
                    {earnings.length === 0 ? (
                        <div className="py-20 flex flex-col items-center justify-center text-center px-6">
                            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                                <AlertCircle className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                            <h4 className="text-lg font-bold mb-1">No earnings data found</h4>
                            <p className="text-sm text-muted-foreground max-w-xs">
                                Once your nodes start serving proxy traffic, you'll see your rewards accumulated here in real-time.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="text-[10px] uppercase font-black tracking-widest text-muted-foreground border-b border-white/5 bg-white/5">
                                    <tr>
                                        <th className="px-6 py-4">Timestamp</th>
                                        <th className="px-6 py-4">Node</th>
                                        <th className="px-6 py-4">Bandwidth</th>
                                        <th className="px-6 py-4 text-right">Gross Amount</th>
                                        <th className="px-6 py-4 text-right">Net Earned</th>
                                        <th className="px-6 py-4 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {earnings.map((record) => (
                                        <tr key={record.id} className="hover:bg-white/[0.03] transition-colors group">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-[11px] font-mono text-white/50">
                                                    {format(new Date(record.created_at), 'MMM dd, HH:mm:ss')}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className="text-xs font-bold font-mono text-purple-400/80">
                                                    {record.node_id.slice(0, 8)}...
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-xs font-bold text-white/80">
                                                    {record.bandwidth_gb.toFixed(4)} <span className="text-[10px] text-muted-foreground">GB</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono text-xs text-white/40">
                                                {record.gross_amount_sol.toFixed(6)}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="text-xs font-black text-emerald-400 font-mono">
                                                    +{record.net_amount_sol.toFixed(6)} SOL
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex justify-center">
                                                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                                        record.status === 'paid' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                                        record.status === 'pending' ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' :
                                                        'bg-red-500/20 text-red-500 border border-red-500/30'
                                                    }`}>
                                                        {record.status}
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">
                                Page {page} of {totalPages}
                            </span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1}
                                    className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-20 transition-all"
                                >
                                    <ChevronLeft size={16} />
                                </button>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages}
                                    className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-20 transition-all"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}
                </GlassCard>
            </div>

            {/* Payout Mechanism Notice */}
            <div className="bg-purple-500/5 border border-purple-500/10 rounded-2xl p-6">
                <div className="flex gap-4">
                    <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center shrink-0">
                        <ExternalLink className="text-purple-400" size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-sm mb-1 uppercase tracking-tight">Automated Weekly Distribution</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            ProxyHubb processes provider payouts automatically every Sunday at 00:00 UTC. 
                            Earnings are transferred directly to the wallet associated with your provider profile. 
                            A minimum balance of 0.01 SOL is required for a payout to be triggered.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
