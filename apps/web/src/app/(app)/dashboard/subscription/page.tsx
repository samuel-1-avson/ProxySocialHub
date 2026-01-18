'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Shield, Zap, Globe, CreditCard, ChevronRight } from 'lucide-react';
import {
    getSubscriptionPlans,
    getMySubscription,
    subscribeToPlan,
    cancelSubscription,
    SubscriptionPlan,
    UserSubscription
} from '@/lib/api';
import { useRouter } from 'next/navigation';

export default function SubscriptionPage() {
    const router = useRouter();
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState<string | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            const [plansData, subData] = await Promise.all([
                getSubscriptionPlans(),
                getMySubscription()
            ]);
            setPlans(plansData);
            setCurrentSub(subData);
        } catch (error) {
            console.error('Failed to fetch subscription data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubscribe = async (planId: string) => {
        setProcessing(planId);
        try {
            await subscribeToPlan(planId);
            await fetchData();
            // Show success toast or feedback here
        } catch (error: any) {
            alert(error.message || 'Failed to subscribe'); // Replace with robust toast
        } finally {
            setProcessing(null);
        }
    };

    const handleCancel = async () => {
        if (!confirm('Are you sure you want to cancel? You will keep access until the end of the period.')) return;
        setProcessing('cancel');
        try {
            await cancelSubscription();
            await fetchData();
        } catch (error) {
            console.error('Failed to cancel:', error);
        } finally {
            setProcessing(null);
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
            <div className="text-center max-w-2xl mx-auto mb-12">
                <h1 className="text-4xl font-bold text-white tracking-tight mb-4">
                    Upgrade your Experience
                </h1>
                <p className="text-white/60 text-lg">
                    Unlock premium features, higher limits, and priority support with our specialized plans.
                </p>
            </div>

            {currentSub && currentSub.status === 'active' && (
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-12 p-6 rounded-2xl bg-gradient-to-r from-primary-900/40 to-primary-600/10 border border-primary-500/30 flex flex-col md:flex-row items-center justify-between gap-4"
                >
                    <div>
                        <div className="text-primary-400 font-bold tracking-wider text-xs uppercase mb-1">Current Plan</div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            {currentSub.plan.name}
                            <span className="px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300 text-xs font-medium">Active</span>
                        </h2>
                        <p className="text-white/60 text-sm mt-1">
                            Renews on {new Date(currentSub.current_period_end).toLocaleDateString()}
                        </p>
                    </div>
                    <button
                        onClick={handleCancel}
                        disabled={!!processing}
                        className="px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/10 text-white/60 hover:text-red-400 border border-white/10 hover:border-red-500/30 transition-all font-medium text-sm"
                    >
                        {processing === 'cancel' ? 'Cancelling...' : 'Cancel Subscription'}
                    </button>
                </motion.div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {plans.map((plan, idx) => {
                    const isCurrent = currentSub?.plan_id === plan.id && currentSub?.status === 'active';

                    return (
                        <motion.div
                            key={plan.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.1 }}
                            className={`relative p-8 rounded-3xl border flex flex-col ${isCurrent
                                    ? 'bg-primary-900/20 border-primary-500/50 ring-1 ring-primary-500/50'
                                    : 'bg-white/5 border-white/10 hover:border-white/20'
                                } backdrop-blur-xl transition-all group`}
                        >
                            {isCurrent && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary-500 text-white text-xs font-bold rounded-full shadow-lg shadow-primary-500/20">
                                    CURRENT PLAN
                                </div>
                            )}

                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-3xl font-bold text-white">GHS {plan.price_monthly}</span>
                                    <span className="text-white/40">/month</span>
                                </div>
                            </div>

                            <ul className="space-y-4 mb-8 flex-1">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className="flex items-start gap-3 text-sm text-white/80">
                                        <Check className="w-5 h-5 text-green-400 shrink-0" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                                <li className="flex items-start gap-3 text-sm text-white/80">
                                    <Shield className="w-5 h-5 text-blue-400 shrink-0" />
                                    <span>{plan.listing_limit === 0 ? 'Unlimited' : plan.listing_limit} Marketplace Listings</span>
                                </li>
                                <li className="flex items-start gap-3 text-sm text-white/80">
                                    <Zap className="w-5 h-5 text-yellow-400 shrink-0" />
                                    <span>{plan.bandwidth_limit_gb} GB Bandwidth Limit</span>
                                </li>
                            </ul>

                            <button
                                onClick={() => handleSubscribe(plan.id)}
                                disabled={isCurrent || !!processing}
                                className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${isCurrent
                                        ? 'bg-white/10 text-white/40 cursor-default'
                                        : 'bg-white text-black hover:bg-gray-100 shadow-lg hover:shadow-xl hover:scale-[1.02]'
                                    }`}
                            >
                                {isCurrent ? (
                                    <>
                                        <Check className="w-4 h-4" /> Active
                                    </>
                                ) : processing === plan.id ? (
                                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                ) : (
                                    <>
                                        Upgrade Now <ChevronRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </motion.div>
                    );
                })}
            </div>

            <div className="mt-16 text-center">
                <p className="text-white/40 text-sm">
                    Payments are processed securely via your Wallet balance.
                    Make sure to <a href="/dashboard/wallet" className="text-primary-400 hover:underline">top up your wallet</a> before upgrading.
                </p>
            </div>
        </div>
    );
}
