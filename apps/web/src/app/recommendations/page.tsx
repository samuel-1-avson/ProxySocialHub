'use client';

import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { getUseCases, getPreferences, updatePreferences, getRecommendations, UseCase, UserPreferences, Recommendation } from '@/lib/api';
import { Star } from 'lucide-react';

export default function RecommendationsPage() {
    const [useCases, setUseCases] = useState<UseCase[]>([]);
    const [prefs, setPrefs] = useState<UserPreferences | null>(null);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [ucData, prefsData] = await Promise.all([
                getUseCases(),
                getPreferences()
            ]);
            setUseCases(ucData);
            setPrefs(prefsData);

            // Load initial recommendations if prefs exist
            const recData = await getRecommendations(prefsData?.preferred_use_case_id);
            setRecommendations(recData.recommendations);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    const handleUseCaseChange = async (useCaseId: string) => {
        setUpdating(true);
        try {
            await updatePreferences({ preferred_use_case_id: useCaseId });
            const recData = await getRecommendations(useCaseId);
            setRecommendations(recData.recommendations);
            setPrefs({ ...prefs!, preferred_use_case_id: useCaseId });
        } catch (err) {
            console.error(err);
        } finally {
            setUpdating(false);
        }
    };

    const handlePreferencesUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setUpdating(true);
        try {
            if (prefs) {
                await updatePreferences(prefs);
                const recData = await getRecommendations(prefs.preferred_use_case_id);
                setRecommendations(recData.recommendations);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setUpdating(false);
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
                <div className="mb-8">
                    <h1 className="text-3xl font-bold mb-2">AI Smart Matching</h1>
                    <p className="text-gray-400">Get personalized proxy recommendations based on your use case.</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Sidebar - Preferences */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                            <h3 className="font-bold mb-4 text-indigo-400">Your Use Case</h3>
                            <select
                                value={prefs?.preferred_use_case_id || ''}
                                onChange={(e) => handleUseCaseChange(e.target.value)}
                                disabled={updating}
                                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                            >
                                <option value="">Select a use case...</option>
                                {useCases.map((uc) => (
                                    <option key={uc.id} value={uc.id}>{uc.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                            <h3 className="font-bold mb-4 text-indigo-400">Filters</h3>
                            <form onSubmit={handlePreferencesUpdate} className="space-y-4">
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Max Price / GB ($)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={prefs?.max_price_per_gb || ''}
                                        onChange={(e) => setPrefs({ ...prefs!, max_price_per_gb: parseFloat(e.target.value) })}
                                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Min Seller Rating</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        max="5"
                                        value={prefs?.min_seller_rating || ''}
                                        onChange={(e) => setPrefs({ ...prefs!, min_seller_rating: parseFloat(e.target.value) })}
                                        className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-sm"
                                    />
                                </div>

                                <div className="flex items-center">
                                    <input
                                        type="checkbox"
                                        id="verified"
                                        checked={prefs?.prefer_verified_sellers || false}
                                        onChange={(e) => setPrefs({ ...prefs!, prefer_verified_sellers: e.target.checked })}
                                        className="rounded bg-gray-900 border-gray-600 text-indigo-600"
                                    />
                                    <label htmlFor="verified" className="ml-2 text-sm text-gray-300">Verified Sellers Only</label>
                                </div>

                                <button
                                    type="submit"
                                    disabled={updating}
                                    className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
                                >
                                    {updating ? 'Updating...' : 'Apply Filters'}
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* Results */}
                    <div className="lg:col-span-3">
                        <h2 className="text-xl font-bold mb-6 flex items-center">
                            Top Recommendations
                            <span className="ml-3 px-2 py-1 bg-green-900/50 text-green-400 text-xs rounded-full border border-green-700/50">
                                {recommendations.length} Matches Found
                            </span>
                        </h2>

                        <div className="space-y-4">
                            {recommendations.length === 0 ? (
                                <div className="text-center py-12 text-gray-500 bg-gray-800/50 rounded-xl">
                                    No recommendations found. Try adjusting your filters.
                                </div>
                            ) : (
                                recommendations.map((rec, i) => (
                                    <div key={i} className="bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-indigo-500/50 transition-all group">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-3 mb-2">
                                                    <h3 className="font-bold text-lg">{rec.listing.Title || 'Proxy Listing'}</h3>
                                                    <div className="flex items-center px-2 py-0.5 bg-yellow-500/10 text-yellow-500 rounded text-xs font-bold border border-yellow-500/20">
                                                        <Star className="w-3 h-3 fill-current mr-1" /> {rec.score.toFixed(0)} Match Score
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 mb-4">
                                                    {rec.reasons.map((reason, j) => (
                                                        <span key={j} className="text-xs px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20">
                                                            {reason}
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="flex items-center gap-6 text-sm text-gray-400">
                                                    <span className="flex items-center">
                                                        <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                                                        {rec.listing.avg_speed_mbps || 0} Mbps
                                                    </span>
                                                    <span>{rec.listing.proxy_type || 'Residential'}</span>
                                                    <span>{rec.listing.latency_ms || 0}ms Latency</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-2xl font-bold text-white mb-1">
                                                    ${rec.listing.price_per_gb}<span className="text-sm text-gray-400 font-normal">/GB</span>
                                                </div>
                                                <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-bold transition-colors">
                                                    Buy Now
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
