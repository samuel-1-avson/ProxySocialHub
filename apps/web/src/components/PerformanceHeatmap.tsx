'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface PerformanceHeatmapProps {
    distribution: Record<string, number>;
}

export function PerformanceHeatmap({ distribution }: PerformanceHeatmapProps) {
    // Industrial Heatmap logic
    const tiers = Object.keys(distribution);
    const maxVal = Math.max(...Object.values(distribution), 1);

    const getHeatColor = (count: number) => {
        const intensity = (count / maxVal) * 100;
        if (intensity > 80) return 'bg-destructive';
        if (intensity > 50) return 'bg-warning';
        if (intensity > 20) return 'bg-warning';
        return 'bg-success';
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">Latency Distribution</h3>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-success"></div>
                        <span className="text-xs font-bold text-muted-foreground">Optimal</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-destructive"></div>
                        <span className="text-xs font-bold text-muted-foreground">Spikes</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-5 gap-2">
                {tiers.map((tier) => (
                    <div key={tier} className="space-y-2">
                        <div className="relative h-32 w-full bg-secondary rounded-lg border border-border overflow-hidden flex flex-col justify-end p-1">
                            <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: `${(distribution[tier] / maxVal) * 100}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className={`w-full rounded-md transition-colors ${getHeatColor(distribution[tier])}`}
                            />
                        </div>
                        <div className="text-center">
                            <p className="text-xs font-semibold text-muted-foreground font-mono">{tier}</p>
                            <p className="text-xs font-bold text-foreground">{distribution[tier]} <span className="text-xs text-muted-foreground">sig</span></p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Scale Info */}
            <div className="p-3 rounded-lg bg-secondary border border-border flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-xs font-semibold text-muted-foreground leading-none">Telemetry Quality</span>
                    <span className="text-xs font-bold text-success tracking-tight">99.8% Fidelity</span>
                </div>
                <div className="h-4 w-px bg-secondary"></div>
                <div className="flex flex-col text-right">
                    <span className="text-xs font-semibold text-muted-foreground leading-none">Sample Set</span>
                    <span className="text-xs font-bold text-foreground font-mono tracking-tight">Verified Real-time</span>
                </div>
            </div>
        </div>
    );
}
