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
    Terminal,
    Search,
    MapPin,
    Box,
    ArrowRight,
    RefreshCw,
    Server,
    Globe
} from "lucide-react";
import { ProviderNode } from "@/lib/api";

function NodesContent() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [realNodes, setNodes] = useState<ProviderNode[]>([]);

    useEffect(() => {
        // Fetch Real Nodes
        const fetchNodes = async () => {
            try {
                // Dynamically import to avoid server-side issues if any
                const { getProviderNodes } = await import('@/lib/api');
                const data = await getProviderNodes();
                setNodes(data.nodes || []);
            } catch (e) {
                console.error("Failed to load nodes", e);
            } finally {
                setLoading(false);
            }
        };
        fetchNodes();
    }, []);

    // Map Real Nodes to UI format
    // Map Real Nodes to UI format
    const displayNodes = realNodes.map(n => ({
        id: `node-${n.id.substring(0, 4)}`,
        location: n.city || "Unknown",
        type: n.connection_type || "Residential",
        status: n.status === "online" ? "online" : "offline",
        latency: n.latency_ms ? `${n.latency_ms}ms` : "N/A",
        throughput: "N/A",
        uptime: n.uptime_percent ? `${n.uptime_percent}%` : "N/A",
        trust: n.quality_score
    }));

    // Calculate generic stats based on real nodes
    const activeStats = {
        connections: realNodes.reduce((acc, n) => acc + (n.active_connections || 0), 0),
        avgLatency: realNodes.length > 0 ? Math.round(realNodes.reduce((acc, n) => acc + (n.latency_ms || 0), 0) / realNodes.length) : 0,
        avgTrust: realNodes.length > 0 ? (realNodes.reduce((acc, n) => acc + n.quality_score, 0) / realNodes.length).toFixed(1) : "0.0"
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-border">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase tracking-widest animate-pulse">
                        <Signal size={14} />
                        Network Core Active
                    </div>
                    <h1 className="text-3xl font-bold font-mono uppercase tracking-tight">Node Infrastructure</h1>
                    <p className="text-muted-foreground font-mono text-xs max-w-lg">
                        SYSTEM-WIDE MONITORING OF DISTRIBUTED PROXY NODES. REAL-TIME AVAILABILITY MAPPING.
                    </p>
                </div>
            </div>

            {/* Network Overview Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: "Active Connections", value: activeStats.connections.toLocaleString(), icon: Activity },
                    { label: "Total Nodes", value: realNodes.length.toString(), icon: Zap },
                    { label: "Avg Latency", value: `${activeStats.avgLatency}ms`, icon: Cpu },
                    { label: "Avg Trust Score", value: activeStats.avgTrust, icon: Shield },
                ].map((stat, i) => (
                    <div key={i} className="card-retro p-4 bg-card group hover:border-primary transition-all">
                        <div className="flex justify-between items-start mb-2">
                            <stat.icon size={18} className="text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                        <div className="text-2xl font-bold font-mono text-foreground tracking-tight">{stat.value}</div>
                        <div className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Search & Filters */}
            <div className="card-retro p-4 bg-card flex flex-col md:flex-row items-center gap-4">
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <input
                        type="text"
                        placeholder="INTERCEPT NODE ID..."
                        className="w-full bg-secondary border border-border rounded-sm py-2 pl-9 pr-4 text-xs font-mono focus:border-primary focus:outline-none transition-colors uppercase placeholder:text-muted-foreground"
                    />
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <select className="bg-secondary border border-border rounded-sm py-2 px-3 text-xs font-mono font-bold uppercase focus:border-primary focus:outline-none cursor-pointer flex-1 md:w-48">
                        <option>Architecture: All</option>
                        <option>Residential Grid</option>
                        <option>Mobile Terminals</option>
                        <option>Vault Datacenters</option>
                    </select>
                    <button
                        onClick={() => setLoading(true)} // simplistic reload trigger
                        className="btn-retro btn-retro-primary p-2"
                    >
                        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* Nodes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-[200px] border-2 border-dashed border-border bg-secondary/10 animate-pulse rounded-sm"></div>
                    ))
                ) : displayNodes.length === 0 ? (
                    <div className="col-span-full py-20 text-center border-2 border-dashed border-border rounded-sm">
                        <Server size={32} className="mx-auto text-muted-foreground mb-4 opacity-50" />
                        <p className="font-mono text-lg font-bold uppercase">No Active Nodes</p>
                        <p className="font-mono text-xs text-muted-foreground mt-2">DEPLOY A NODE OR ADJUST FILTERS.</p>
                    </div>
                ) : (
                    displayNodes.map((node) => (
                        <div key={node.id} className="card-retro p-6 bg-card group hover:border-primary transition-all relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 text-[4rem] font-black text-muted-foreground opacity-[0.03] group-hover:opacity-[0.05] transition-opacity leading-none select-none">
                                {node.id.split('-')[1]}
                            </div>

                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-4">
                                    <div className={`px-2 py-0.5 rounded-sm border text-[10px] font-mono font-bold uppercase flex items-center gap-2 ${node.status === "online"
                                        ? "bg-green-500/10 text-green-500 border-green-500/20"
                                        : "bg-red-500/10 text-red-500 border-red-500/20"
                                        }`}>
                                        <div className={`w-1.5 h-1.5 rounded-full ${node.status === "online" ? "bg-green-500 animate-pulse" : "bg-red-500"}`}></div>
                                        {node.status}
                                    </div>
                                    <div className="flex items-center gap-1 text-muted-foreground">
                                        <MapPin size={10} />
                                        <span className="text-[10px] font-mono font-bold uppercase">{node.location}</span>
                                    </div>
                                </div>

                                <div className="mb-6">
                                    <h3 className="text-lg font-bold font-mono uppercase group-hover:text-primary transition-colors">
                                        {node.type}
                                    </h3>
                                    <div className="flex items-center gap-2 text-muted-foreground opacity-60">
                                        <Box size={12} />
                                        <p className="text-[10px] font-mono font-bold uppercase">PROTOCOL {node.id}</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-dashed border-border">
                                    <div>
                                        <p className="text-[10px] font-mono text-muted-foreground uppercase mb-0.5">Latency</p>
                                        <p className="text-sm font-bold font-mono">{node.latency}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-mono text-muted-foreground uppercase mb-0.5">Throughput</p>
                                        <p className="text-sm font-bold font-mono text-primary">{node.throughput}</p>
                                    </div>
                                </div>

                                <div className="mt-4 pt-4 border-t border-dashed border-border">
                                    <div className="flex justify-between items-center mb-1 text-[10px] font-mono font-bold uppercase">
                                        <span className="text-muted-foreground">Network Trust</span>
                                        <span className="text-foreground">{Math.round(node.trust || 0)}/100</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-secondary rounded-sm overflow-hidden border border-border">
                                        <div className="h-full bg-primary" style={{ width: `${node.trust || 0}%` }}></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Action Bar */}
            {!loading && displayNodes.length > 0 && (
                <div className="flex justify-center pt-8">
                    <button className="btn-retro btn-retro-outline px-8 py-3 flex items-center gap-2 group">
                        ACCESS MORE SECTORS
                        <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                    </button>
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
