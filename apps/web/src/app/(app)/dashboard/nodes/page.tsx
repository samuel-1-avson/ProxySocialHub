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
    Search
} from "lucide-react";
import Link from "next/link";

function NodesContent() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Simulate node discovery
        const timer = setTimeout(() => setLoading(false), 800);
        return () => clearTimeout(timer);
    }, []);

    const nodes = [
        { id: "node-01", location: "Accra Central", type: "Residential", status: "online", latency: "12ms", throughput: "1.2Gbps", uptime: "99.9%" },
        { id: "node-02", location: "Kumasi CBD", type: "Mobile", status: "online", latency: "45ms", throughput: "450Mbps", uptime: "98.5%" },
        { id: "node-03", location: "Takoradi Port", type: "Datacenter", status: "maintenance", latency: "8ms", throughput: "10Gbps", uptime: "99.9%" },
        { id: "node-04", location: "Tamale North", type: "Residential", status: "online", latency: "24ms", throughput: "800Mbps", uptime: "97.2%" },
        { id: "node-05", location: "Tema Industrial", type: "Datacenter", status: "online", latency: "9ms", throughput: "5Gbps", uptime: "99.9%" },
        { id: "node-06", location: "Ho Node", type: "Mobile", status: "online", latency: "38ms", throughput: "300Mbps", uptime: "99.1%" },
    ];

    return (
        <div className="max-w-7xl mx-auto space-y-10 pb-20 relative">
            {/* Decorative Elements */}
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute top-1/2 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-primary font-black text-[10px] uppercase tracking-[0.2em] mb-2">
                        <Zap size={14} />
                        Global Infrastructure
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-white tracking-tighter">Node Network</h1>
                    <p className="text-muted-foreground max-w-lg">Monitor the distributed proxy infrastructure and network-wide node availability mapping.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/[0.03] border border-white/5 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        142 Nodes Syncing
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
                    <div key={i} className="p-6 rounded-3xl bg-white/[0.03] backdrop-blur-3xl border border-white/5 space-y-4 hover:border-white/10 transition-all">
                        <div className={`p-2.5 rounded-xl bg-white/5 w-fit ${stat.color}`}>
                            <stat.icon size={18} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-50 mb-1">{stat.label}</p>
                            <p className="text-2xl font-black text-white tracking-tighter">{stat.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search & Filters */}
            <div className="p-4 rounded-[2rem] bg-white/[0.03] backdrop-blur-3xl border border-white/5 flex flex-col md:flex-row items-center gap-4">
                <div className="flex-1 relative w-full group">
                    <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="Search by Node ID, Location or Protocol..."
                        className="w-full bg-black/20 border border-white/5 rounded-2xl py-4 pl-14 pr-6 text-sm font-bold text-white outline-none focus:border-primary/50 transition-all"
                    />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <select className="bg-black/20 border border-white/5 rounded-2xl py-4 px-6 text-sm font-bold text-white outline-none appearance-none cursor-pointer flex-1 md:w-48">
                        <option>All Architectures</option>
                        <option>Residential</option>
                        <option>Mobile</option>
                        <option>Datacenter</option>
                    </select>
                    <button className="p-4 rounded-2xl bg-primary text-black hover:scale-105 active:scale-95 transition-all">
                        <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            {/* Nodes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-[200px] rounded-[2.5rem] bg-white/[0.02] border border-white/5 animate-pulse"></div>
                    ))
                ) : (
                    nodes.map((node) => (
                        <div key={node.id} className="group relative p-8 rounded-[2.5rem] bg-white/[0.03] border border-white/5 hover:border-primary/40 hover:bg-white/[0.05] transition-all duration-500 overflow-hidden">
                            <div className="absolute top-0 right-0 p-8 transform translate-x-4 -translate-y-4 text-white/[0.02] font-black text-6xl group-hover:scale-110 transition-transform">
                                {node.id.split('-')[1]}
                            </div>

                            <div className="relative z-10 space-y-6">
                                <div className="flex items-center justify-between">
                                    <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border ${node.status === "online" ? "bg-primary/20 text-primary border-primary/20" : "bg-red-500/10 text-red-500 border-red-500/20"
                                        }`}>
                                        {node.status}
                                    </div>
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <MapPin size={12} />
                                        <span className="text-[10px] font-black uppercase tracking-widest">{node.location}</span>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <h3 className="text-xl font-black text-white tracking-tighter uppercase group-hover:text-primary transition-colors">
                                        {node.type} Protocol
                                    </h3>
                                    <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase opacity-40">NID: {node.id}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4 pt-6 mt-6 border-t border-white/5">
                                    <div>
                                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-30 mb-1">Latency</p>
                                        <p className="text-sm font-black text-white italic">{node.latency}</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest opacity-30 mb-1">Throughput</p>
                                        <p className="text-sm font-black text-white italic">{node.throughput}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Empty State / More Loader */}
            {!loading && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4">
                    <button className="flex items-center gap-3 px-10 py-4 rounded-2xl bg-white/[0.05] border border-white/10 text-[10px] font-black uppercase tracking-[0.3em] text-white hover:bg-white/[0.1] transition-all group">
                        Decrypt More Sectors
                        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
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
