"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Activity, Wifi, Server, DollarSign, Clock, AlertTriangle, AlertCircle, RefreshCw, Zap, Vote, User, ChevronRight } from "lucide-react";
import Link from "next/link";
import { getAnalyticsOverview, getWallet, getDailyUsage, AnalyticsOverview, Wallet, DailyUsagePoint } from "@/lib/api";
import { SkeletonDashboard } from "@/components/ui/skeleton";
import { NetworkFeed } from "@/components/NetworkFeed";
import { motion, AnimatePresence } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center justify-center min-h-[400px] text-center p-4"
            >
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
            </motion.div>
        );
    }

    const stats = [
        {
            label: "Active Sessions",
            value: analytics?.active_sessions?.toString() || "0",
            icon: Server,
            change: "Live",
            trend: "up",
            color: "text-blue-500",
            bg: "bg-blue-500/10"
        },
        {
            label: "Bandwidth Shared",
            value: `${analytics?.total_bandwidth_gb?.toFixed(2) || "0.00"} GB`,
            icon: Wifi,
            change: "Total",
            trend: "up",
            color: "text-emerald-500",
            bg: "bg-emerald-500/10"
        },
        {
            label: "Balance",
            value: `₵ ${wallet?.balance_ghs?.toFixed(2) || "0.00"}`,
            icon: DollarSign,
            change: wallet?.currency || "GHS",
            trend: "up",
            color: "text-amber-500",
            bg: "bg-amber-500/10"
        },
        {
            label: "Success Rate",
            value: `${((analytics?.success_rate || 0) * 100).toFixed(1)}%`,
            icon: Activity,
            change: `${analytics?.avg_latency_ms || 0}ms`,
            trend: analytics?.avg_latency_ms && analytics.avg_latency_ms > 100 ? "down" : "up",
            color: "text-violet-500",
            bg: "bg-violet-500/10"
        },
    ];

    const chartData = dailyUsage.map(d => ({
        name: new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }),
        value: Number((d.bytes_used / (1024 * 1024)).toFixed(2))
    }));

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-8 pb-20"
        >
            {/* Header */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter mb-1 bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        CENTRAL CONTROL HUB
                    </h1>
                    <div className="flex items-center gap-2">
                        <span className="text-muted-foreground font-mono text-[10px] tracking-widest uppercase">Operator ID:</span>
                        <code className="bg-secondary/50 px-2 py-0.5 rounded text-[10px] font-mono text-primary border border-primary/10">
                            {user?.email?.split('@')[0].toUpperCase()}
                        </code>
                        <span className="ml-4 px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-mono border border-primary/20 rounded">REAL-TIME_FIGURES</span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px]">
                    <span className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-full font-mono font-bold flex items-center gap-2 glow-emerald">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse outline outline-offset-2 outline-emerald-500/30"></span>
                        PROTOCOL_UPLINK: ACTIVE
                    </span>
                </div>
            </motion.div>

            {/* Quick Actions Bar */}
            <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { href: "/dashboard/nodes", label: "Node Service", sub: "Manage Endpoints", icon: Server },
                    { href: "/marketplace", label: "Marketplace", sub: "Buy Bandwidth", icon: Zap },
                    { href: "/governance", label: "Council Hub", sub: "Network Voting", icon: Vote },
                    { href: "/settings", label: "Config Center", sub: "Protocol Settings", icon: User },
                ].map((action, i) => (
                    <Link key={i} href={action.href}>
                        <motion.div
                            whileHover={{ scale: 1.02, y: -2 }}
                            whileTap={{ scale: 0.98 }}
                            className="glass-card p-4 hover:border-primary/50 transition-all flex items-center gap-3 group relative overflow-hidden"
                        >
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-100 transition-opacity">
                                <ChevronRight size={14} className="text-primary" />
                            </div>
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                <action.icon size={18} />
                            </div>
                            <div>
                                <div className="font-bold font-mono uppercase text-[10px] tracking-tight">{action.label}</div>
                                <div className="text-[9px] text-muted-foreground uppercase font-mono opacity-60 leading-none">{action.sub}</div>
                            </div>
                        </motion.div>
                    </Link>
                ))}
            </motion.div>

            {/* Stats Grid */}
            <motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat, i) => (
                    <motion.div
                        key={i}
                        whileHover={{ y: -5 }}
                        className="glass-card p-6 relative overflow-hidden group"
                    >
                        <div className={`absolute top-0 right-0 w-24 h-24 ${stat.bg} -mr-12 -mt-12 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity`} />
                        <div className="flex justify-between items-start mb-4 relative z-10">
                            <div className={`p-2 rounded-lg ${stat.bg} ${stat.color} border border-current/20`}>
                                <stat.icon size={20} />
                            </div>
                            <div className={`flex items-center text-[10px] font-bold font-mono px-2 py-0.5 rounded-full ${stat.trend === "up" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
                                {stat.change}
                            </div>
                        </div>
                        <div className="text-3xl font-black font-mono mb-1 tracking-tighter relative z-10">{stat.value}</div>
                        <div className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest opacity-60 relative z-10">{stat.label}</div>
                    </motion.div>
                ))}
            </motion.div>

            {/* Main Content Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Traffic Activity */}
                <motion.div variants={itemVariants} className="lg:col-span-2 space-y-6">
                    <div className="glass-card p-0 flex flex-col min-h-[400px] overflow-hidden">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                            <h3 className="font-bold font-mono uppercase text-xs tracking-widest flex items-center gap-2">
                                <Activity size={14} className="text-primary" />
                                Traffic Activity <span className="text-muted-foreground font-normal">(Last 7 Days)</span>
                            </h3>
                        </div>
                        <div className="flex-1 p-6 flex flex-col relative">
                            {chartData.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center text-muted-foreground font-mono text-[10px] uppercase tracking-widest">
                                    No data packets transmitted
                                </div>
                            ) : (
                                <div className="flex-1 h-full w-full min-h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
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
                                                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                                            />
                                            <YAxis
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                                            />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                                                itemStyle={{ color: 'var(--primary)' }}
                                            />
                                            <Area
                                                type="monotone"
                                                dataKey="value"
                                                stroke="var(--primary)"
                                                strokeWidth={2}
                                                fillOpacity={1}
                                                fill="url(#colorValue)"
                                                animationDuration={2000}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Network Feed */}
                    <motion.div variants={itemVariants} className="lg:hidden">
                        <NetworkFeed />
                    </motion.div>
                </motion.div>

                {/* Sidebar */}
                <motion.div variants={itemVariants} className="space-y-6">
                    {/* Transactions */}
                    <div className="glass-card p-0 flex flex-col bg-white/2">
                        <div className="p-6 border-b border-white/5 bg-white/5">
                            <h3 className="font-bold font-mono uppercase text-xs tracking-widest flex items-center gap-2">
                                <DollarSign size={14} className="text-amber-500" />
                                Ledger Activity
                            </h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[300px] scrollbar-hide">
                            {!Array.isArray(wallet?.transactions) || wallet.transactions.length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground font-mono text-[10px] uppercase tracking-widest opacity-50">
                                    Empty vault history
                                </div>
                            ) : (
                                (wallet?.transactions || []).slice(0, 5).map((tx) => (
                                    <motion.div
                                        key={tx.id}
                                        whileHover={{ x: 5 }}
                                        className="flex gap-4 items-center p-3 hover:bg-white/5 rounded-xl transition-all border border-transparent hover:border-white/5"
                                    >
                                        <div className={`w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor] ${tx.status === 'success' || tx.status === 'completed' ? 'text-emerald-500 bg-emerald-500' :
                                            tx.status === 'failed' ? 'text-rose-500 bg-rose-500' : 'text-amber-500 bg-amber-500'
                                            }`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold leading-none mb-1 truncate">{tx.description}</p>
                                            <div className="flex justify-between items-center w-full">
                                                <span className="text-[10px] font-mono text-muted-foreground opacity-60">{new Date(tx.created_at).toLocaleDateString()}</span>
                                                <span className={`text-xs font-black font-mono ${tx.amount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                    {tx.amount >= 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </div>
                        <div className="p-4 border-t border-white/5">
                            <Link href="/dashboard/wallet" className="group flex items-center justify-center gap-2 text-[10px] font-mono font-black text-primary hover:text-emerald-400 transition-colors uppercase tracking-widest">
                                Expand Ledger
                                <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
                            </Link>
                        </div>
                    </div>

                    {/* Desktop Network Feed */}
                    <div className="hidden lg:block h-[400px]">
                        <NetworkFeed />
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}
