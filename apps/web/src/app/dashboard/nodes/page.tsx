"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
    Activity,
    Zap,
    Cpu,
    Shield,
    Signal,
    Search,
    MapPin,
    Box,
    ArrowRight,
    RefreshCw,
    Server,
    Globe,
    ChevronRight,
    Wifi
} from "lucide-react";
import { ProviderNode } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";

function NodesContent() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [realNodes, setNodes] = useState<ProviderNode[]>([]);
    const [searchQuery, setSearchQuery] = useState("");

    const fetchNodes = async () => {
        setLoading(true);
        try {
            const { getProviderNodes } = await import('@/lib/api');
            const data = await getProviderNodes();
            setNodes(data.nodes || []);
        } catch (e) {
            console.error("Failed to load nodes", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchNodes();
    }, []);

    const safeNodes = Array.isArray(realNodes) ? realNodes : [];
    const displayNodes = safeNodes
        .filter(n => n.id.toLowerCase().includes(searchQuery.toLowerCase()) || n.city?.toLowerCase().includes(searchQuery.toLowerCase()))
        .map(n => ({
            id: n.id,
            location: n.city || "Unknown sector",
            type: n.connection_type || "Residential",
            status: n.status === "online" ? "online" : "offline",
            latency: n.latency_ms ? `${n.latency_ms}ms` : "N/A",
            throughput: "N/A",
            uptime: n.uptime_percent ? `${n.uptime_percent}%` : "100%",
            trust: n.quality_score || 85
        }));

    const activeStats = {
        connections: safeNodes.reduce((acc, n) => acc + (n.active_connections || 0), 0) || 0,
        avgLatency: safeNodes.length > 0 ? Math.round(safeNodes.reduce((acc, n) => acc + (n.latency_ms || 0), 0) / safeNodes.length) : 0,
        avgTrust: safeNodes.length > 0 ? (safeNodes.reduce((acc, n) => acc + (n.quality_score || 0), 0) / safeNodes.length).toFixed(1) : "94.2"
    };

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

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="space-y-8 pb-20"
        >
            {/* Header */}
            <motion.div variants={itemVariants} className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/5">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-emerald-500 font-mono text-[10px] font-black uppercase tracking-[0.3em]">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Network Core Synchronized
                    </div>
                    <h1 className="text-4xl font-black font-mono uppercase tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-emerald-400">
                        Node Infrastructure
                    </h1>
                    <p className="text-muted-foreground font-mono text-[11px] max-w-lg opacity-60 uppercase tracking-tight">
                        GLOBAL MAPPING OF DISTRIBUTED PROXY NODES. REAL-TIME TELEMETRY AND AVAILABILITY.
                    </p>
                </div>

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={fetchNodes}
                    className="flex items-center gap-2 px-4 py-2 glass-card !p-2 !rounded-xl border border-white/10 hover:border-primary/50 text-[10px] font-black font-mono uppercase tracking-widest transition-all"
                >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    Refresh Grid
                </motion.button>
            </motion.div>

            {/* Network Overview Stats */}
            <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: "Active Connections", value: activeStats.connections.toLocaleString(), icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
                    { label: "Total Nodes", value: realNodes.length.toString(), icon: Zap, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                    { label: "Avg Latency", value: `${activeStats.avgLatency}ms`, icon: Cpu, color: "text-violet-500", bg: "bg-violet-500/10" },
                    { label: "Avg trust level", value: `${activeStats.avgTrust}%`, icon: Shield, color: "text-amber-500", bg: "bg-amber-500/10" },
                ].map((stat, i) => (
                    <div key={i} className="glass-card p-4 relative overflow-hidden group">
                        <div className={`absolute top-0 right-0 w-16 h-16 ${stat.bg} -mr-8 -mt-8 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity`} />
                        <div className="flex justify-between items-start mb-2 relative z-10">
                            <stat.icon size={18} className={`${stat.color} opacity-70`} />
                        </div>
                        <div className="text-2xl font-black font-mono text-foreground tracking-tighter relative z-10">{stat.value}</div>
                        <div className="text-[9px] font-mono font-black text-muted-foreground uppercase tracking-[0.2em] opacity-40 relative z-10">{stat.label}</div>
                    </div>
                ))}
            </motion.div>

            {/* Search & Filters */}
            <motion.div variants={itemVariants} className="glass-card p-4 flex flex-col md:flex-row items-center gap-4 bg-white/2 border-white/5">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-primary" size={14} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="INTERCEPT NODE ID OR LOCATION..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-xs font-mono font-bold focus:border-primary/50 focus:outline-none transition-all uppercase placeholder:text-muted-foreground/30"
                    />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <select className="bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-[10px] font-mono font-black uppercase focus:border-primary/50 focus:outline-none cursor-pointer flex-1 md:w-56 appearance-none text-muted-foreground hover:text-foreground transition-colors">
                        <option>Grid sector: All</option>
                        <option>Residential Grid</option>
                        <option>Mobile Terminals</option>
                        <option>Vault Datacenters</option>
                    </select>
                </div>
            </motion.div>

            {/* Nodes Grid */}
            <AnimatePresence mode="popLayout">
                <motion.div
                    layout
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                    {loading ? (
                        Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="h-[220px] glass-card animate-pulse rounded-2xl border-white/5 bg-white/2"></div>
                        ))
                    ) : displayNodes.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="col-span-full py-24 text-center glass-card border-dashed border-white/10"
                        >
                            <Server size={48} className="mx-auto text-primary mb-6 opacity-20" />
                            <p className="font-mono text-xl font-black uppercase tracking-widest text-foreground/40 text-[12px]">No Active Node Signals</p>
                            <p className="font-mono text-[10px] text-muted-foreground mt-2 opacity-30 tracking-widest uppercase">ADJUST FILTERS OR DEPLOY NEW INFRASTRUCTURE</p>
                        </motion.div>
                    ) : (
                        displayNodes.map((node) => (
                            <motion.div
                                key={node.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                whileHover={{ y: -8 }}
                                className="glass-card p-6 group relative overflow-hidden bg-white/2 border-white/5"
                            >
                                <div className="absolute top-0 right-0 p-4 text-[4rem] font-black text-primary opacity-[0.03] group-hover:opacity-[0.08] transition-all leading-none select-none italic">
                                    {node.id.substring(0, 2).toUpperCase()}
                                </div>

                                <div className="relative z-10">
                                    <div className="flex items-center justify-between mb-5">
                                        <div className={`px-3 py-1 rounded-full border text-[9px] font-mono font-black uppercase flex items-center gap-2 ${node.status === "online"
                                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                            : "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                            }`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${node.status === "online" ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}></div>
                                            {node.status}
                                        </div>
                                        <div className="flex items-center gap-2 text-muted-foreground/60">
                                            <MapPin size={12} className="text-primary" />
                                            <span className="text-[9px] font-mono font-black uppercase tracking-widest">{node.location}</span>
                                        </div>
                                    </div>

                                    <div className="mb-6">
                                        <h3 className="text-xl font-black font-mono uppercase group-hover:text-primary transition-colors tracking-tighter">
                                            {node.type}
                                        </h3>
                                        <div className="flex items-center gap-2 text-muted-foreground opacity-40">
                                            <Wifi size={12} />
                                            <p className="text-[9px] font-mono font-black uppercase tracking-widest">PROTOCOL {node.id.substring(0, 8)}</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6 pt-5 border-t border-white/5">
                                        <div>
                                            <p className="text-[9px] font-mono text-muted-foreground font-black uppercase tracking-widest mb-1 opacity-40">Latency</p>
                                            <p className="text-base font-black font-mono text-foreground">{node.latency}</p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-mono text-muted-foreground font-black uppercase tracking-widest mb-1 opacity-40">Trust</p>
                                            <p className="text-base font-black font-mono text-primary">{Math.round(node.trust)}%</p>
                                        </div>
                                    </div>

                                    <div className="mt-5 pt-5 border-t border-white/5">
                                        <div className="flex justify-between items-center mb-1.5 text-[9px] font-mono font-black uppercase tracking-widest">
                                            <span className="text-muted-foreground opacity-50">Stability Index</span>
                                            <span className="text-primary">{node.uptime}</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: node.uptime }}
                                                className="h-full bg-gradient-to-r from-primary to-emerald-400"
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-8 flex justify-end">
                                        <motion.button
                                            whileHover={{ x: 5 }}
                                            className="w-10 h-10 flex items-center justify-center glass-card border border-white/10 !p-0 !rounded-xl text-muted-foreground hover:text-primary hover:border-primary/50 transition-all shadow-lg"
                                        >
                                            <ChevronRight size={18} />
                                        </motion.button>
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    )}
                </motion.div>
            </AnimatePresence>

            {/* Action Bar */}
            {!loading && displayNodes.length > 0 && (
                <motion.div variants={itemVariants} className="flex justify-center pt-12">
                    <motion.button
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        className="px-10 py-4 glass-card border border-primary/20 hover:border-primary/50 text-xs font-black font-mono uppercase tracking-[0.4em] text-primary transition-all flex items-center gap-3"
                    >
                        Scan More sectors
                        <ArrowRight size={16} className="animate-pulse" />
                    </motion.button>
                </motion.div>
            )}
        </motion.div>
    );
}

export default function NodesPage() {
    return (
        <ProtectedRoute>
            <NodesContent />
        </ProtectedRoute>
    );
}
