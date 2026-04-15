'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/glass-card';
import { getProviderEarnings } from '@/lib/services/explorer';
import Link from 'next/link';
import {
    ArrowLeft, TrendingUp, Coins, Server, ChevronLeft, ChevronRight,
    BarChart2, Zap, ArrowRightLeft, Clock, Download,
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
import { motion } from 'framer-motion';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';

const PERIODS = [
    { label: '24H', value: '24h' },
    { label: '7D', value: '7d' },
    { label: '30D', value: '30d' },
];

const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07 } } };
const itemVariants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export default function EarningsPage() {
    const [period, setPeriod] = useState('24h');
    const [page, setPage] = useState(1);
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); }, []);

    const { data, isLoading, error } = useQuery({
        queryKey: ['provider-earnings', period, page],
        queryFn: () => getProviderEarnings(period, page, 20),
        refetchInterval: 30000,
        retry: false,
    });

    const providers = data?.providers || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / 20);
    const summary = data?.summary;

    const handleExport = () => {
        if (!providers.length) return;
        const headers = ['rank', 'node_id', 'provider_address', 'session_count', 'bandwidth_gb', 'total_earned_sol', 'last_payout'];
        const rows = providers.map((p: any, i: number) => [
            String((page - 1) * 20 + i + 1),
            p.node_id ?? '',
            p.provider_address ?? '',
            String(p.session_count ?? 0),
            String((p.bandwidth_gb ?? 0).toFixed(3)),
            String((p.total_earned ?? 0).toFixed(6)),
            p.last_payout ?? '',
        ]);
        const dateTag = new Date().toISOString().slice(0, 10);
        downloadCsv(`earnings_${period}_${dateTag}.csv`, headers, rows);
    };
    const chartData = (data?.volume_chart || []).map((p: any) => ({
        t: (() => {
            try { return format(new Date(p.timestamp), period === '24h' ? 'HH:mm' : 'MMM d'); }
            catch { return p.timestamp; }
        })(),
        value: p.value,
    }));

    return (
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="space-y-8 font-mono">
            {/* Header */}
            <motion.header variants={itemVariants} className="flex flex-col gap-6 border-b border-white/5 pb-8">
                <Link href="/explorer" className="flex items-center gap-2 text-[10px] font-black text-white/30 hover:text-primary transition-colors uppercase tracking-[0.3em] w-fit">
                    <ArrowLeft size={14} /> Back to Grid
                </Link>
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
                    <div>
                        <div className="text-[10px] font-black text-primary uppercase tracking-[0.5em] mb-1">Grid Telemetry // Earnings</div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-white flex items-center gap-4">
                            <Coins className="text-emerald-400" size={32} /> Provider Earnings
                        </h1>
                        <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mt-2">
                            On-chain SOL earnings per relay provider
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-2xl p-1.5">
                            {PERIODS.map(p => (
                                <button key={p.value} onClick={() => setPeriod(p.value)}
                                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${period === p.value ? 'bg-primary text-black' : 'text-white/30 hover:text-white/60'}`}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <button onClick={handleExport} disabled={!providers.length}
                            title="Export current page as CSV"
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all bg-white/[0.02] border-white/5 text-white/30 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-20 disabled:cursor-not-allowed">
                            <Download size={12} /> CSV
                        </button>
                    </div>
                </div>
            </motion.header>

            {/* Summary Stats */}
            <motion.section variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Total Paid Out', value: summary ? `${summary.total_paid.toFixed(4)} SOL` : '—', icon: Coins, color: 'text-emerald-400' },
                    { label: 'Active Providers', value: summary?.active_providers ?? '—', icon: Server, color: 'text-primary' },
                    { label: 'Avg Earning', value: summary ? `${summary.avg_earning.toFixed(4)} SOL` : '—', icon: TrendingUp, color: 'text-yellow-400' },
                    { label: 'Transactions', value: summary?.tx_count ?? '—', icon: ArrowRightLeft, color: 'text-blue-400' },
                ].map((s, i) => (
                    <GlassCard key={i} className="!p-5 border-white/5 bg-white/[0.01] rounded-[1.5rem]">
                        <s.icon size={16} className={`${s.color} mb-3 opacity-60`} />
                        <div className={`text-2xl font-black tracking-tighter ${s.color}`}>{s.value}</div>
                        <div className="text-[9px] font-black uppercase text-white/20 tracking-[0.2em] mt-1">{s.label}</div>
                    </GlassCard>
                ))}
            </motion.section>

            {/* Earnings Volume Chart */}
            <motion.section variants={itemVariants}>
                <GlassCard className="border-white/5 bg-white/[0.01] rounded-[2rem] !p-6">
                    <h3 className="text-sm font-black uppercase tracking-tighter text-white mb-6 flex items-center gap-2">
                        <BarChart2 size={14} className="text-emerald-400" /> Payout Volume Over Time
                    </h3>
                    {!mounted || chartData.length === 0 ? (
                        <div className="h-[180px] flex flex-col items-center justify-center border-2 border-dashed border-white/5 rounded-xl">
                            <BarChart2 size={24} className="text-white/10 mb-2" />
                            <p className="text-[8px] font-black text-white/20 uppercase tracking-widest">No payout data yet</p>
                        </div>
                    ) : (
                        <div className="h-[180px] min-h-[180px]">
                            <ResponsiveContainer width="100%" height={180} minWidth={0} minHeight={180}>
                                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                                    <defs>
                                        <linearGradient id="earningsGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                                    <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                                    <YAxis tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 8, fontFamily: 'monospace' }} tickLine={false} axisLine={false} />
                                    <Tooltip contentStyle={{ background: 'rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontFamily: 'monospace', fontSize: 10 }} />
                                    <Area type="monotone" dataKey="value" name="SOL Paid" stroke="#10b981" strokeWidth={2} fill="url(#earningsGrad)" dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </GlassCard>
            </motion.section>

            {/* Provider Earnings Table */}
            <motion.section variants={itemVariants} className="space-y-4">
                <h2 className="text-sm font-black uppercase tracking-tighter text-white flex items-center gap-2">
                    <Zap size={14} className="text-primary" /> Provider Breakdown
                </h2>
                <GlassCard className="overflow-hidden border-white/5 bg-white/[0.01] rounded-[2rem]">
                    {isLoading ? (
                        <div className="divide-y divide-white/5">
                            {Array.from({ length: 8 }).map((_, i) => (
                                <div key={i} className="h-14 animate-pulse bg-white/[0.01]" />
                            ))}
                        </div>
                    ) : error || providers.length === 0 ? (
                        <div className="py-20 text-center">
                            <Coins size={48} className="text-white/5 mx-auto mb-4" />
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest">No earnings data yet</p>
                            <p className="text-[8px] font-black text-white/10 uppercase tracking-widest mt-2">Payouts are recorded on-chain as sessions complete</p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-white/5 text-white/40 text-[9px] uppercase tracking-[0.2em] font-black">
                                            <th className="px-6 py-4">Rank</th>
                                            <th className="px-6 py-4">Provider / Node</th>
                                            <th className="px-6 py-4 text-right">Sessions</th>
                                            <th className="px-6 py-4 text-right">Bandwidth</th>
                                            <th className="px-6 py-4 text-right">Total Earned</th>
                                            <th className="px-6 py-4">Last Payout</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {providers.map((p: any, i: number) => (
                                            <tr key={p.node_id || i} className="hover:bg-white/[0.03] transition-colors">
                                                <td className="px-6 py-4">
                                                    <span className="text-[10px] font-black text-white/30">#{(page - 1) * 20 + i + 1}</span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <Link href={p.node_id ? `/explorer/nodes/${p.node_id}` : '#'}
                                                        className="font-mono text-primary text-[10px] font-bold hover:text-primary/80 transition-colors">
                                                        {p.node_id ? `${p.node_id.slice(0, 16)}...` : p.provider_address?.slice(0, 16) + '...'}
                                                    </Link>
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-[10px] font-black text-white">
                                                    {(p.session_count || 0).toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-[10px] font-black text-white">
                                                    {(p.bandwidth_gb || 0).toFixed(2)} GB
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className="font-mono text-sm font-black text-emerald-400">
                                                        {(p.total_earned || 0).toFixed(4)} SOL
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-1 text-[9px] text-white/40">
                                                        <Clock size={9} />
                                                        {p.last_payout ? (() => {
                                                            try { return format(new Date(p.last_payout), 'MMM d, HH:mm'); }
                                                            catch { return '—'; }
                                                        })() : '—'}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
                                <span className="text-[9px] font-black text-white/30 uppercase tracking-wider">
                                    {total.toLocaleString()} providers · Page {page} of {totalPages || 1}
                                </span>
                                <div className="flex gap-2">
                                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                        className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/30 hover:text-primary hover:border-primary/20 disabled:opacity-30 text-[9px] font-black uppercase tracking-wider transition-all">
                                        <ChevronLeft size={10} /> Prev
                                    </button>
                                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                                        className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-white/30 hover:text-primary hover:border-primary/20 disabled:opacity-30 text-[9px] font-black uppercase tracking-wider transition-all">
                                        Next <ChevronRight size={10} />
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </GlassCard>
            </motion.section>
        </motion.div>
    );
}
