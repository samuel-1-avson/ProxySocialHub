"use client";

import { useEffect, useState, useMemo } from 'react';
import { getWallet } from '@/lib/api/wallet';
import { getMyNodes, getProviderEarningsSummary, getProviderEarnings, type EarningRecord } from '@/lib/api/provider';
import { GlassCard } from '@/components/ui/glass-card';
import { motion } from 'framer-motion';
import {
    Coins,
    TrendingUp,
    Wallet,
    Clock,
    ArrowUpRight,
    Loader2,
    Server,
    BarChart3,
    ArrowDownRight,
    Download,
    FileText
} from 'lucide-react';

interface DailyEarning {
    day: string;
    amount: number;
}

export default function EarningsPage() {
    const [loading, setLoading] = useState(true);
    const [walletBalance, setWalletBalance] = useState(0);
    const [earningTransactions, setEarningTransactions] = useState<Array<{
        id: string;
        amount: number;
        description: string;
        status: string;
        created_at: string;
        tx_hash?: string;
    }>>([]);
    const [nodesOnline, setNodesOnline] = useState(0);
    const [totalNodes, setTotalNodes] = useState(0);
    const [totalUptimePercent, setTotalUptimePercent] = useState(0);
    const [chartRange, setChartRange] = useState<'7D' | '30D' | 'ALL'>('30D');
    const [pendingSOL, setPendingSOL] = useState(0);
    const [last7DaysSOL, setLast7DaysSOL] = useState(0);

    useEffect(() => {
        async function fetchData() {
            try {
                const [walletData, nodesData, summaryData, earningsData] = await Promise.allSettled([
                    getWallet(),
                    getMyNodes(),
                    getProviderEarningsSummary(),
                    getProviderEarnings({ page: 1, limit: 100 }),
                ]);

                if (walletData.status === 'fulfilled' && walletData.value) {
                    setWalletBalance(walletData.value.balance_sol ?? 0);
                }

                if (nodesData.status === 'fulfilled' && nodesData.value) {
                    const nodes = nodesData.value.nodes ?? [];
                    const online = nodes.filter((n) => n.status === 'online');
                    setTotalNodes(nodes.length);
                    setNodesOnline(online.length);
                    const avgUptime =
                        nodes.length > 0
                            ? nodes.reduce((sum, n) => sum + (n.uptime_percent ?? 0), 0) / nodes.length
                            : 0;
                    setTotalUptimePercent(avgUptime);
                }

                if (summaryData.status === 'fulfilled' && summaryData.value) {
                    setPendingSOL(summaryData.value.pending_sol ?? 0);
                    setLast7DaysSOL(summaryData.value.last_7_days_sol ?? 0);
                }

                // Merge real earnings records as transactions
                if (earningsData.status === 'fulfilled' && earningsData.value?.earnings?.length) {
                    setEarningTransactions(earningsData.value.earnings.map((e: EarningRecord) => ({
                        id: e.id,
                        amount: e.net_amount_sol,
                        description: `${e.bandwidth_gb.toFixed(4)} GB served`,
                        status: e.status,
                        created_at: e.created_at,
                        tx_hash: e.tx_hash,
                    })));
                }
            } catch (error) {
                console.error("Failed to fetch earnings data", error);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Derive total lifetime earnings from earning transactions
    const totalEarnings = useMemo(
        () => earningTransactions.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0),
        [earningTransactions]
    );

    // Build daily earnings chart data
    const dailyEarnings = useMemo((): DailyEarning[] => {
        const now = new Date();
        const cutoffDays = chartRange === '7D' ? 7 : chartRange === '30D' ? 30 : 365;
        const cutoff = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000);

        const map = new Map<string, number>();
        earningTransactions.forEach((t) => {
            const d = new Date(t.created_at);
            if (d < cutoff) return;
            const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
            map.set(key, (map.get(key) ?? 0) + (t.amount > 0 ? t.amount : 0));
        });

        // Fill in missing days with zero so the chart always has a consistent shape
        const days: DailyEarning[] = [];
        for (let i = cutoffDays - 1; i >= 0; i--) {
            const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const key = d.toISOString().slice(0, 10);
            days.push({ day: key, amount: map.get(key) ?? 0 });
        }
        return days;
    }, [earningTransactions, chartRange]);

    const chartMax = useMemo(() => Math.max(...dailyEarnings.map((d) => d.amount), 0.001), [dailyEarnings]);

    // Recent earning transactions (newest first, up to 10)
    const recentActivity = useMemo(
        () => [...earningTransactions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10),
        [earningTransactions]
    );

    // P3-09: Monthly aggregation for tax summary view.
    const monthlyEarnings = useMemo(() => {
        const map = new Map<string, number>();
        earningTransactions.forEach((t) => {
            if (t.amount <= 0) return;
            const d = new Date(t.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            map.set(key, (map.get(key) ?? 0) + t.amount);
        });
        return Array.from(map.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([month, amount]) => ({ month, amount }));
    }, [earningTransactions]);

    // P3-09: CSV export — full transaction history.
    const exportCSV = () => {
        const rows = [
            ['Date', 'Description', 'Amount (SOL)', 'Status', 'Tx Hash'],
            ...earningTransactions.map((t) => [
                new Date(t.created_at).toISOString(),
                t.description,
                t.amount.toFixed(9),
                t.status,
                t.tx_hash ?? '',
            ]),
        ];
        const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proxyhubb-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // P3-09: Printable tax summary — current year totals.
    const currentYear = new Date().getFullYear();
    const taxYearEarnings = useMemo(
        () => earningTransactions
            .filter((t) => t.amount > 0 && new Date(t.created_at).getFullYear() === currentYear)
            .reduce((sum, t) => sum + t.amount, 0),
        [earningTransactions, currentYear]
    );

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-xs font-mono uppercase text-muted-foreground">Loading Earnings...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col gap-2 border-b border-border pb-6">
                <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest">
                    <Coins size={14} />
                    Provider Earnings
                </div>
                <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Earnings Dashboard</h1>
                <p className="text-muted-foreground font-mono text-xs max-w-lg">
                    TRACK YOUR BANDWIDTH SHARING INCOME AND PAYOUTS.
                </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <GlassCard className="p-5 border-emerald-500/10 bg-emerald-500/5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                            <Wallet size={20} className="text-emerald-400" />
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Earnings</div>
                    </div>
                    <div className="text-2xl font-black font-mono text-emerald-400">
                        {totalEarnings.toFixed(4)} <span className="text-sm text-emerald-400/60">SOL</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Lifetime earnings from bandwidth</p>
                </GlassCard>

                <GlassCard className="p-5 border-amber-500/10 bg-amber-500/5">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
                            <Clock size={20} className="text-amber-400" />
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pending Payout</div>
                    </div>
                    <div className="text-2xl font-black font-mono text-amber-400">
                        {pendingSOL.toFixed(4)} <span className="text-sm text-amber-400/60">SOL</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Wallet balance: {walletBalance.toFixed(4)} SOL</p>
                </GlassCard>

                <GlassCard className="p-5 border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                            <Server size={20} className="text-blue-400" />
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Nodes</div>
                    </div>
                    <div className="text-2xl font-black font-mono">
                        {nodesOnline}<span className="text-sm text-muted-foreground">/{totalNodes}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Nodes contributing</p>
                </GlassCard>

                <GlassCard className="p-5 border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                            <TrendingUp size={20} className="text-purple-400" />
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Avg Uptime</div>
                    </div>
                    <div className="text-2xl font-black font-mono">
                        {totalUptimePercent.toFixed(1)}<span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Average across all nodes</p>
                </GlassCard>
            </div>

            {/* Earnings Chart */}
            <GlassCard className="p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-bold font-mono flex items-center gap-2">
                            <BarChart3 size={18} className="text-primary" />
                            Earnings History
                        </h2>
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                            DAILY EARNINGS OVER TIME
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {(['7D', '30D', 'ALL'] as const).map((range) => (
                            <button
                                key={range}
                                onClick={() => setChartRange(range)}
                                className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
                                    chartRange === range
                                        ? 'bg-primary/20 text-primary'
                                        : 'bg-white/5 hover:bg-white/10'
                                }`}
                            >
                                {range}
                            </button>
                        ))}
                    </div>
                </div>

                {earningTransactions.length === 0 ? (
                    <div className="h-64 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p className="font-mono text-sm">No earnings recorded yet</p>
                            <p className="text-xs mt-1">Earnings appear here once your nodes start serving traffic</p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="h-64 flex items-end justify-between gap-1 px-4 pb-4 border-b border-l border-white/10">
                            {dailyEarnings.map((d, i) => {
                                const heightPct = (d.amount / chartMax) * 100;
                                return (
                                    <motion.div
                                        key={d.day}
                                        title={`${d.day}: ${d.amount.toFixed(6)} SOL`}
                                        initial={{ height: 0 }}
                                        animate={{ height: `${Math.max(heightPct, d.amount > 0 ? 2 : 0)}%` }}
                                        transition={{ delay: i * 0.02, duration: 0.4 }}
                                        className={`flex-1 rounded-t transition-colors ${
                                            d.amount > 0
                                                ? 'bg-primary/40 hover:bg-primary/70'
                                                : 'bg-white/5'
                                        }`}
                                        style={{ minHeight: '2px' }}
                                    />
                                );
                            })}
                        </div>
                        <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
                            <span>{dailyEarnings[0]?.day.slice(5) ?? ''}</span>
                            <span>{dailyEarnings[Math.floor(dailyEarnings.length / 2)]?.day.slice(5) ?? ''}</span>
                            <span>{dailyEarnings[dailyEarnings.length - 1]?.day.slice(5) ?? ''}</span>
                        </div>
                    </>
                )}
            </GlassCard>

            {/* Recent Activity */}
            <GlassCard className="p-6">
                <h2 className="text-lg font-bold font-mono mb-4 flex items-center gap-2">
                    <ArrowUpRight size={18} className="text-primary" />
                    Recent Earning Activity
                </h2>

                {totalNodes === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <Server className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="font-mono text-sm">No nodes registered yet</p>
                        <p className="text-xs mt-1">Set up your first node to start earning</p>
                    </div>
                ) : recentActivity.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        <Coins className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="font-mono text-sm">No earnings recorded yet</p>
                        <p className="text-xs mt-1">Earnings appear here once your nodes serve traffic</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {recentActivity.map((tx) => (
                            <div key={tx.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                        {tx.amount >= 0 ? (
                                            <ArrowUpRight size={14} className="text-emerald-400" />
                                        ) : (
                                            <ArrowDownRight size={14} className="text-red-400" />
                                        )}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{tx.description || 'Bandwidth Earning'}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {new Date(tx.created_at).toLocaleDateString(undefined, {
                                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                            })}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className={`text-sm font-mono ${tx.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(6)} SOL
                                    </p>
                                    {tx.tx_hash ? (
                                        <a
                                            href={`https://solscan.io/tx/${tx.tx_hash}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[10px] text-blue-400 hover:underline font-mono"
                                        >
                                            {tx.tx_hash.slice(0, 10)}…
                                        </a>
                                    ) : (
                                        <p className="text-[10px] text-muted-foreground capitalize">{tx.status}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </GlassCard>

            {/* P3-09: Tax Reporting & CSV Export */}
            <GlassCard className="p-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <FileText size={16} className="text-primary" />
                        <h2 className="text-sm font-bold font-mono uppercase tracking-wider">Tax Reporting</h2>
                    </div>
                    <button
                        onClick={exportCSV}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-xs font-mono font-bold uppercase tracking-wider transition-colors"
                    >
                        <Download size={12} />
                        Export CSV
                    </button>
                </div>

                {/* Tax year summary */}
                <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground font-mono uppercase">
                            {currentYear} Total Earnings (taxable income)
                        </span>
                        <span className="text-sm font-mono font-bold text-emerald-400">
                            {taxYearEarnings.toFixed(6)} SOL
                        </span>
                    </div>
                </div>

                {/* Monthly breakdown */}
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {monthlyEarnings.length === 0 ? (
                        <p className="text-xs text-muted-foreground font-mono text-center py-4">No earnings yet</p>
                    ) : (
                        monthlyEarnings.map(({ month, amount }) => (
                            <div key={month} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                                <span className="text-xs font-mono text-muted-foreground">{month}</span>
                                <span className="text-xs font-mono font-bold">{amount.toFixed(6)} SOL</span>
                            </div>
                        ))
                    )}
                </div>
            </GlassCard>

            {/* Payout Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <GlassCard className="p-5">
                    <h3 className="text-sm font-bold font-mono mb-2">Auto-Payout</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                        Earnings are automatically credited to your wallet. Withdraw to your Solana address at any time.
                    </p>
                    <div className="flex items-center gap-2 text-xs font-mono">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-emerald-400">Enabled</span>
                    </div>
                </GlassCard>

                <GlassCard className="p-5">
                    <h3 className="text-sm font-bold font-mono mb-2">Earning Rate</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                        You earn SOL for every GB of bandwidth your nodes serve. Rate is set per node.
                    </p>
                    <div className="text-lg font-mono font-bold">
                        {earningTransactions.length > 0
                            ? `${(totalEarnings / earningTransactions.length).toFixed(6)} SOL`
                            : '—'}
                        <span className="text-xs text-muted-foreground font-normal ml-1">avg per tx</span>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
}
