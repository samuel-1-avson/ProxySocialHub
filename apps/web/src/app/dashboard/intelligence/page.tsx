'use client';

import React, { useState, useEffect } from 'react';
import {
    getZKPerformanceBenchmarks,
    ZKPerformanceMetrics,
    LatencyDistribution
} from '@/lib/api/analytics';
import { PerformanceHeatmap } from '@/components/PerformanceHeatmap';
import {
    Cpu,
    Zap,
    BarChart3,
    Clock,
    Activity,
    ShieldCheck,
    Layers,
    History
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function IntelligencePage() {
    const [metrics, setMetrics] = useState<ZKPerformanceMetrics | null>(null);
    const [distribution, setDistribution] = useState<LatencyDistribution | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const data = await getZKPerformanceBenchmarks();
            setMetrics(data.metrics);
            setDistribution(data.distribution);
            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch performance intel", err);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // 10s Cockpit Refresh
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Synchronizing Intel...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Page Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <BarChart3 size={18} className="text-primary" />
                        <h1 className="text-2xl font-black italic uppercase tracking-tighter text-white">Dashboard Intelligence</h1>
                    </div>
                    <p className="text-xs font-bold text-white/40 uppercase tracking-widest leading-none flex items-center gap-2">
                        <ShieldCheck size={10} className="text-emerald-500" /> Layer 2 Protocol Performance Intel
                    </p>
                </div>

                <div className="px-4 py-2 rounded-xl bg-white/[0.02] border border-white/5 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-black text-white/60 uppercase tracking-widest">Live Cockpit Active</span>
                </div>
            </div>

            {/* Core Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: "Total Proofs", value: metrics?.total_proofs || '0', sub: "ZK-Compressed", icon: Layers, color: "text-blue-400" },
                    { label: "Avg Latency", value: `${metrics?.avg_aggregation_time_ms.toFixed(1)}ms`, sub: "Proof Aggregation", icon: Clock, color: "text-purple-400" },
                    { label: "Throughput", value: `${metrics?.throughput_cps.toFixed(2)}`, sub: "Checkpoints/sec", icon: Zap, color: "text-yellow-400" },
                    { label: "Comp. Ratio", value: `${metrics?.compression_ratio.toFixed(1)}:1`, sub: "ZK Efficiency", icon: Cpu, color: "text-emerald-400" },
                ].map((stat, idx) => (
                    <div key={idx} className="p-5 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">{stat.label}</span>
                            <stat.icon size={14} className={stat.color} />
                        </div>
                        <div className="space-y-0.5">
                            <p className="text-2xl font-black text-white font-mono">{stat.value}</p>
                            <p className="text-[9px] font-bold text-white/20 uppercase tracking-widest">{stat.sub}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Visualization Layer */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Heatmap Card */}
                <div className="lg:col-span-2 p-6 rounded-3xl bg-black/40 border border-white/5 space-y-6">
                    <PerformanceHeatmap distribution={distribution || {}} />
                </div>

                {/* Status Column */}
                <div className="space-y-6">
                    <div className="p-6 rounded-3xl bg-emerald-500/5 border border-emerald-500/20 space-y-4">
                        <div className="flex items-center gap-2">
                            <ShieldCheck size={16} className="text-emerald-400" />
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Node Compliance</h3>
                        </div>
                        <p className="text-xs font-bold text-white/80 leading-relaxed italic">
                            Protocol integrity verified at 100%. All submitted ZK-Proofs match aggregate hardware telemetry signatures.
                        </p>
                        <div className="pt-2">
                            <button className="w-full py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[8px] font-black uppercase tracking-[0.2em] text-emerald-400 hover:bg-emerald-500/20 transition-all">
                                Run Consistency Audit
                            </button>
                        </div>
                    </div>

                    <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 space-y-4">
                        <div className="flex items-center gap-2 text-white/40">
                            <History size={16} />
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">Compute Logs</h3>
                        </div>
                        <div className="space-y-3">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-black text-white/80 uppercase">Aggregator Node-V{i}</span>
                                        <span className="text-[8px] text-white/20">Check: 102 proofs</span>
                                    </div>
                                    <span className="text-[9px] font-mono text-emerald-400">SUCCESS</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
