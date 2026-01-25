'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, ArrowRight, Check, BrainCircuit, Search, ShieldCheck, Loader2, Hexagon, Cpu, Zap, Activity, Globe, Wifi, Command, Terminal, Radar, ChevronRight } from 'lucide-react';
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
            if (data && data.length > 0) {
                setUseCases(data);
                setSelectedUseCase(data[0].id); // Default to first
            }
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

    const containerVariants = {
        hidden: { opacity: 0, scale: 0.98 },
        visible: { opacity: 1, scale: 1, transition: { duration: 0.5, staggerChildren: 0.1 } }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 }
    };

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="group relative overflow-hidden rounded-[3rem] bg-black/40 backdrop-blur-3xl border border-white/5 p-1 shadow-2xl"
        >
            {/* Background Neural Grid */}
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none z-0"
                style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}>
            </div>

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden rounded-[2.9rem]">

                {/* Left: Tactical Selection Hub */}
                <div className="lg:col-span-4 bg-white/[0.02] border-r border-white/5 p-8 lg:p-12 space-y-10">
                    <div className="space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/10">
                                <BrainCircuit className="text-primary" size={20} />
                            </div>
                            <div className="space-y-0.5">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Neural Engine V4</h3>
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/60">Core Online</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h2 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Smart Match</h2>
                            <p className="text-[10px] font-black text-white/20 uppercase tracking-widest leading-relaxed">
                                Select operational vector to synchronize network alignment.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {!Array.isArray(useCases) || useCases.length === 0 ? (
                            <div className="py-20 flex flex-col items-center justify-center gap-4 border border-dashed border-white/5 rounded-2xl">
                                <Loader2 className="animate-spin text-white/10" size={24} />
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2.5">
                                {useCases.map((useCase) => (
                                    <button
                                        key={useCase.id}
                                        onClick={() => setSelectedUseCase(useCase.id)}
                                        className={`group relative p-4 rounded-2xl text-left transition-all duration-300 border flex items-center gap-4 ${selectedUseCase === useCase.id
                                            ? 'bg-primary/10 border-primary/30 shadow-lg shadow-primary/5'
                                            : 'bg-white/[0.02] border-transparent hover:bg-white/[0.05] hover:border-white/10'
                                            }`}
                                    >
                                        <div className={`p-2 rounded-lg transition-all ${selectedUseCase === useCase.id ? 'bg-primary text-primary-foreground shadow-lg' : 'bg-white/5 text-white/20'
                                            }`}>
                                            <Hexagon size={14} className={selectedUseCase === useCase.id ? 'animate-spin-slow' : ''} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className={`font-black text-[11px] uppercase tracking-wider ${selectedUseCase === useCase.id ? 'text-white' : 'text-white/40'}`}>
                                                {useCase.name.replace('_', ' ')}
                                            </div>
                                            <div className="text-[8px] font-black uppercase tracking-widest text-white/10 mt-0.5 truncate group-hover:text-white/20 transition-colors">
                                                {useCase.description}
                                            </div>
                                        </div>
                                        {selectedUseCase === useCase.id && (
                                            <motion.div layoutId="match-glow" className="absolute inset-0 bg-primary/5 rounded-2xl blur-xl" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="space-y-6 pt-4">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">
                                <span>Trust Threshold</span>
                                <span className="text-primary">{minScore}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="10"
                                value={minScore}
                                onChange={(e) => setMinScore(parseInt(e.target.value))}
                                className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-primary"
                            />
                        </div>

                        <button
                            onClick={handleMatch}
                            disabled={!selectedUseCase || analyzing || loading}
                            className="w-full group relative overflow-hidden py-4 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.98] disabled:opacity-50"
                        >
                            <div className="absolute inset-0 bg-white/20 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                            {analyzing ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} className="text-primary-foreground" />}
                            {analyzing ? 'Synchronizing...' : 'Initialize Scan'}
                        </button>
                    </div>
                </div>

                {/* Right: Immersive Telemetry & Visualization */}
                <div className="lg:col-span-8 relative p-1 lg:p-1 overflow-hidden flex flex-col min-h-[500px] lg:min-h-auto bg-black/20">

                    {/* Header Overlay */}
                    <div className="absolute top-0 inset-x-0 p-8 flex justify-between items-start z-30 pointer-events-none">
                        <div className="flex gap-4">
                            {isVerified && (
                                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 backdrop-blur-md">
                                    <ShieldCheck size={12} />
                                    Authorized Operator
                                </div>
                            )}
                            <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-white/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 backdrop-blur-md">
                                <Globe size={12} className="animate-pulse" />
                                Mesh Signal: Secure
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <div className="text-[14px] font-black tracking-tighter text-white/50">{new Date().toLocaleTimeString([], { hour12: false })}</div>
                            <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em]">Temporal Registry</div>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 relative z-20 flex items-center justify-center overflow-hidden">
                        <AnimatePresence mode='wait'>
                            {!showResults && !analyzing && (
                                <motion.div
                                    key="idle"
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 1.1 }}
                                    className="text-center space-y-12 max-w-sm"
                                >
                                    <div className="relative">
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                                            className="absolute -inset-16 border border-white/5 rounded-full border-dashed"
                                        />
                                        <motion.div
                                            animate={{ rotate: -360 }}
                                            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                                            className="absolute -inset-10 border border-primary/10 rounded-full"
                                        />
                                        <div className="w-24 h-24 mx-auto rounded-3xl bg-white/[0.03] border border-white/10 flex items-center justify-center relative shadow-2xl backdrop-blur-3xl group">
                                            <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <Radar className="w-10 h-10 text-primary opacity-30" />
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <h4 className="text-xl font-black uppercase tracking-tighter opacity-80">Command Ready</h4>
                                        <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em] leading-relaxed italic">
                                            Awaiting vector input to begin node cross-referencing analysis.
                                        </p>
                                    </div>
                                </motion.div>
                            )}

                            {analyzing && (
                                <motion.div
                                    key="analyzing"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="w-full h-full flex flex-col items-center justify-center p-12"
                                >
                                    {/* Holographic Scanner */}
                                    <div className="relative w-72 h-72 lg:w-96 lg:h-96">
                                        <div className="absolute inset-0 border-2 border-primary/5 rounded-full" />
                                        <motion.div
                                            animate={{ rotate: 360 }}
                                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                            className="absolute inset-0 border-t-2 border-primary rounded-full shadow-[0_-10px_30px_rgba(16,185,129,0.4)]"
                                        />
                                        <motion.div
                                            animate={{ rotate: -360 }}
                                            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                            className="absolute inset-8 border-b-2 border-primary/20 rounded-full"
                                        />
                                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 rounded-full backdrop-blur-sm">
                                            <div className="text-3xl font-black tracking-tighter animate-pulse">Scanning</div>
                                            <div className="text-[9px] font-black text-primary/60 uppercase tracking-[0.5em] mt-2">Grid Protocol</div>
                                        </div>

                                        {/* Particle Orbits */}
                                        {[0, 60, 120, 180, 240, 300].map((rot) => (
                                            <motion.div
                                                key={rot}
                                                animate={{ rotate: 360 + rot }}
                                                transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
                                                className="absolute inset-0"
                                            >
                                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-primary/40 shadow-[0_0_15px_rgba(16,185,129,0.8)]" />
                                            </motion.div>
                                        ))}
                                    </div>

                                    {/* Real-time Telemetry Bar */}
                                    <div className="absolute bottom-12 inset-x-12 grid grid-cols-4 gap-6">
                                        {[
                                            { label: 'Latency', value: '42ms' },
                                            { label: 'Uptime', value: '99.9%' },
                                            { label: 'Throughput', value: '2.4 Gbps' },
                                            { label: 'Mesh Depth', value: '4,102' }
                                        ].map((stat, i) => (
                                            <div key={i} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-1">
                                                <div className="text-[8px] font-black text-white/20 uppercase tracking-widest">{stat.label}</div>
                                                <div className="text-[11px] font-black tracking-tight text-primary/80 animate-pulse">{stat.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}

                            {showResults && (
                                <motion.div
                                    key="results"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="w-full h-full p-12 lg:p-20 flex flex-col"
                                >
                                    <div className="flex items-center justify-between mb-10 pb-6 border-b border-white/5">
                                        <div className="flex items-center gap-4">
                                            <div className="p-2 rounded-lg bg-emerald-500 text-black">
                                                <Check size={16} />
                                            </div>
                                            <div className="space-y-0.5">
                                                <h4 className="text-xl font-black tracking-tighter text-white">Results Indexed</h4>
                                                <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">{recommendations.length} Strategic Matches Found</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setShowResults(false)} className="text-[9px] font-black uppercase text-white/30 hover:text-white transition-colors tracking-[0.3em]">New Analysis</button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-4 custom-scrollbar flex-1 pb-10">
                                        {recommendations.map((rec, idx) => (
                                            <Link key={idx} href={`/marketplace/${rec.listing?.id}`} className="group">
                                                <div className="relative p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-primary/40 hover:bg-white/[0.06] transition-all duration-300">
                                                    <div className="absolute left-6 top-0 w-12 h-1 bg-primary/40 rounded-full scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
                                                    <div className="flex justify-between items-start gap-4 mb-4">
                                                        <div className="space-y-1">
                                                            <div className="text-[11px] font-black text-white group-hover:text-primary transition-colors truncate w-full">
                                                                {rec.listing?.title || 'High Performance Node'}
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {rec.reasons.slice(0, 1).map((r, i) => (
                                                                    <span key={i} className="text-[8px] font-black text-primary/60 uppercase tracking-widest">{r}</span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="text-2xl font-black tracking-tighter text-white">
                                                                {(rec.score * 100).toFixed(0)}<span className="text-[10px] text-white/20 ml-0.5">%</span>
                                                            </div>
                                                            <div className="text-[7px] font-black text-white/10 uppercase tracking-widest">Match</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-5 h-5 rounded-lg bg-black/40 border border-white/5 flex items-center justify-center">
                                                                <Wifi size={10} className="text-white/20" />
                                                            </div>
                                                            <span className="text-[9px] font-black text-white/40">{rec.listing?.price_per_gb} / GB</span>
                                                        </div>
                                                        <ChevronRight size={14} className="text-white/10 group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                                    </div>
                                                </div>
                                            </Link>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* Bottom Telemetry HUD */}
                    <div className="absolute bottom-0 inset-x-0 p-8 pt-0 z-30 flex justify-between items-end gap-10">
                        <div className="flex-1 flex items-center gap-10 p-4 border-t border-white/5">
                            <div className="space-y-1">
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em]">Neural Load</div>
                                <div className="flex gap-1">
                                    {[1, 1, 1, 1, 0.5, 0.2, 0.1].map((v, i) => (
                                        <div key={i} className="w-2 h-4 bg-white/5 rounded-sm overflow-hidden border border-white/5">
                                            <motion.div
                                                initial={{ height: 0 }}
                                                animate={{ height: `${v * 100}%` }}
                                                className="bg-primary/40 w-full mt-auto"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="hidden lg:block space-y-1">
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em]">Network Feed</div>
                                <div className="text-[9px] font-black flex items-center gap-2 text-white/30 truncate max-w-[200px]">
                                    <Activity size={10} className="text-primary/40 animate-pulse" />
                                    Synchronizing Sector-7G... OK
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <div className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 text-white/10">
                                <Command size={18} />
                            </div>
                            <div className="p-3 rounded-2xl bg-primary/20 border border-primary/20 text-primary">
                                <Terminal size={18} />
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </motion.div>
    );
}
