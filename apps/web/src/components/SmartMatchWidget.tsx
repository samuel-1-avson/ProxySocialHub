'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, Check, BrainCircuit, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getUseCases, getRecommendations, UseCase, Recommendation } from '@/lib/api';
import Link from 'next/link';

export function SmartMatchWidget() {
    const [useCases, setUseCases] = useState<UseCase[]>([]);
    const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [showResults, setShowResults] = useState(false);

    useEffect(() => {
        fetchUseCases();
    }, []);

    const fetchUseCases = async () => {
        try {
            const data = await getUseCases();
            // Force fallback if data is empty or null
            if (!data || data.length === 0) {
                throw new Error('Empty use cases returned from API');
            }
            setUseCases(data);
        } catch (error) {
            console.error('Failed to fetch use cases', error);
            // Fallback data for demo if API fails/is empty
            if (useCases.length === 0) {
                setUseCases([
                    { id: '1', name: 'Web Scraping', description: 'High concurrency, rotating IPs' },
                    { id: '2', name: 'Social Media Management', description: 'Sticky sessions, clean IPs' },
                    { id: '3', name: 'Streaming Access', description: 'High bandwidth, residential ISPs' },
                    { id: '4', name: 'Ad Verification', description: 'Geo-targeted, residential IPs' },
                ]);
            }
        }
    };

    const handleMatch = async () => {
        if (!selectedUseCase) return;

        setAnalyzing(true);
        setShowResults(false);

        // Simulate AI analysis delay
        await new Promise(r => setTimeout(r, 1500));

        try {
            setLoading(true);
            const data = await getRecommendations(selectedUseCase);
            setRecommendations(data?.recommendations || []);
            setAnalyzing(false);
            setShowResults(true);
        } catch (error) {
            console.error('Failed to get recommendations', error);
            setAnalyzing(false);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-white/10 p-8 md:p-12 mb-12">
            {/* Background Effects */}
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-purple-500/10 blur-[120px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

                {/* Left: Input Selection */}
                <div className="space-y-8">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-bold uppercase tracking-wider">
                            <BrainCircuit className="w-4 h-4" />
                            AI Powered
                        </div>
                        <h2 className="text-4xl font-black text-white tracking-tight">
                            Smart Match
                        </h2>
                        <p className="text-lg text-white/60">
                            Not sure which proxy to choose? Tell us your use case, and our AI will analyze network performance metrics to recommend the perfect match.
                        </p>
                    </div>

                    <div className="space-y-4">
                        <p className="text-sm font-bold text-white/40 uppercase tracking-widest">Select your Use Case</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(useCases || []).map((useCase) => (
                                <button
                                    key={useCase.id}
                                    onClick={() => setSelectedUseCase(useCase.id)}
                                    className={`p-4 rounded-xl text-left transition-all border ${selectedUseCase === useCase.id
                                        ? 'bg-purple-500/20 border-purple-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                                        : 'bg-white/5 border-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    <div className="font-bold">{useCase.name}</div>
                                    <div className="text-xs opacity-60 mt-1">{useCase.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleMatch}
                        disabled={!selectedUseCase || analyzing || loading}
                        className="w-full md:w-auto px-8 py-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-lg flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl hover:shadow-purple-500/20 active:scale-95"
                    >
                        {analyzing ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Analyzing Network Patterns...
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-5 h-5" />
                                Find Best Match
                            </>
                        )}
                    </button>
                </div>

                {/* Right: Results Display */}
                <div className="relative min-h-[300px] flex items-center justify-center">
                    <AnimatePresence mode='wait'>
                        {!showResults && !analyzing && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="text-center space-y-4 opacity-40"
                            >
                                <BrainCircuit className="w-32 h-32 mx-auto text-purple-500/50" />
                                <p className="text-white font-mono text-sm">Waiting for input...</p>
                            </motion.div>
                        )}

                        {analyzing && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.1 }}
                                className="relative"
                            >
                                <div className="absolute inset-0 bg-purple-500/20 blur-xl rounded-full animate-pulse"></div>
                                <div className="w-64 h-64 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin relative z-10"></div>
                                <div className="absolute inset-0 flex items-center justify-center z-20 font-mono text-purple-300 font-bold tracking-widest animate-pulse">
                                    AI SCANNING
                                </div>
                            </motion.div>
                        )}

                        {showResults && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="w-full space-y-6"
                            >
                                {(recommendations || []).length > 0 ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xl font-bold text-white">Top Recommendations</h3>
                                            <span className="text-xs font-bold text-green-400 bg-green-500/10 px-2 py-1 rounded-lg border border-green-500/20">
                                                {(recommendations[0]?.score * 100).toFixed(0)}% Match
                                            </span>
                                        </div>
                                        <div className="space-y-3">
                                            {recommendations.slice(0, 2).map((rec, idx) => (
                                                <div key={idx} className="p-4 rounded-xl bg-white/10 border border-white/10 hover:border-purple-500/50 transition-all group">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <h4 className="font-bold text-white group-hover:text-purple-300 transition-colors">
                                                            {rec.listing?.title || 'High Performance Node'}
                                                        </h4>
                                                        <div className="text-right">
                                                            <div className="text-lg font-bold text-white">₵{rec.listing?.price_per_gb}</div>
                                                            <div className="text-[10px] text-white/40 uppercase">PER GB</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2 mb-3">
                                                        {(rec.reasons || []).map((reason, i) => (
                                                            <span key={i} className="text-[10px] font-bold px-2 py-1 rounded bg-purple-500/20 text-purple-300 flex items-center gap-1">
                                                                <Check className="w-3 h-3" /> {reason}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <Link
                                                        href={`/marketplace/${rec.listing?.id}`}
                                                        className="block w-full text-center py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-sm transition-colors"
                                                    >
                                                        View Listing
                                                    </Link>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-12 bg-white/5 rounded-2xl border border-white/10">
                                        <Search className="w-12 h-12 text-white/20 mx-auto mb-4" />
                                        <p className="text-white/60">No specific matches found for this criteria.</p>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
