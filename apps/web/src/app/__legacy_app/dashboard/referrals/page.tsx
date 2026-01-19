'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
    Users,
    Gift,
    Copy,
    RefreshCw,
    DollarSign,
    CheckCircle,
    Clock,
    Share2
} from 'lucide-react';
import {
    getReferralStats,
    generateReferralCode,
    getMyRewards,
    ReferralStats,
    ReferralReward
} from '@/lib/api';

export default function ReferralsPage() {
    const [stats, setStats] = useState<ReferralStats | null>(null);
    const [rewards, setRewards] = useState<ReferralReward[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [statsData, rewardsData] = await Promise.all([
                getReferralStats(),
                getMyRewards()
            ]);
            setStats(statsData);
            setRewards(rewardsData.rewards || []);
        } catch (error) {
            console.error('Failed to fetch referral data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateCode = async () => {
        setGenerating(true);
        try {
            await generateReferralCode();
            await fetchData();
        } catch (error) {
            console.error('Failed to generate code:', error);
        } finally {
            setGenerating(false);
        }
    };

    const copyToClipboard = () => {
        if (stats?.referral_code) {
            navigator.clipboard.writeText(stats.referral_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Referral Program</h1>
                    <p className="text-white/60 mt-1">Invite friends and earn rewards for every active user.</p>
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Column: Stats & Code */}
                <div className="lg:col-span-1 space-y-6">

                    {/* Code Card */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl relative overflow-hidden group"
                    >
                        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <Share2 className="w-5 h-5 text-primary-400" />
                            Your Referral Code
                        </h3>

                        {stats?.referral_code ? (
                            <div className="space-y-4">
                                <div className="relative">
                                    <div className="bg-black/40 border border-white/10 rounded-xl p-4 text-center">
                                        <span className="text-2xl font-mono font-bold text-primary-400 tracking-wider">
                                            {stats.referral_code}
                                        </span>
                                    </div>
                                    <button
                                        onClick={copyToClipboard}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded-lg transition-colors"
                                    >
                                        {copied ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5 text-white/60" />}
                                    </button>
                                </div>
                                <p className="text-sm text-white/40 text-center">
                                    Share this code with new users during signup.
                                </p>
                            </div>
                        ) : (
                            <div className="text-center py-6">
                                <p className="text-white/60 mb-4">You haven&apos;t generated a code yet.</p>
                                <button
                                    onClick={handleGenerateCode}
                                    disabled={generating}
                                    className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg font-medium transition-all flex items-center gap-2 mx-auto disabled:opacity-50"
                                >
                                    {generating ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Users className="w-4 h-4" />
                                    )}
                                    Generate Code
                                </button>
                            </div>
                        )}
                    </motion.div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-2 gap-4">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.1 }}
                            className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center"
                        >
                            <Users className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                            <div className="text-2xl font-bold text-white">{stats?.total_referrals || 0}</div>
                            <div className="text-xs text-white/40 uppercase tracking-wider mt-1">Referrals</div>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 }}
                            className="p-4 rounded-2xl bg-white/5 border border-white/10 text-center"
                        >
                            <DollarSign className="w-6 h-6 text-green-400 mx-auto mb-2" />
                            <div className="text-2xl font-bold text-white">GHS {stats?.total_earnings?.toFixed(2) || '0.00'}</div>
                            <div className="text-xs text-white/40 uppercase tracking-wider mt-1">Earned</div>
                        </motion.div>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                        className="p-4 rounded-2xl bg-white/5 border border-white/10 flex justify-between items-center"
                    >
                        <div>
                            <div className="text-sm text-white/60">Pending Rewards</div>
                            <div className="text-xl font-bold text-white">GHS {stats?.pending_rewards?.toFixed(2) || '0.00'}</div>
                        </div>
                        <Clock className="w-8 h-8 text-orange-400/50" />
                    </motion.div>
                </div>

                {/* Right Column: Rewards List */}
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-2 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl"
                >
                    <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                        <Gift className="w-5 h-5 text-purple-400" />
                        Recent Rewards
                    </h3>

                    <div className="space-y-4">
                        {rewards.length === 0 ? (
                            <div className="text-center py-12 border-2 border-dashed border-white/5 rounded-xl">
                                <Users className="w-12 h-12 text-white/10 mx-auto mb-4" />
                                <h4 className="text-lg font-medium text-white/60">No rewards yet</h4>
                                <p className="text-sm text-white/40 mt-1">Start inviting friends to earn!</p>
                            </div>
                        ) : (
                            rewards.map((reward) => (
                                <div
                                    key={reward.id}
                                    className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`p-2 rounded-full ${reward.status === 'credited' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'
                                            }`}>
                                            {reward.status === 'credited' ? <CheckCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                                        </div>
                                        <div>
                                            <div className="text-white font-medium">
                                                {reward.reward_type === 'signup' ? 'New User Signup' : 'Commission'}
                                            </div>
                                            <div className="text-sm text-white/40">
                                                {new Date(reward.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-green-400 font-bold">
                                            + GHS {reward.reward_amount.toFixed(2)}
                                        </div>
                                        <div className="text-xs text-white/40 capitalize">
                                            {reward.status}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
