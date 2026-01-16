'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSubscriptionPlans, getMySubscription, subscribeToPlan, cancelSubscription, SubscriptionPlan, UserSubscription } from '@/lib/api';
import Navbar from '@/components/Navbar';

export default function PricingPage() {
    const router = useRouter();
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [currentSub, setCurrentSub] = useState<UserSubscription | null>(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState('');

    useEffect(() => {
        async function loadData() {
            try {
                const [plansData, subData] = await Promise.all([
                    getSubscriptionPlans(),
                    getMySubscription()
                ]);
                setPlans(plansData);
                setCurrentSub(subData);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const handleSubscribe = async (planId: string) => {
        setProcessing(planId);
        try {
            await subscribeToPlan(planId);
            // Refresh data
            const sub = await getMySubscription();
            setCurrentSub(sub);
            alert('Successfully subscribed!');
        } catch (err: any) {
            alert(err.message || 'Failed to subscribe');
        } finally {
            setProcessing('');
        }
    };

    const handleCancel = async () => {
        if (!confirm('Are you sure you want to cancel your subscription?')) return;
        setProcessing('cancel');
        try {
            await cancelSubscription();
            const sub = await getMySubscription();
            setCurrentSub(sub);
            alert('Subscription cancelled');
        } catch (err: any) {
            alert(err.message || 'Failed to cancel');
        } finally {
            setProcessing('');
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
            <div className="max-w-7xl mx-auto px-4 py-16">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-bold mb-4">Choose Your Plan</h1>
                    <p className="text-gray-400">Unlock higher limits and exclusive features</p>
                </div>

                {currentSub && currentSub.plan.name !== 'Free' && (
                    <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-lg p-6 mb-12 flex justify-between items-center">
                        <div>
                            <h3 className="text-xl font-bold text-indigo-400">Current Plan: {currentSub.plan.name}</h3>
                            <p className="text-gray-400">Renews on {new Date(currentSub.current_period_end).toLocaleDateString()}</p>
                        </div>
                        {currentSub.status === 'active' && (
                            <button
                                onClick={handleCancel}
                                disabled={!!processing}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                {processing === 'cancel' ? 'Cancelling...' : 'Cancel Subscription'}
                            </button>
                        )}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {plans.map((plan) => {
                        const isCurrent = currentSub?.plan_id === plan.id;
                        return (
                            <div
                                key={plan.id}
                                className={`bg-gray-800 rounded-xl p-8 border ${isCurrent ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-gray-700 hover:border-gray-600'
                                    } transition-all`}
                            >
                                <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                                <div className="mb-6">
                                    <span className="text-3xl font-bold">${plan.price_monthly}</span>
                                    <span className="text-gray-400">/mo</span>
                                </div>

                                <ul className="space-y-4 mb-8">
                                    <li className="flex items-center text-sm text-gray-300">
                                        <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                        {plan.listing_limit === 999999 ? 'Unlimited' : plan.listing_limit} Listings
                                    </li>
                                    <li className="flex items-center text-sm text-gray-300">
                                        <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                        {plan.bandwidth_limit_gb === 999999 ? 'Unlimited' : plan.bandwidth_limit_gb + ' GB'} Bandwidth
                                    </li>
                                    {plan.features.map((feature, i) => (
                                        <li key={i} className="flex items-center text-sm text-gray-300">
                                            <svg className="w-5 h-5 text-green-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                            </svg>
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <button
                                    onClick={() => handleSubscribe(plan.id)}
                                    disabled={isCurrent || !!processing}
                                    className={`w-full py-3 px-4 rounded-lg font-bold text-sm transition-colors ${isCurrent
                                            ? 'bg-gray-700 text-gray-400 cursor-default'
                                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                        } disabled:opacity-50`}
                                >
                                    {isCurrent
                                        ? 'Current Plan'
                                        : processing === plan.id
                                            ? 'Processing...'
                                            : plan.price_monthly === 0
                                                ? 'Get Started'
                                                : 'Subscribe Now'
                                    }
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
