"use client";

import { useAuth } from "@/lib/auth";
import { Activity, Wifi, Server, DollarSign, AlertCircle, RefreshCw, Zap, User, ExternalLink, Globe, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { getAnalyticsOverview, getWallet, getDailyUsage } from "@/lib/api";
import { SkeletonDashboard } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { ActionCard } from "@/components/ui/ActionCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { motion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useRole } from "@/hooks/useRole";
import { NewUserDashboard } from "@/components/NewUserDashboard";
import { ROUTES } from "@/lib/navigation/routes";

export default function DashboardPage() {
    const { user } = useAuth();
    const { isNewUser, isProvider, role, isConsumer } = useRole();

    const { data: analytics, isLoading: analyticsLoading, refetch: refetchAnalytics } = useQuery({
        queryKey: ['analytics-overview'],
        queryFn: getAnalyticsOverview,
        enabled: !!user,
        refetchInterval: 30000,
        retry: 2,
    });

    const { data: wallet, isLoading: walletLoading } = useQuery({
        queryKey: ['wallet'],
        queryFn: getWallet,
        enabled: !!user,
        refetchInterval: 30000,
        retry: 2,
    });

    const { data: dailyUsageData, isLoading: usageLoading } = useQuery({
        queryKey: ['daily-usage', 7],
        queryFn: () => getDailyUsage(7),
        enabled: !!user,
        refetchInterval: 30000,
        retry: 2,
    });

    const dailyUsage = dailyUsageData?.data || [];
    const loading = analyticsLoading || walletLoading || usageLoading;
    const error = !user ? null : (!analytics && !analyticsLoading) ? 'Failed to load dashboard data. Please check your connection.' : null;

    if (isNewUser) {
        return <NewUserDashboard />;
    }

    if (loading) {
        return <SkeletonDashboard />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-4">
                <div className="p-4 rounded-full bg-red-500/10 mb-4">
                    <AlertCircle className="h-12 w-12 text-red-500" />
                </div>
                <h2 className="text-xl font-bold font-sans mb-2">System Unavailable</h2>
                <p className="text-muted-foreground font-sans text-sm mb-6 max-w-md">{error}</p>
                <button onClick={() => refetchAnalytics()} className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-xl flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Retry Connection
                </button>
            </div>
        );
    }

    const chartData = dailyUsage.map(d => ({
        name: d.date ? new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }) : '?',
        value: d.bytes_used ? Number((d.bytes_used / (1024 * 1024)).toFixed(2)) : 0
    }));

    return (
        <div className="space-y-8 pb-20 md:pb-8">
            {/* Header & Hero */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight mb-2">
                        Welcome back, {user?.display_name || user?.email?.split('@')[0] || "User"}
                    </h1>
                    <p className="text-muted-foreground">
                        Here's your network overview and proxy connection status.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <StatusBadge status="online" label="Network Online" pulse />
                </div>
            </div>

            {/* Role-Based Action Cards */}
            <div className="space-y-4">
                {(isConsumer || role === "both") && (
                    <>
                        <div className="flex items-center gap-2 mb-2">
                            <Globe size={16} className="text-primary" />
                            <h2 className="text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">Buyer Console</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <ActionCard
                                title="Quick Connect"
                                description="Launch a new proxy session instantly"
                                icon={Globe}
                                href="/dashboard/proxy"
                                ctaLabel="Connect"
                                variant="brand"
                            />
                            <ActionCard
                                title="Marketplace"
                                description="Discover and purchase premium bandwidth"
                                icon={Zap}
                                href="/marketplace"
                                ctaLabel="Explore"
                            />
                            <ActionCard
                                title="Settings"
                                description="Account & protocol preferences"
                                icon={User}
                                href={ROUTES.dashboardSettingsIdentity}
                                ctaLabel="Manage"
                            />
                            <ActionCard
                                title="Usage proofs"
                                description="Verify trustless usage proofs"
                                icon={ShieldCheck}
                                href="/dashboard/trustless"
                                ctaLabel="Verify"
                            />
                        </div>
                    </>
                )}

                {(isProvider || role === "both") && (
                    <>
                        <div className="flex items-center gap-2 mb-2 mt-8">
                            <Server size={16} className="text-purple-400" />
                            <h2 className="text-[10px] font-black font-mono uppercase tracking-[0.2em] text-muted-foreground/60">Provider Hub</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <ActionCard
                                title="Registered Nodes"
                                description="Manage infrastructure & quality scores"
                                icon={Server}
                                href="/dashboard/provider"
                                ctaLabel="Monitor"
                                variant="provider"
                            />
                            <ActionCard
                                title="Earnings & Payouts"
                                description="Track income and withdrawal status"
                                icon={DollarSign}
                                href="/dashboard/provider/earnings"
                                ctaLabel="Finance"
                            />
                            <ActionCard
                                title="Seller Tools"
                                description="CLI documentation & API authentication"
                                icon={Terminal}
                                href="/dashboard/provider/cli"
                                ctaLabel="Setup"
                            />
                            <ActionCard
                                title="Listing Manager"
                                description="Set your price & marketplace visibility"
                                icon={ExternalLink}
                                href="/marketplace/manage"
                                ctaLabel="Edit"
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {isProvider ? (
                    <>
                        <StatCard
                            title="Total Nodes"
                            value={analytics?.total_nodes?.toString() || "0"}
                            icon={Server}
                            variant="brand"
                            trendComponent={<span className="text-purple-400 font-bold text-xs uppercase tracking-wide">Active</span>}
                        />
                        <StatCard
                            title="Provider Earnings"
                            value={`${analytics?.total_earnings_sol?.toFixed(3) ?? "0.000"} SOL`}
                            icon={DollarSign}
                            variant="default"
                            subtitle="Total Life-time"
                        />
                        <StatCard
                            title="Quality Average"
                            value={`${analytics?.avg_quality_score || 0}%`}
                            icon={Zap}
                            variant="success"
                            subtitle="Network Rating"
                        />
                        <StatCard
                            title="Active Payouts"
                            value={`${analytics?.active_payouts || 0}`}
                            icon={Activity}
                            variant="default"
                            subtitle="Pending processing"
                        />
                    </>
                ) : (
                    <>
                        <StatCard
                            title="Active Sessions"
                            value={analytics?.active_sessions?.toString() || "0"}
                            icon={Server}
                            variant="brand"
                            trendComponent={<span className="text-primary font-bold text-xs uppercase tracking-wide">Live</span>}
                        />
                        <StatCard
                            title="Bandwidth Used"
                            value={`${analytics?.total_bandwidth_gb?.toFixed(2) ?? "0.00"} GB`}
                            icon={Wifi}
                            variant="default"
                            subtitle="Last 30 days"
                        />
                        <StatCard
                            title="Current Balance"
                            value={`${wallet?.balance_sol?.toFixed(4) ?? "0.0000"} SOL`}
                            icon={DollarSign}
                            variant="default"
                            subtitle="Available"
                        />
                        <StatCard
                            title="Network Latency"
                            value={`${analytics?.avg_latency_ms || 0}ms`}
                            icon={Activity}
                            variant="success"
                            subtitle="Average Ping"
                        />
                    </>
                )}
            </div>

            {/* Role Upgrade Banner — shown if only a consumer */}
            {!isProvider && (
                <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-6 rounded-2xl bg-primary/5 border border-primary/20 flex flex-col md:flex-row items-center justify-between gap-6"
                >
                    <div className="flex items-center gap-5">
                        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                            <Server size={28} />
                        </div>
                        <div>
                            <h3 className="text-lg font-black font-mono uppercase tracking-tight">Earn SOL as a Provider</h3>
                            <p className="text-xs text-muted-foreground font-medium max-w-md mt-1">
                                Share your unused bandwidth and earn passive income. Join the decentralized network today and start earning rewards for every GB shared.
                            </p>
                        </div>
                    </div>
                    <Link 
                        href="/dashboard/provider/cli" 
                        className="px-8 py-4 bg-primary text-primary-foreground font-black font-mono text-[11px] uppercase tracking-widest rounded-2xl shadow-[0_10px_20px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95 transition-all"
                    >
                        Become a Provider
                    </Link>
                </motion.div>
            )}

            {/* Wallet Connect Banner — shown when no Solana wallet is linked */}
            {!wallet?.linked_solana_address && (
                <div className="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-500">
                            <AlertCircle size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-amber-500">Connect a Wallet</h3>
                            <p className="text-sm text-amber-500/80 mt-1">
                                You need to link a Solana wallet to deposit funds and pay for sessions.
                            </p>
                        </div>
                    </div>
                    <Link href="/dashboard/wallet" className="px-5 py-2.5 bg-amber-500 text-amber-950 font-bold rounded-xl text-sm whitespace-nowrap hover:bg-amber-400 transition-colors">
                        Link Wallet
                    </Link>
                </div>
            )}

            {/* Main Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Traffic Activity */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="glass-card p-0 flex flex-col h-[400px] overflow-hidden">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                            <h3 className="font-bold flex items-center gap-2">
                                <Activity size={18} className="text-primary" />
                                Bandwidth Usage
                            </h3>
                            <span className="text-xs text-muted-foreground px-3 py-1 bg-white/5 rounded-full">Last 7 Days</span>
                        </div>
                        <div className="flex-1 min-h-0 p-6 relative">
                            {chartData.length === 0 ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center mt-10">
                                    <Activity size={48} className="text-white/10 mb-4" />
                                    <p className="text-sm text-muted-foreground font-medium">No usage data recorded</p>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                                        <XAxis
                                            dataKey="name"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                                            itemStyle={{ color: 'var(--primary)', fontWeight: 'bold' }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke="var(--primary)"
                                            strokeWidth={3}
                                            fillOpacity={1}
                                            fill="url(#colorValue)"
                                            animationDuration={1500}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Sidebar / Recent Sessions or Ledger */}
                <div className="space-y-6">
                    <div className="glass-card flex flex-col h-[400px]">
                        <div className="p-6 border-b border-white/5 flex items-center justify-between">
                            <h3 className="font-bold flex items-center gap-2">
                                <DollarSign size={18} className="text-emerald-500" />
                                Recent Transactions
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                            {!Array.isArray(wallet?.transactions) || wallet.transactions.length === 0 ? (
                                <div className="h-full flex items-center justify-center">
                                    <span className="text-sm text-muted-foreground">No recent transactions</span>
                                </div>
                            ) : (
                                (wallet?.transactions || []).slice(0, 5).map((tx) => (
                                    <div
                                        key={tx.id}
                                        className="flex gap-4 items-center p-3 hover:bg-white/5 rounded-xl transition-all"
                                    >
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                            tx.status === 'success' || tx.status === 'completed' 
                                                ? 'bg-emerald-500/10 text-emerald-500' 
                                                : tx.status === 'failed' 
                                                    ? 'bg-red-500/10 text-red-500' 
                                                    : 'bg-amber-500/10 text-amber-500'
                                        }`}>
                                            <DollarSign size={16} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold truncate text-foreground">{tx.description}</p>
                                            <p className="text-xs text-muted-foreground">{tx.created_at ? new Date(tx.created_at).toLocaleDateString() : 'Unknown'}</p>
                                        </div>
                                        <div className={`text-sm font-bold ${ (Number(tx.amount) || 0) >= 0 ? 'text-emerald-500' : 'text-foreground'}`}>
                                            { (Number(tx.amount) || 0) >= 0 ? '+' : ''}{ (Number(tx.amount) || 0).toFixed(2)}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-4 border-t border-white/5 text-center">
                            <Link href="/dashboard/wallet" className="text-sm font-medium text-emerald-500 hover:text-emerald-400 flex items-center justify-center gap-1 transition-colors">
                                View Full History <ExternalLink size={14} />
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
