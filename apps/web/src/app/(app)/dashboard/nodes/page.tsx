"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
    Globe,
    Wifi,
    Cpu,
    Shield,
    Activity,
    Server,
    Zap,
    ArrowRight,
    Database,
    MapPin,
    RefreshCw,
    Search,
    Terminal,
    Signal,
    Box
} from "lucide-react";
import Link from "next/link";
import { ProviderNode } from "@/lib/api";

function NodesContent() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [signalLogs, setSignalLogs] = useState<{ id: number; msg: string; type: string }[]>([]);
    const [realNodes, setNodes] = useState<ProviderNode[]>([]);

    useEffect(() => {
        // Fetch Real Nodes
        const fetchNodes = async () => {
            try {
                const { getProviderNodes } = await import('@/lib/api');
                const data = await getProviderNodes();
                setNodes(data.nodes);
            } catch (e) {
                console.error("Failed to load nodes", e);
            } finally {
                setLoading(false);
            }
        };
        fetchNodes();

        // Simulate signal pulse stream
        const interval = setInterval(() => {
            const logs = [
                "Handshake established with Node-88 (Accra)",
                "Signal stability optimized in Sector 4",
                "Traffic rotation active on 1,492 nodes",
                "New mobile terminal discovered in Kumasi",
                "Encryption keys rotated for active sessions",
            ];
            const randomMsg = logs[Math.floor(Math.random() * logs.length)];
            setSignalLogs(prev => [{ id: Date.now(), msg: randomMsg, type: "info" }, ...prev].slice(0, 5));
        }, 3000);

        return () => {
            clearInterval(interval);
        };
    }, []);

    // Map Real Nodes to UI format or fallback to mock if empty (user has no nodes yet)
    const displayNodes = realNodes.length > 0 ? realNodes.map(n => ({
        id: `node-${n.id.substring(0, 4)}`,
        location: n.city || "Unknown",
        type: "Residential", // Default for now
        status: n.status === "online" ? "online" : "offline",
        latency: `${n.latency_ms}ms`,
        throughput: "1Gbps", // Placeholder as logic isn't in DB yet
        uptime: `${n.uptime_percent}%`,
        trust: n.quality_score // Add trust score to object for display
    })) : [
        // Keep mock nodes as "Global Network Preview" if user has no personal nodes
        { id: "node-01", location: "Accra Central", type: "Residential", status: "online", latency: "12ms", throughput: "1.2Gbps", uptime: "99.9%", trust: 98 },
        { id: "node-02", location: "Kumasi CBD", type: "Mobile", status: "online", latency: "45ms", throughput: "450Mbps", uptime: "98.5%", trust: 92 },
        { id: "node-03", location: "Takoradi Port", type: "Datacenter", status: "maintenance", latency: "8ms", throughput: "10Gbps", uptime: "99.9%", trust: 99 },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-10 pb-20 relative">
            {/* Decorative Elements */}
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute top-1/2 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>

            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10">
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-[0.4em] mb-2 animate-pulse">
                        <Signal size={14} />
                        Network Core Active
                    </div>
                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tighter uppercase italic">Node <span className="text-primary not-italic">Infrastructure</span></h1>
                    <p className="text-muted-foreground max-w-lg font-medium leading-relaxed">System-wide monitoring of distributed proxy nodes. Real-time availability mapping and latency optimization across the Ghana grid.</p>
                </div>

                {/* Signal Stream Mini-Panel */}
                <div className="lg:w-80 h-32 rounded-3xl bg-[var(--glass-bg)] border border-[var(--glass-border)] p-5 relative overflow-hidden group shadow-[var(--glass-shadow)]">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary/30"></div>
                    <div className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-widest mb-3">
                        <Terminal size={12} />
                        Signal Stream
                    </div>
                    <div className="space-y-2 overflow-hidden h-[calc(100%-25px)]">
                        {signalLogs.map(log => (
                            <div key={log.id} className="text-[9px] font-bold text-white/40 font-mono truncate animate-in slide-in-from-left-2 items-center flex gap-2">
                                <span className="text-primary/60">{`>`}</span>
                                {log.msg}
                            </div>
                        ))}
                        {signalLogs.length === 0 && <div className="text-[9px] font-bold text-white/20 animate-pulse">Awaiting data packets...</div>}
                    </div>
                </div>
            </div>

            {/* Network Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {[
                    { label: "Active Connections", value: "1,294", icon: Activity, color: "text-primary" },
                    { label: "Global Throughput", value: "14.2 Tbps", icon: Zap, color: "text-blue-400" },
                    { label: "Avg Latency", value: "24ms", icon: Cpu, color: "text-purple-400" },
                    { label: "Trust Score", value: "98.2", icon: Shield, color: "text-orange-400" },
                ].map((stat, i) => (
                    <div key={i} className="group p-6 rounded-[2rem] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)] space-y-4 hover:border-primary/20 transition-all shadow-[var(--glass-shadow)] hover:shadow-primary/5">
                        <div className={`p-3 rounded-2xl bg-white/5 w-fit ${stat.color} group-hover:scale-110 transition-transform`}>
                            <stat.icon size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground opacity-50 mb-1">{stat.label}</p>
                            <p className="text-2xl font-black text-white tracking-tighter">{stat.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search & Filters */}
            <div className="p-4 rounded-[2.5rem] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)] flex flex-col md:flex-row items-center gap-4 shadow-[var(--glass-shadow)]">
                <div className="flex-1 relative w-full group">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="Intercept Node Identifier..."
                        className="w-full bg-black/20 border border-white/5 rounded-2xl py-4 pl-14 pr-6 text-sm font-bold text-white outline-none focus:border-primary/50 transition-all placeholder:text-white/10"
                    />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <select className="bg-black/20 border border-white/5 rounded-2xl py-4 px-6 text-[10px] font-black uppercase tracking-widest text-white outline-none appearance-none cursor-pointer flex-1 md:w-52">
                        <option>Architecture: All</option>
                        <option>Residential Grid</option>
                        <option>Mobile Terminals</option>
                        <option>Vault Datacenters</option>
                    </select>
                    <button className="p-4 rounded-2xl bg-primary text-black hover:scale-105 active:scale-95 transition-all shadow-lg shadow-primary/20 group">
                        <RefreshCw size={18} className={`${loading ? "animate-spin" : ""} group-hover:rotate-180 transition-transform duration-500`} />
                    </button>
                </div>
            </div>

            {/* Nodes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-[220px] rounded-[2.5rem] bg-white/[0.02] border border-white/5 animate-pulse"></div>
                    ))
                ) : (
                    displayNodes.map((node) => (
                        <div key={node.id} className="group relative p-8 rounded-[2.5rem] bg-[var(--glass-bg)] border border-[var(--glass-border)] hover:border-primary/40 hover:bg-white/[0.05] transition-all duration-700 overflow-hidden shadow-[var(--glass-shadow)]">
                            <div className="absolute top-0 right-0 p-8 transform translate-x-4 -translate-y-4 text-white/[0.01] font-black text-8xl group-hover:text-primary/[0.03] group-hover:scale-125 transition-all duration-700">
                                {node.id.split('-')[1]}
                            </div>

                            <div className="relative z-10 space-y-6">
                                <div className="flex items-center justify-between">
                                    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.3em] border ${node.status === "online" ? "bg-primary/20 text-primary border-primary/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                        }`}>
                                        <div className="flex items-center gap-2">
                                            {node.status === "online" && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>}
                                            {node.status}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity">
                                        <MapPin size={12} className="text-primary/60" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">{node.location}</span>
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <h3 className="text-2xl font-black text-white tracking-tighter uppercase italic group-hover:text-primary transition-colors duration-500">
                                        {node.type}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <Box size={10} className="text-white/20" />
                                        <p className="text-[9px] font-black text-muted-foreground tracking-[0.2em] uppercase opacity-40">Protocol {node.id}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6 pt-6 mt-6 border-t border-white/5 relative">
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-[1px] bg-white/10 group-hover:w-12 transition-all group-hover:bg-primary/30"></div>
                                    <div>
                                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-30 mb-1">Latency</p>
                                        <p className="text-sm font-black text-white italic tracking-tighter group-hover:text-primary transition-colors">{node.latency}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-30 mb-1">Throughput</p>
                                        <p className="text-sm font-black text-white italic tracking-tighter group-hover:text-blue-400 transition-colors uppercase">{node.throughput}</p>
                                    </div>
                                    <div className="col-span-2 pt-4 mt-2 border-t border-white/5">
                                        <div className="flex justify-between items-center mb-1">
                                            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-30">Network Trust</p>
                                            <p className="text-[10px] font-black text-primary">{Math.round(node.trust || 0)}/100</p>
                                        </div>
                                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-primary/50" style={{ width: `${node.trust || 0}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Action Bar */}
            {!loading && (
                <div className="py-20 flex flex-col items-center justify-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    <div className="w-20 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
                    <button className="flex items-center gap-4 px-12 py-5 rounded-[2rem] bg-white/[0.05] border border-white/10 text-[10px] font-black uppercase tracking-[0.5em] text-white hover:bg-primary hover:text-black hover:shadow-[0_0_50px_rgba(34,197,94,0.4)] transition-all duration-500 group">
                        Access More Sectors
                        <ArrowRight size={18} className="group-hover:translate-x-2 transition-transform duration-500" />
                    </button>
                    <p className="text-[9px] font-black text-white/20 uppercase tracking-[0.3em]">Encrypted Session Enabled</p>
                </div>
            )}
        </div>
    );
}

export default function NodesPage() {
    return (
        <ProtectedRoute>
            <NodesContent />
        </ProtectedRoute>
    );
}
