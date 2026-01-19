"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { ArrowUpRight, ArrowDownRight, Activity, Wifi, Server, DollarSign, Clock, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { getAnalyticsOverview, getWallet, AnalyticsOverview, Wallet } from "@/lib/api";

export default function DashboardPage() {
    const { user } = useAuth();
    const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
    const [wallet, setWallet] = useState<Wallet | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchData() {
            try {
                const [analyticsData, walletData] = await Promise.all([
                    getAnalyticsOverview().catch(() => null),
                    getWallet().catch(() => null)
                ]);
                setAnalytics(analyticsData);
                setWallet(walletData);
            } catch (error) {
                console.error("Failed to fetch dashboard data", error);
            } finally {
                setLoading(false);
            }
        }
        if (user) {
            fetchData();
        }
    }, [user]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-8 h-8 rounded-sm bg-primary animate-spin"></div>
                <p className="mt-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">Synchronizing Uplink...</p>
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
            value: `₵ ${wallet?.balance?.toFixed(2) || "0.00"}`,
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

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight mb-1">System Overview</h1>
                    <p className="text-muted-foreground font-mono text-xs">OPERATOR: {user?.email?.toUpperCase()}</p>
                </div>
                <div className="flex gap-3">
                    <Link href="/dashboard/nodes" className="btn-retro btn-retro-primary text-xs py-2">
                        Manage Nodes
                    </Link>
                </div>
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

            {/* Recent Activity & Network Status */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Traffic Activity (Placeholder for Real Graph) */}
                <div className="lg:col-span-2 card-retro p-0 bg-card flex flex-col">
                    <div className="p-6 border-b border-border flex justify-between items-center">
                        <h3 className="font-bold font-mono uppercase">Traffic Activity</h3>
                        <div className="flex gap-2 text-xs font-mono">
                            <span className="px-2 py-1 bg-primary/10 text-primary rounded-sm border border-primary/20 cursor-pointer">Live</span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-[300px] bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] relative flex items-center justify-center">
                        <div className="text-center p-8">
                            <div className="mb-4 inline-block p-4 rounded-full bg-secondary/30">
                                <Activity className="w-8 h-8 text-muted-foreground" />
                            </div>
                            <p className="font-mono text-xs text-muted-foreground uppercase">Real-time telemetry coming soon</p>
                        </div>

                        {/* Simple Overlay if we have data */}
                        {analytics && analytics.active_sessions > 0 && (
                            <div className="absolute inset-x-0 bottom-0 top-0 opacity-10 flex items-end px-4 gap-1">
                                {Array.from({ length: 20 }).map((_, i) => (
                                    <div key={i} className="flex-1 bg-primary" style={{ height: `${Math.random() * 60 + 20}%` }}></div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Recent Transactions (Real Logic) */}
                <div className="card-retro p-0 bg-card flex flex-col">
                    <div className="p-6 border-b border-border">
                        <h3 className="font-bold font-mono uppercase">Recent Transactions</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[400px]">
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
            </div>
        </div>
    );
}
