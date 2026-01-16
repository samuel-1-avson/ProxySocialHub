'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { getReferralStats, generateReferralCode, ReferralStats } from '@/lib/api';

export default function ReferralsPage() {
    const [stats, setStats] = useState<ReferralStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);

    useEffect(() => {
        loadStats();
    }, []);

    async function loadStats() {
        try {
            const data = await getReferralStats();
            setStats(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    const handleGenerateCode = async () => {
        setGenerating(true);
        try {
            await generateReferralCode();
            await loadStats();
        } catch (err: any) {
            alert(err.message || 'Failed to generate code');
        } finally {
            setGenerating(false);
        }
    };

    const copyToClipboard = () => {
        if (stats?.referral_code) {
            const link = `${window.location.origin}/register?ref=${stats.referral_code}`;
            navigator.clipboard.writeText(link);
            alert('Referral link copied to clipboard!');
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 text-white">
                <Navbar />
                <div className="flex justify-center items-center h-[calc(100vh-64px)]">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white">
            <Navbar />
            <div className="max-w-7xl mx-auto px-4 py-8">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
                        Referral Program
                    </h1>
                    <p className="text-gray-400 text-xl">Invite friends and earn GHS 5 for every signup + GHS 10 on their first purchase!</p>
                </div>

                {!stats?.referral_code ? (
                    <div className="max-w-md mx-auto bg-gray-800 rounded-xl p-8 text-center border border-gray-700">
                        <h3 className="text-xl font-bold mb-4">Start Earning Today</h3>
                        <p className="text-gray-400 mb-6">Generate your unique referral code to get started.</p>
                        <button
                            onClick={handleGenerateCode}
                            disabled={generating}
                            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold transition-colors disabled:opacity-50 w-full"
                        >
                            {generating ? 'Generating...' : 'Generate My Referral Code'}
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700">
                            <h3 className="text-xl font-bold mb-6">Your Stats</h3>
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <p className="text-gray-400 text-sm mb-1">Total Earnings</p>
                                    <p className="text-3xl font-bold text-green-400">GHS {stats.total_earnings}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm mb-1">Referrals</p>
                                    <p className="text-3xl font-bold text-indigo-400">{stats.total_referrals}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm mb-1">Pending</p>
                                    <p className="text-xl font-bold text-yellow-400">GHS {stats.pending_rewards}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm mb-1">Credited</p>
                                    <p className="text-xl font-bold text-blue-400">GHS {stats.credited_rewards}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 flex flex-col justify-center">
                            <h3 className="text-xl font-bold mb-4">Share Your Link</h3>
                            <div className="bg-gray-900 rounded-lg p-4 mb-4 flex items-center justify-between border border-gray-800">
                                <code className="text-indigo-400 font-mono text-lg">{stats.referral_code}</code>
                                <button
                                    onClick={copyToClipboard}
                                    className="text-gray-400 hover:text-white transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                    </svg>
                                </button>
                            </div>
                            <button
                                onClick={copyToClipboard}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-bold transition-colors"
                            >
                                Copy Referral Link
                            </button>
                            <p className="text-gray-500 text-xs mt-4 text-center">
                                Share this link with friends. Earnings are credited to your wallet immediately upon qualification.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
