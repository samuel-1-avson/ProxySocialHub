'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Trophy, Zap, Crown, Footprints, Hammer, ChevronRight, Gift, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
    getMyMilestones, 
    getNextMilestone, 
    claimMilestoneReward,
    milestoneKeys,
    getMilestoneIcon,
    getMilestoneColor,
    type Milestone,
    type NextMilestone
} from '@/lib/api/milestones';
import { useNotificationStore } from '@/stores';

const milestoneIcons: Record<string, React.ReactNode> = {
    'first_steps': <Footprints className="w-5 h-5" />,
    'power_user': <Zap className="w-5 h-5" />,
    'bandwidth_champion': <Trophy className="w-5 h-5" />,
    'heavy_hitter': <Hammer className="w-5 h-5" />,
    'tb_club': <Crown className="w-5 h-5" />,
};

export function MilestoneWidget() {
    const { addNotification } = useNotificationStore();
    const queryClient = useQueryClient();

    const { data: milestones = [], isLoading: milestonesLoading } = useQuery({
        queryKey: milestoneKeys.lists(),
        queryFn: getMyMilestones,
    });

    const { data: nextMilestone, isLoading: nextLoading } = useQuery({
        queryKey: milestoneKeys.next(),
        queryFn: getNextMilestone,
    });

    const claimMutation = useMutation({
        mutationFn: claimMilestoneReward,
        onSuccess: (data) => {
            addNotification({
                type: 'success',
                title: 'Reward Claimed!',
                message: `You received ${Number(data.reward_amount || 0).toFixed(6)} SOL credit`,
            });
            queryClient.invalidateQueries({ queryKey: milestoneKeys.all });
        },
        onError: (error: Error) => {
            addNotification({
                type: 'error',
                title: 'Failed to claim',
                message: error.message,
            });
        },
    });

    const unclaimedMilestones = milestones.filter(m => !m.claimed && m.reward_amount > 0);
    const claimedMilestones = milestones.filter(m => m.claimed);
    const latestMilestone = claimedMilestones[claimedMilestones.length - 1];

    if (milestonesLoading || nextLoading) {
        return (
            <div className="glass-card border-white/5 bg-white/[0.02] rounded-3xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                    </div>
                    <div>
                        <h3 className="font-black text-sm uppercase tracking-wider text-white">Milestones</h3>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest">Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card border-white/5 bg-white/[0.02] rounded-3xl p-6 space-y-4"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-yellow-500/10 flex items-center justify-center border border-emerald-500/20">
                        <Trophy className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="font-black text-sm uppercase tracking-wider text-white">Milestones</h3>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest">
                            {claimedMilestones.length} achieved
                        </p>
                    </div>
                </div>
                
                {unclaimedMilestones.length > 0 && (
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold"
                    >
                        {unclaimedMilestones.length} reward{unclaimedMilestones.length > 1 ? 's' : ''} available!
                    </motion.div>
                )}
            </div>

            {/* Next Milestone Progress */}
            {nextMilestone && (
                <div className="bg-white/5 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{getMilestoneIcon(nextMilestone.type)}</span>
                            <div>
                                <p className="text-xs font-bold text-white">Next: {nextMilestone.badge_name}</p>
                                <p className="text-[10px] text-white/40">
                                    {Number(nextMilestone.current_gb || 0).toFixed(1)} / {nextMilestone.threshold_gb} GB
                                </p>
                            </div>
                        </div>
                        {nextMilestone.reward_amount > 0 && (
                            <div className="flex items-center gap-1 text-emerald-400">
                                <Gift className="w-3 h-3" />
                                <span className="text-xs font-bold">{Number(nextMilestone.reward_amount).toFixed(6)} SOL</span>
                            </div>
                        )}
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${nextMilestone.progress_percent}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className="h-full bg-gradient-to-r from-emerald-500 to-yellow-500"
                        />
                    </div>
                    <p className="text-[10px] text-white/40 text-right">
                        {Number(nextMilestone.progress_percent || 0).toFixed(0)}% complete
                    </p>
                </div>
            )}

            {/* Unclaimed Rewards */}
            {unclaimedMilestones.length > 0 && (
                <div className="space-y-2">
                    <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Claim Rewards</p>
                    {unclaimedMilestones.map((milestone) => (
                        <motion.div
                            key={milestone.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl"
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-500/20 ${getMilestoneColor(milestone.milestone_type)}`}>
                                    {milestoneIcons[milestone.milestone_type] || <Trophy className="w-4 h-4" />}
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-white">{milestone.badge_name}</p>
                                    <p className="text-[10px] text-white/40">{milestone.threshold_gb}GB milestone</p>
                                </div>
                            </div>
                            <button
                                onClick={() => claimMutation.mutate(milestone.id)}
                                disabled={claimMutation.isPending}
                                className="px-4 py-2 rounded-lg bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 transition-colors disabled:opacity-50"
                            >
                                {claimMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    `Claim ${Number(milestone.reward_amount).toFixed(6)} SOL`
                                )}
                            </button>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Latest Achievement */}
            {latestMilestone && (
                <div className="pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{getMilestoneIcon(latestMilestone.milestone_type)}</span>
                            <div>
                                <p className="text-[10px] text-white/40 uppercase tracking-widest">Latest Achievement</p>
                                <p className="text-xs font-bold text-white">{latestMilestone.badge_name}</p>
                            </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/20" />
                    </div>
                </div>
            )}
        </motion.div>
    );
}

export default MilestoneWidget;
