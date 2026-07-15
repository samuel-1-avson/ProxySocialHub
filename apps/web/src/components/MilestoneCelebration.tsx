'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Zap, Crown, Footprints, Hammer, X, Gift, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Milestone {
    id: string;
    type: string;
    threshold_gb: number;
    badge_name: string;
    reward_amount: number;
    provider_name?: string;
}

interface MilestoneCelebrationProps {
    milestone: Milestone | null;
    onClose: () => void;
    onClaim?: () => void;
    onShare?: () => void;
}

const milestoneIcons: Record<string, React.ReactNode> = {
    'first_gb': <Footprints className="w-12 h-12 text-emerald-400" />,
    'ten_gb': <Zap className="w-12 h-12 text-yellow-400" />,
    'hundred_gb': <Trophy className="w-12 h-12 text-orange-400" />,
    'five_hundred_gb': <Hammer className="w-12 h-12 text-purple-400" />,
    'tb_club': <Crown className="w-12 h-12 text-amber-400" />,
};

const milestoneMessages: Record<string, string> = {
    'first_gb': "You've taken your first steps!",
    'ten_gb': "You're becoming a power user!",
    'hundred_gb': "You're a bandwidth champion!",
    'five_hundred_gb': "You're a heavy hitter!",
    'tb_club': "Welcome to the 1TB Club!",
};

export function MilestoneCelebration({ milestone, onClose, onClaim, onShare }: MilestoneCelebrationProps) {
    const [showConfetti, setShowConfetti] = useState(true);

    useEffect(() => {
        if (milestone) {
            setShowConfetti(true);
            const timer = setTimeout(() => setShowConfetti(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [milestone]);

    if (!milestone) return null;

    const Icon = milestoneIcons[milestone.type] || <Trophy className="w-12 h-12 text-emerald-400" />;
    const message = milestoneMessages[milestone.type] || "Milestone achieved!";
    const hasReward = milestone.reward_amount > 0;

    return (
        <AnimatePresence>
            {milestone && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
                    onClick={onClose}
                >
                    {/* Confetti Effect */}
                    {showConfetti && (
                        <div className="absolute inset-0 overflow-hidden pointer-events-none">
                            {[...Array(20)].map((_, i) => (
                                <motion.div
                                    key={i}
                                    className="absolute w-2 h-2 rounded-full"
                                    style={{
                                        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6'][i % 5],
                                        left: `${Math.random() * 100}%`,
                                        top: -10,
                                    }}
                                    animate={{
                                        y: window.innerHeight + 20,
                                        x: (Math.random() - 0.5) * 200,
                                        rotate: Math.random() * 360,
                                    }}
                                    transition={{
                                        duration: 2 + Math.random() * 2,
                                        ease: "easeOut",
                                    }}
                                />
                            ))}
                        </div>
                    )}

                    {/* Main Card */}
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0, y: 50 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.5, opacity: 0, y: 50 }}
                        transition={{ type: "spring", damping: 15 }}
                        className="relative bg-gradient-to-br from-black via-black to-emerald-950/30 border border-emerald-500/30 rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors"
                        >
                            <X className="w-5 h-5 text-white/50" />
                        </button>

                        {/* Icon */}
                        <motion.div
                            initial={{ scale: 0, rotate: -180 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ delay: 0.2, type: "spring" }}
                            className="w-24 h-24 mx-auto mb-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center"
                        >
                            {Icon}
                        </motion.div>

                        {/* Title */}
                        <motion.h2
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                            className="text-2xl font-black text-white text-center mb-2"
                        >
                            🎉 {milestone.threshold_gb}GB Milestone!
                        </motion.h2>

                        {/* Message */}
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.4 }}
                            className="text-white/60 text-center mb-6"
                        >
                            {message}
                        </motion.p>

                        {/* Badge Earned */}
                        {milestone.badge_name && (
                            <motion.div
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.5 }}
                                className="flex items-center gap-3 bg-white/5 rounded-xl p-4 mb-4"
                            >
                                <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                                    <Trophy className="w-5 h-5 text-yellow-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-white/40 uppercase tracking-wider">Badge Earned</p>
                                    <p className="text-white font-bold">{milestone.badge_name}</p>
                                </div>
                            </motion.div>
                        )}

                        {/* Reward */}
                        {hasReward && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.6 }}
                                className="flex items-center gap-3 bg-emerald-500/10 rounded-xl p-4 mb-6 border border-emerald-500/20"
                            >
                                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                                    <Gift className="w-5 h-5 text-emerald-400" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs text-emerald-400/60 uppercase tracking-wider">Reward</p>
                                    <p className="text-emerald-400 font-black text-lg">{milestone.reward_amount.toFixed(6)} SOL Credit</p>
                                </div>
                            </motion.div>
                        )}

                        {/* Provider */}
                        {milestone.provider_name && (
                            <p className="text-sm text-white/40 text-center mb-6">
                                with @{milestone.provider_name}
                            </p>
                        )}

                        {/* Actions */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.7 }}
                            className="flex gap-3"
                        >
                            {hasReward && onClaim && (
                                <Button
                                    onClick={onClaim}
                                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black font-bold"
                                >
                                    <Gift className="w-4 h-4 mr-2" />
                                    Claim Reward
                                </Button>
                            )}
                            {onShare && (
                                <Button
                                    onClick={onShare}
                                    variant="outline"
                                    className="flex-1 border-white/20 hover:bg-white/10"
                                >
                                    <Share2 className="w-4 h-4 mr-2" />
                                    Share
                                </Button>
                            )}
                        </motion.div>

                        {/* Review Prompt */}
                        {milestone.threshold_gb >= 10 && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.8 }}
                                className="mt-6 pt-6 border-t border-white/10 text-center"
                            >
                                <p className="text-sm text-white/60 mb-3">
                                    You've used this proxy for a while. How's your experience?
                                </p>
                                <Button
                                    variant="ghost"
                                    className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                    onClick={() => {
                                        onClose();
                                        // Navigate to review
                                        window.location.href = `/sessions/${milestone.id}/review`;
                                    }}
                                >
                                    Write a Review →
                                </Button>
                            </motion.div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default MilestoneCelebration;
