'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface PerformanceHeatmapProps {
    distribution: Record<string, number>;
}

export function PerformanceHeatmap({ distribution }: PerformanceHeatmapProps) {
    // Industrial Heatmap logic
    const tiers = Object.keys(distribution).filter(key => Number.isFinite(distribution[key]) && distribution[key] >= 0);
    const maxVal = Math.max(...tiers.map(key => distribution[key]), 1);
    const samples = tiers.reduce((sum, key) => sum + distribution[key], 0);

    const getHeatColor = (count: number) => {
        const intensity = (count / maxVal) * 100;
        if (intensity > 80) return 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]';
        if (intensity > 50) return 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]';
        if (intensity > 20) return 'bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.2)]';
        return 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.1)]';
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Latency Distribution</h3>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <span className="text-[8px] font-bold text-white/30 uppercase">Optimal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500"></div>
                        <span className="text-[8px] font-bold text-white/30 uppercase">Spikes</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-5 gap-2">
                {tiers.map((tier) => (
                    <div key={tier} className="space-y-2">
                        <div className="relative h-32 w-full bg-white/[0.02] rounded-lg border border-white/5 overflow-hidden flex flex-col justify-end p-1">
                            <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: `${(distribution[tier] / maxVal) * 100}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={`w-full rounded-md transition-colors ${getHeatColor(distribution[tier])}`}
                            />
                        </div>
                        <div className="text-center">
                            <p className="text-[8px] font-black text-white/60 font-mono">{tier}</p>
                            <p className="text-[10px] font-bold text-white">{distribution[tier]} <span className="text-[8px] text-white/20">sig</span></p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Scale Info */}
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-[8px] font-black text-white/20 uppercase tracking-widest leading-none">Reported samples</span>
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tighter">{samples.toLocaleString()}</span>
                </div>
                <div className="h-4 w-px bg-white/10"></div>
                <div className="flex flex-col text-right">
                    <span className="text-[8px] font-black text-white/20 uppercase tracking-widest leading-none">Sample Set</span>
                    <span className="text-[10px] font-bold text-white font-mono uppercase tracking-tighter">Source time not reported</span>
                </div>
            </div>
        </div>
    );
}
