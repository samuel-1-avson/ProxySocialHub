"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ArrowUpRight, ArrowDownRight, Activity, Wifi, Server, DollarSign, Clock, AlertTriangle, AlertCircle, RefreshCw, Zap, Vote, User } from "lucide-react";
import Link from "next/link";
import { getAnalyticsOverview, getWallet, getDailyUsage, AnalyticsOverview, Wallet, DailyUsagePoint } from "@/lib/api";
import { SkeletonDashboard } from "@/components/ui/skeleton";
import { NetworkFeed } from "@/components/NetworkFeed";

export default function DashboardPage() {
    const { user } = useAuth();
    const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [dailyUsage, setDailyUsage] = useState<DailyUsagePoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const [analyticsData, walletData, usageData] = await Promise.all([
                getAnalyticsOverview().catch(() => null),
                getWallet().catch(() => null),
                getDailyUsage(7).catch(() => ({ data: [] }))
            ]);

            if (!analyticsData && !walletData) {
                // throw new Error("Failed to load core data"); // Relaxed for now
            }

            setAnalytics(analyticsData);
            setWallet(walletData);
            setDailyUsage(usageData?.data || []);
            setError(null);
        } catch (error) {
            console.error("Failed to fetch dashboard data", error);
            if (!analytics) {
                setError("Failed to load dashboard data. Please check your connection.");
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            fetchData();
            const interval = setInterval(fetchData, 30000);
            return () => clearInterval(interval);
        }
    }, [user]);

    if (loading) {
        return <SkeletonDashboard />;
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-4 animate-in fade-in">
                <div className="p-4 rounded-full bg-destructive/10 mb-4">
                    <AlertCircle className="h-12 w-12 text-destructive" />
                </div>
                <h2 className="text-xl font-bold font-mono uppercase mb-2">System Unavailable</h2>
                <p className="text-muted-foreground font-mono text-sm mb-6 max-w-md">{error}</p>
                <button
                    onClick={() => { setLoading(true); fetchData(); }}
                    className="btn-retro btn-retro-primary flex items-center gap-2"
                >
                    <RefreshCw className="h-4 w-4" />
                    Retry Connection
                </button>
            </div>
        );
    }

    const stats = [
        {
            label: "Active Sessions",
            value: analytics?.active_sessions?.toString() || "0",
            icon: Server,
            change: "Live",
            trend: "up",
            color: "text-blue-500"
        },
        {
            label: "Bandwidth Shared",
            value: `${analytics?.total_bandwidth_gb?.toFixed(2) || "0.00"} GB`,
            icon: Wifi,
            change: "Total",
            trend: "up",
            color: "text-green-500"
        },
        {
            label: "Balance",
            value: `₵ ${wallet?.balance_ghs?.toFixed(2) || "0.00"}`,
            icon: DollarSign,
            change: wallet?.currency || "GHS",
            trend: "up",
            color: "text-yellow-500"
        },
        {
            label: "Success Rate",
            value: `${((analytics?.success_rate || 0) * 100).toFixed(1)}%`,
            icon: Activity,
            change: `${analytics?.avg_latency_ms || 0}ms`,
            trend: analytics?.avg_latency_ms && analytics.avg_latency_ms > 100 ? "down" : "up",
            color: "text-purple-500"
        },
    ];

    const maxBytes = Math.max(...dailyUsage.map(d => d.bytes_used), 1);

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">System Overview</h1>
                    <p className="text-muted-foreground font-mono text-xs">OPERATOR: {user?.email?.toUpperCase()}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 bg-primary/10 text-primary border border-primary/20 rounded-sm font-mono flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                        SYSTEM ONLINE
                    </span>
                </div>
            </div>

            {/* Quick Actions Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link href="/dashboard/nodes" className="card-retro p-4 bg-card hover:border-primary transition-all flex items-center gap-3 group">
                    <div className="w-10 h-10 bg-secondary/30 rounded-full flex items-center justify-center text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Server size={18} />
                    </div>
                    <div>
                        <div className="font-bold font-mono uppercase text-xs">Manage Nodes</div>
                        <div className="text-[10px] text-muted-foreground">Configure endpoints</div>
                    </div>
                </Link>
                <Link href="/marketplace" className="card-retro p-4 bg-card hover:border-primary transition-all flex items-center gap-3 group">
                    <div className="w-10 h-10 bg-secondary/30 rounded-full flex items-center justify-center text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Zap size={18} />
                    </div>
                    <div>
                        <div className="font-bold font-mono uppercase text-xs">Buy Bandwidth</div>
                        <div className="text-[10px] text-muted-foreground">Access proxy network</div>
                    </div>
                </Link>
                <Link href="/governance" className="card-retro p-4 bg-card hover:border-primary transition-all flex items-center gap-3 group">
                    <div className="w-10 h-10 bg-secondary/30 rounded-full flex items-center justify-center text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <Vote size={18} />
                    </div>
                    <div>
                        <div className="font-bold font-mono uppercase text-xs">Governance</div>
                        <div className="text-[10px] text-muted-foreground">Vote on proposals</div>
                    </div>
                </Link>
                <Link href="/settings" className="card-retro p-4 bg-card hover:border-primary transition-all flex items-center gap-3 group">
                    <div className="w-10 h-10 bg-secondary/30 rounded-full flex items-center justify-center text-foreground group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                        <User size={18} />
                    </div>
                    <div>
                        <div className="font-bold font-mono uppercase text-xs">Profile</div>
                        <div className="text-[10px] text-muted-foreground">Edit public info</div>
                    </div>
                </Link>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat, i) => (
                    <div key={i} className="card-retro p-6 bg-card hover:-translate-y-1 transition-transform cursor-default">
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-2 rounded-sm border border-border bg-background ${stat.color}`}>
                                <stat.icon size={20} />
                            </div>
                            <div className={`flex items-center text-xs font-bold font-mono ${stat.trend === "up" ? "text-green-500" : "text-yellow-500"}`}>
                                {stat.change}
                            </div>
                        </div>
                        <div className="text-2xl font-bold font-mono mb-1">{stat.value}</div>
                        <div className="text-xs text-muted-foreground uppercase font-mono tracking-wider">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Main Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Traffic Activity */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="card-retro p-0 bg-card flex flex-col min-h-[400px]">
                        <div className="p-6 border-b border-border flex justify-between items-center">
                            <h3 className="font-bold font-mono uppercase">Traffic Activity (7 Days)</h3>
                        </div>
                        <div className="flex-1 p-6 flex items-end justify-between gap-2 relative bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]">
                            {dailyUsage.length === 0 ? (
                                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground font-mono text-xs uppercase">
                                    No traffic data available
                                </div>
                            ) : (
                                dailyUsage.map((day, i) => {
                                    const heightPercent = (day.bytes_used / maxBytes) * 80;
                                    return (
                                        <div key={i} className="flex-1 flex flex-col justify-end items-center gap-2 group h-full">
                                            <div className="w-full relative flex-1 flex items-end">
                                                <div
                                                    className="w-full bg-primary/20 border border-primary/50 text-center relative group-hover:bg-primary/40 transition-all mx-1"
                                                    style={{ height: `${Math.max(heightPercent, 2)}%` }}
                                                >
                                                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-popover border border-border px-2 py-1 text-[10px] whitespace-nowrap z-10 font-mono shadow-md">
                                                        {(day.bytes_used / (1024 * 1024)).toFixed(1)} MB
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-[10px] font-mono text-muted-foreground rotate-0 truncate w-full text-center">
                                                {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Network Feed */}
                    <div className="lg:hidden">
                        <NetworkFeed />
                    </div>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Transactions */}
                    <div className="card-retro p-0 bg-card flex flex-col">
                        <div className="p-6 border-b border-border">
                            <h3 className="font-bold font-mono uppercase">Recent Transactions</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[300px]">
                            {!wallet?.transactions || wallet.transactions.length === 0 ? (
                                <div className="text-center py-10 text-muted-foreground font-mono text-xs uppercase">
                                    No recent activity
                                </div>
                            ) : (
                                wallet.transactions.slice(0, 5).map((tx) => (
                                    <div key={tx.id} className="flex gap-3 items-start p-3 hover:bg-accent/50 rounded-sm transition-colors border border-transparent hover:border-border/50">
                                        <div className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${tx.status === 'success' || tx.status === 'completed' ? 'bg-green-500' :
                                            tx.status === 'failed' ? 'bg-destructive' : 'bg-yellow-500'
                                            }`} />
                                        <div>
                                            <p className="text-sm font-medium leading-none mb-1">{tx.description}</p>
                                            <div className="flex justify-between items-center w-full gap-4">
                                                <span className="text-[10px] font-mono text-muted-foreground">{new Date(tx.created_at).toLocaleDateString()}</span>
                                                <span className={`text-[10px] font-mono font-bold ${tx.amount >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-4 border-t border-border bg-secondary/10">
                            <Link href="/dashboard/wallet" className="block text-center text-xs font-mono font-bold text-primary hover:underline uppercase">
                                View Wallet Ledger
                            </Link>
                        </div>
                    </div>

                    {/* Desktop Network Feed */}
                    <div className="hidden lg:block h-[400px]">
                        <NetworkFeed />
                    </div>
                </div>
            </div>
        </div>
    );
}
