"use client";

import { useEffect, useState, useMemo } from 'react';
import { getSessions, getSessionUsage, Session, UsageStats } from '@/lib/api';
import { 
    ExternalLink, 
    Database, 
    Coins, 
    Server, 
    Loader2, 
    RefreshCw, 
    Activity, 
    Zap, 
    ArrowUpRight,
    TrendingUp,
    ShieldCheck,
    Cpu,
    Network
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';

interface SessionWithUsage extends Session {
    usage?: UsageStats;
}

function usageCostSOL(usage?: UsageStats): number {
    return Number(usage?.cost_sol ?? 0);
}

export default function UsagePage() {
    const [sessions, setSessions] = useState<SessionWithUsage[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalUsage, setTotalUsage] = useState({ gb: 0, cost: 0 });

    useEffect(() => {
        fetchData();
    }, []);

    async function fetchData() {
        setLoading(true);
        try {
            const sessionsData = await getSessions();
            const safeSessionsData = Array.isArray(sessionsData) ? sessionsData : [];

            // Fetch usage for each session
            const sessionsWithUsage = await Promise.all(
                safeSessionsData.map(async (session) => {
                    try {
                        const usage = await getSessionUsage(session.credentials_user);
                        return { ...session, usage };
                    } catch {
                        return session;
                    }
                })
            );

            setSessions(sessionsWithUsage as SessionWithUsage[]);

            // Calculate totals
            const totals = (sessionsWithUsage as SessionWithUsage[]).reduce(
                (acc, s) => ({
                    gb: acc.gb + (s.usage?.gb_used || 0),
                    cost: acc.cost + usageCostSOL(s.usage),
                }),
                { gb: 0, cost: 0 }
            );
            setTotalUsage(totals);
        } catch (error) {
            console.error('Failed to fetch data:', error);
            setSessions([]);
        } finally {
            setLoading(false);
        }
    }

    const activeSessionsCount = useMemo(() => 
        sessions.filter((s) => s.status === 'active').length
    , [sessions]);

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="font-mono text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground animate-pulse">
                    Calculating consumption ledger...
                </p>
            </div>
        );
    }

    return (
        <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-12 pb-20"
        >
            {/* Header Section */}
            <motion.div variants={itemVariants} className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-8">
                <div>
                    <div className="flex items-center gap-2 text-primary font-mono text-[10px] font-black uppercase tracking-[0.3em] mb-1">
                        <Activity size={12} className="animate-pulse" /> Telemetry Stream Alpha
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Resource Consumption
                    </h1>
                </div>
                <motion.button 
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={fetchData} 
                    className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-mono font-black uppercase tracking-widest hover:bg-white/10 hover:border-primary/50 transition-all text-muted-foreground hover:text-foreground group"
                >
                    <RefreshCw size={14} className="group-hover:rotate-180 transition-transform duration-500" /> 
                    Synchronize Data
                </motion.button>
            </motion.div>

            {/* Top Summaries */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: "Total Data Flow", value: `${Number(totalUsage.gb || 0).toFixed(3)}`, unit: "GB", icon: Database, color: "text-primary", bg: "bg-primary/5" },
                    { label: "Accrued Settlement", value: `${Number(totalUsage.cost || 0).toFixed(6)} SOL`, icon: Coins, color: "text-emerald-400", bg: "bg-emerald-400/5" },
                    { label: "Active Connections", value: activeSessionsCount, icon: Server, color: "text-amber-400", bg: "bg-amber-400/5" },
                ].map((stat, i) => (
                    <motion.div key={i} variants={itemVariants} whileHover={{ y: -5 }}>
                        <GlassCard className={`p-8 border-white/5 hover:border-white/10 transition-all group overflow-hidden relative ${stat.bg}`}>
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <stat.icon size={80} />
                            </div>
                            <div className="flex justify-between items-center mb-6">
                                <p className="text-[10px] font-mono font-black text-muted-foreground uppercase tracking-widest">{stat.label}</p>
                                <div className={`w-8 h-8 rounded-lg ${stat.bg} flex items-center justify-center border border-white/5`}>
                                    <TrendingUp size={14} className={stat.color} />
                                </div>
                            </div>
                            <div className="text-4xl font-black font-mono tracking-tighter flex items-baseline gap-2">
                                {stat.value}
                                {stat.unit && <span className="text-sm opacity-40 uppercase">{stat.unit}</span>}
                            </div>
                        </GlassCard>
                    </motion.div>
                ))}
            </div>

            {/* Session Breakdown Section */}
            <motion.div variants={itemVariants} className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-black font-mono uppercase tracking-[0.2em] flex items-center gap-2">
                        <Network size={16} className="text-primary" /> Session Segment Analysis
                    </h2>
                    <div className="text-[10px] font-mono font-black text-muted-foreground uppercase opacity-40">
                        Total Segments: {sessions.length}
                    </div>
                </div>

                {sessions.length === 0 ? (
                    <GlassCard className="p-20 text-center border-dashed border-white/10 opacity-50">
                        <p className="text-[10px] font-mono font-black uppercase tracking-[0.5em] text-muted-foreground">
                            No telemetry data detected in current sector.
                        </p>
                    </GlassCard>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        <AnimatePresence>
                            {sessions.map((session, idx) => {
                                const usage = session.usage;
                                const percentUsed = usage?.percent_used || 0;
                                return (
                                    <motion.div
                                        key={session.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                    >
                                        <GlassCard className="group hover:bg-white/5 border-white/5 p-6 flex flex-col md:flex-row items-center gap-8 group">
                                            {/* ID & Type */}
                                            <div className="w-full md:w-1/4 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className={`w-2 h-2 rounded-full ${session.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                                                    <span className="text-[11px] font-black font-mono uppercase text-foreground">
                                                        {session.id.slice(0, 12)}
                                                    </span>
                                                </div>
                                                <div className="text-[9px] font-mono font-black text-muted-foreground uppercase tracking-widest ml-4 flex items-center gap-2">
                                                    {session.type} Tunnel 
                                                    {session.tx_hash && (
                                                        <a 
                                                            href={`https://solscan.io/tx/${session.tx_hash}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-primary hover:underline flex items-center gap-0.5"
                                                        >
                                                            <ExternalLink size={8} /> On-chain
                                                        </a>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Consumption Progress */}
                                            <div className="w-full md:w-2/4 space-y-2">
                                                <div className="flex justify-between text-[9px] font-mono font-black uppercase tracking-widest text-muted-foreground">
                                                    <span>Consumption Gauge</span>
                                                    <span className={percentUsed > 90 ? 'text-rose-500' : 'text-primary'}>
                                                        {Number(usage?.gb_used || 0).toFixed(3)} GB / {((Number(usage?.bytes_limit || 0)) / (1024 * 1024 * 1024)).toFixed(1)} GB
                                                    </span>
                                                </div>
                                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                                                    <motion.div 
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${Math.min(percentUsed, 100)}%` }}
                                                        transition={{ duration: 1, delay: 0.2 }}
                                                        className={`h-full rounded-full ${percentUsed > 90 ? 'bg-rose-500' : 'bg-gradient-to-r from-primary to-emerald-400'}`} 
                                                    />
                                                </div>
                                            </div>

                                            {/* Settlement / Cost */}
                                            <div className="w-full md:w-1/4 text-right">
                                                <div className="text-[9px] font-mono font-black text-muted-foreground uppercase mb-1 opacity-40">Accrued Flow</div>
                                                <div className="text-xl font-black font-mono text-primary tracking-tighter">
                                                    {usageCostSOL(usage).toFixed(6)} SOL
                                                </div>
                                            </div>
                                        </GlassCard>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </motion.div>

            {/* Optimization Protocols Section */}
            <motion.div variants={itemVariants}>
                <GlassCard className="p-8 border-primary/20 bg-primary/2 overflow-hidden relative">
                    <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl opacity-50" />
                    <h2 className="text-xs font-black font-mono uppercase mb-6 flex items-center gap-3 tracking-widest relative z-10">
                        <ShieldCheck size={16} className="text-primary" /> Optimization Protocols
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10">
                        {[
                            { title: "Load Balancing", desc: "Use rotating sessions for high-volume scraping to distribute load effectively.", icon: Cpu },
                            { title: "Compression Alpha", desc: "Enable payload compression (GZip) to strictly reduce metered data transfer.", icon: Zap },
                            { title: "GC Protocol", desc: "Periodically purge inactive sessions to prevent ghost bandwidth leakage.", icon: Activity },
                        ].map((tip, i) => (
                            <div key={i} className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <tip.icon size={14} className="text-primary" />
                                    <h3 className="text-[10px] font-black font-mono uppercase text-foreground">{tip.title}</h3>
                                </div>
                                <p className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed uppercase font-bold">
                                    {tip.desc}
                                </p>
                            </div>
                        ))}
                    </div>
                </GlassCard>
            </motion.div>
        </motion.div>
    );
}
