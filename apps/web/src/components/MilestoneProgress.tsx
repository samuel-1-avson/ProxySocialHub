'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Zap, Crown, Footprints, Hammer, ChevronRight } from 'lucide-react';

interface MilestoneProgressProps {
    className?: string;
}

interface NextMilestone {
    current_usage_gb: number;
    next_milestone: {
        type: string;
        threshold_gb: number;
        reward_amount: number;
        badge_name: string;
    } | null;
    progress_percent: number;
    remaining_gb: number;
}

const milestoneIcons: Record<string, React.ReactNode> = {
    'first_gb': <Footprints className="w-4 h-4" />,
    'ten_gb': <Zap className="w-4 h-4" />,
    'hundred_gb': <Trophy className="w-4 h-4" />,
    'five_hundred_gb': <Hammer className="w-4 h-4" />,
    'tb_club': <Crown className="w-4 h-4" />,
};

const milestoneNames: Record<string, string> = {
    'first_gb': 'First Steps',
    'ten_gb': 'Power User',
    'hundred_gb': 'Champion',
    'five_hundred_gb': 'Heavy Hitter',
    'tb_club': '1TB Club',
};

export function MilestoneProgress({ className }: MilestoneProgressProps) {
    const [data, setData] = useState<NextMilestone | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchNextMilestone = async () => {
            try {
                const token = localStorage.getItem('token');
                const response = await fetch('/api/v1/milestones/next', {
                    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                });

                if (response.ok) {
                    const result = await response.json();
                    setData(result);
                }
            } catch (error) {
                console.error('Failed to fetch milestone:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchNextMilestone();
        // Refresh every 5 minutes
        const interval = setInterval(fetchNextMilestone, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className={`bg-white/5 rounded-2xl p-4 border border-white/10 ${className}`}>
                <div className="animate-pulse space-y-3">
                    <div className="h-4 bg-white/10 rounded w-1/2" />
                    <div className="h-8 bg-white/10 rounded" />
                    <div className="h-2 bg-white/10 rounded" />
                </div>
            </div>
        );
    }

    if (!data || !data.next_milestone) {
        // All milestones achieved!
        return (
            <div className={`bg-gradient-to-br from-emerald-500/10 to-yellow-500/10 rounded-2xl p-4 border border-emerald-500/30 ${className}`}>
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                        <Crown className="w-6 h-6 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-white font-bold">Elite Status!</h3>
                        <p className="text-sm text-white/60">You've achieved all milestones</p>
                    </div>
                </div>
                <div className="mt-3 text-2xl font-black text-emerald-400">
                    {data?.current_usage_gb.toFixed(0)}GB+
                </div>
                <p className="text-xs text-white/40">Total bandwidth used</p>
            </div>
        );
    }

    const { next_milestone, progress_percent, remaining_gb, current_usage_gb } = data;
    const Icon = milestoneIcons[next_milestone.type] || <Trophy className="w-4 h-4" />;
    const name = milestoneNames[next_milestone.type] || next_milestone.type;

    return (
        <div className={`bg-white/5 rounded-2xl p-4 border border-white/10 ${className}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                        {Icon}
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-sm">Next: {name}</h3>
                        <p className="text-xs text-white/40">{next_milestone.threshold_gb}GB milestone</p>
                    </div>
                </div>
                {next_milestone.reward_amount > 0 && (
                    <div className="text-right">
                        <p className="text-xs text-emerald-400/60">Reward</p>
                        <p className="text-emerald-400 font-bold">${next_milestone.reward_amount}</p>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            <div className="relative mb-2">
                <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progress_percent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full"
                    />
                </div>
                <div className="flex justify-between text-xs mt-1">
                    <span className="text-white/40">{current_usage_gb.toFixed(1)}GB</span>
                    <span className="text-white/40">{next_milestone.threshold_gb}GB</span>
                </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                <p className="text-sm text-white/60">
                    {remaining_gb > 0 ? (
                        <>
                            <span className="text-white font-bold">{remaining_gb.toFixed(1)}GB</span> to go
                        </>
                    ) : (
                        <span className="text-emerald-400">Milestone achieved!</span>
                    )}
                </p>
                <button className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                    View all <ChevronRight className="w-3 h-3" />
                </button>
            </div>

            {/* Badge Preview */}
            {next_milestone.badge_name && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                    <Trophy className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-yellow-400/80">Earn badge:</span>
                    <span className="text-xs text-yellow-400 font-bold">{next_milestone.badge_name}</span>
                </div>
            )}
        </div>
    );
}

export default MilestoneProgress;
