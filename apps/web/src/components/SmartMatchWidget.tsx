'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, Check, BrainCircuit, Search, ShieldCheck, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getUseCases, getRecommendations, UseCase, Recommendation } from '@/lib/api';
import { useZKReputation } from '@/lib/hooks/useZKReputation';
import Link from 'next/link';

export function SmartMatchWidget() {
    const { isVerified, loading: reputationLoading } = useZKReputation();
    const [useCases, setUseCases] = useState<UseCase[]>([]);
    const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const [minScore, setMinScore] = useState(0);

    useEffect(() => {
        fetchUseCases();
    }, []);

    const fetchUseCases = async () => {
        try {
            const data = await getUseCases();
            if (!data || data.length === 0) {
                throw new Error('Empty use cases returned from API');
            }
            setUseCases(data);
        } catch (error) {
            console.error('Failed to fetch use cases', error);
        }
    };

    const handleMatch = async () => {
        if (!selectedUseCase) return;

        setAnalyzing(true);
        setShowResults(false);

        try {
            setLoading(true);
            const data = await getRecommendations(selectedUseCase, minScore);
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
        <div className="relative overflow-hidden rounded-3xl bg-black/40 backdrop-blur-xl border border-white/10 p-1 mb-12">
            {/* HUD Borders */}
            <div className="absolute top-0 left-0 w-32 h-32 border-l-2 border-t-2 border-white/10 rounded-tl-3xl pointer-events-none"></div>
            <div className="absolute bottom-0 right-0 w-32 h-32 border-r-2 border-b-2 border-white/10 rounded-br-3xl pointer-events-none"></div>

            <div className="relative z-10 p-8 md:p-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">

                {/* Left: Controls */}
                <div className="lg:col-span-5 space-y-8">
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-black uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(168,85,247,0.1)]">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                                </span>
                                AI Neural Match
                            </div>

                            {isVerified && (
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-[0.2em]"
                                >
                                    <ShieldCheck size={12} />
                                    Verified Operator
                                </motion.div>
                            )}

                            {reputationLoading && (
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">
                                    <Loader2 size={12} className="animate-spin" />
                                    Proving Reputation...
                                </div>
                            )}
                        </div>

                        <h2 className="text-4xl md:text-5xl font-black text-white tracking-tighter leading-[0.9]">
                            Intelligent<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">Proxy Matching</span>
                        </h2>
                        <p className="text-white/50 text-base leading-relaxed font-medium max-w-md">
                            {isVerified
                                ? "Elite Operator status detected. Our neural engine has prioritized high-performance nodes for your reputation level."
                                : "Select your specialized use case. Our neural engine will analyze millions of parameters to find your perfect node."
                            }
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                        {!Array.isArray(useCases) || useCases.length === 0 ? (
                            <div className="p-8 text-center text-[10px] font-mono text-white/20 border border-dashed border-white/10 rounded-xl">
                                INITIALIZING NEURAL ENGINE...
                            </div>
                        ) : (
                            useCases.map((useCase) => (
                                <button
                                    key={useCase.id}
                                    onClick={() => setSelectedUseCase(useCase.id)}
                                    className={`group relative p-4 rounded-xl text-left transition-all duration-300 border ${selectedUseCase === useCase.id
                                        ? 'bg-white/10 border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.15)]'
                                        : 'bg-white/5 border-transparent hover:bg-white/[0.07] hover:border-white/10'
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className={`font-bold text-sm tracking-wide ${selectedUseCase === useCase.id ? 'text-white' : 'text-white/70 group-hover:text-white'}`}>
                                                {useCase.name}
                                            </div>
                                            <div className="text-[10px] text-white/40 font-bold uppercase tracking-wider mt-0.5 group-hover:text-white/60">
                                                {useCase.description}
                                            </div>
                                        </div>
                                        {selectedUseCase === useCase.id && (
                                            <motion.div layoutId="active-indicator" className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]" />
                                        )}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>

                    {/* Filters */}
                    <div className="bg-white/5 rounded-xl p-4 border border-white/5">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-bold text-white/60 uppercase tracking-widest">Minimum Trust Score</label>
                            <span className="text-xs font-mono font-bold text-purple-400">{minScore}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="10"
                            value={minScore}
                            onChange={(e) => setMinScore(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                        />
                        <div className="flex justify-between mt-1 px-1">
                            <span className="text-[8px] text-white/20">ANY</span>
                            <span className="text-[8px] text-white/20">PLATINUM</span>
                        </div>
                    </div>

                    <button
                        onClick={handleMatch}
                        disabled={!selectedUseCase || analyzing || loading}
                        className="w-full group relative overflow-hidden px-8 py-5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_40px_rgba(147,51,234,0.3)] hover:shadow-[0_0_60px_rgba(147,51,234,0.5)] active:scale-[0.98]"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>

                        {analyzing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Processing...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles className="w-4 h-4" />
                                <span>Initiate Scan</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Right: Visualization & Results */}
                <div className="lg:col-span-7 relative min-h-[400px] rounded-2xl bg-black/40 border border-white/5 overflow-hidden flex flex-col">
                    {/* Scan Lines overlay */}
                    <div className="absolute inset-0 pointer-events-none z-0 opacity-20"
                        style={{ backgroundImage: 'linear-gradient(0deg, transparent 24%, rgba(255, 255, 255, .05) 25%, rgba(255, 255, 255, .05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .05) 75%, rgba(255, 255, 255, .05) 76%, transparent 77%, transparent), linear-gradient(90deg, transparent 24%, rgba(255, 255, 255, .05) 25%, rgba(255, 255, 255, .05) 26%, transparent 27%, transparent 74%, rgba(255, 255, 255, .05) 75%, rgba(255, 255, 255, .05) 76%, transparent 77%, transparent)', backgroundSize: '50px 50px' }}>
                    </div>

                    <div className="relative z-10 flex-1 flex items-center justify-center p-8">
                        <AnimatePresence mode='wait'>

                            {!showResults && !analyzing && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="text-center space-y-6 max-w-xs"
                                >
                                    <div className="w-24 h-24 mx-auto rounded-full bg-white/5 border border-white/10 flex items-center justify-center relative">
                                        <div className="absolute inset-0 rounded-full border border-white/5 animate-ping opacity-20"></div>
                                        <BrainCircuit className="w-10 h-10 text-white/20" />
                                    </div>
                                    <div>
                                        <p className="text-white font-bold text-lg">System Ready</p>
                                        <p className="text-white/40 text-xs font-mono mt-2 uppercase tracking-wide">Select a vector to begin analysis</p>
                                    </div>
                                </motion.div>
                            )}

                            {analyzing && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="w-full max-w-md mx-auto relative"
                                >
                                    {/* Central Scanner */}
                                    <div className="relative mx-auto w-48 h-48">
                                        <div className="absolute inset-0 rounded-full border-2 border-purple-500/20"></div>
                                        <div className="absolute inset-0 rounded-full border-t-2 border-purple-500 animate-spin"></div>
                                        <div className="absolute inset-4 rounded-full border-2 border-white/10 border-b-white/50 animate-spin-reverse"></div>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <div className="text-center">
                                                <div className="text-2xl font-black text-white tracking-widest animate-pulse">Scanning</div>
                                                <div className="text-[10px] text-purple-400 font-mono mt-1">ANALYZING NODES</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Code Rain Effect / Stats */}
                                    <div className="mt-8 grid grid-cols-3 gap-2 text-center">
                                        <div className="bg-white/5 rounded-lg p-2">
                                            <div className="text-[10px] text-white/30">LATENCY</div>
                                            <div className="text-purple-400 font-mono text-xs blinking-cursor">Checking...</div>
                                        </div>
                                        <div className="bg-white/5 rounded-lg p-2">
                                            <div className="text-[10px] text-white/30">UPTIME</div>
                                            <div className="text-purple-400 font-mono text-xs">Verifying...</div>
                                        </div>
                                        <div className="bg-white/5 rounded-lg p-2">
                                            <div className="text-[10px] text-white/30">TRUST</div>
                                            <div className="text-purple-400 font-mono text-xs">Calculating...</div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}

                            {showResults && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="w-full h-full flex flex-col"
                                >
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                            <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Optimization Complete</span>
                                        </div>
                                        <div className="text-xs font-bold text-white/40">
                                            {(recommendations || []).length} MATCHES FOUND
                                        </div>
                                    </div>

                                    <div className="space-y-3 overflow-y-auto pr-2 custom-scrollbar flex-1">
                                        {(recommendations || []).map((rec, idx) => (
                                            <div key={idx} className="group relative p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all">
                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-500 to-pink-500 rounded-l-xl opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                                <div className="flex items-start justify-between gap-4">
                                                    <div>
                                                        <h4 className="font-bold text-white text-lg group-hover:text-purple-300 transition-colors">
                                                            {rec.listing?.title || 'High Performance Node'}
                                                        </h4>
                                                        <div className="flex flex-wrap gap-2 mt-2">
                                                            {isVerified && (
                                                                <span className="text-[9px] font-black px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-[0.15em] flex items-center gap-1">
                                                                    <ShieldCheck size={10} /> Reputation Match
                                                                </span>
                                                            )}
                                                            {(rec.reasons || []).slice(0, 2).map((reason, i) => (
                                                                <span key={i} className="text-[9px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 uppercase tracking-wider">
                                                                    {reason}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <div className="text-xl font-black text-white tracking-tight">
                                                            {(rec.score * 100).toFixed(0)}<span className="text-sm align-top text-white/40">%</span>
                                                        </div>
                                                        <div className="text-[8px] font-black text-white/30 uppercase">Match Score</div>
                                                    </div>
                                                </div>

                                                <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                                                    <div className="text-sm font-bold text-white/60">
                                                        Top Rated Seller
                                                    </div>
                                                    <Link
                                                        href={`/marketplace/${rec.listing?.id}`}
                                                        className="flex items-center gap-2 text-xs font-black text-white hover:text-purple-400 uppercase tracking-wider transition-colors"
                                                    >
                                                        View Details <ArrowRight size={12} />
                                                    </Link>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div >
    );
}
