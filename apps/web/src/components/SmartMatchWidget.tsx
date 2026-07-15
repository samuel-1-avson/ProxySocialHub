'use client';

import React, { useState, useEffect } from 'react';
import {
    Sparkles, Check, BrainCircuit, Loader2, Hexagon, Zap,
    Activity, Globe, Wifi, Terminal, Radar, ChevronRight,
    ShieldCheck, Command, Target, Filter, Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    getUseCases, getRecommendations,
    smartMatch,
    UseCase, Recommendation, SmartMatchResult, SmartMatchResponse
} from '@/lib/api';
import { useZKReputation } from '@/lib/hooks/useZKReputation';
import { ProviderTierBadge, ProviderTier } from '@/components/ProviderTierBadge';
import Link from 'next/link';

// ─── helpers ──────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
    const pct = Math.round(score);
    const color = pct >= 80 ? '#10b981' : pct >= 55 ? '#f59e0b' : '#ef4444';
    return (
        <div className="relative w-14 h-14 flex-shrink-0">
            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                <circle
                    cx="18" cy="18" r="15.9" fill="none"
                    stroke={color} strokeWidth="3"
                    strokeDasharray={`${pct} ${100 - pct}`}
                    strokeLinecap="round"
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white">
                {pct}
            </span>
        </div>
    );
}

function SuccessToast({ message, onClose }: { message: string; onClose: () => void }) {
    useEffect(() => {
        const t = setTimeout(onClose, 3000);
        return () => clearTimeout(t);
    }, [onClose]);
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 right-8 z-50 px-6 py-4 rounded-2xl bg-emerald-500 text-black text-xs font-black uppercase tracking-wider shadow-2xl flex items-center gap-3"
        >
            <Check size={16} /> {message}
        </motion.div>
    );
}

// ─── types ────────────────────────────────────────────────────────────────────

type Mode = 'classic' | 'smart';

// ─── component ────────────────────────────────────────────────────────────────

export function SmartMatchWidget() {
    const { isVerified } = useZKReputation();

    // shared
    const [mode, setMode] = useState<Mode>('smart');

    // ── classic mode state ────────────────────────────────────────────────────
    const [useCases, setUseCases] = useState<UseCase[]>([]);
    const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);
    const [classicRecs, setClassicRecs] = useState<Recommendation[]>([]);
    const [minScore, setMinScore] = useState(0);

    // ── smart mode state ──────────────────────────────────────────────────────
    const [useCase, setUseCase] = useState('web_scraping');
    const [geo, setGeo] = useState('');
    const [maxPrice, setMaxPrice] = useState('');
    const [minUptime, setMinUptime] = useState('95');
    const [maxLatency, setMaxLatency] = useState('300');
    const [sessionType, setSessionType] = useState('rotating');
    const [requiredTier, setRequiredTier] = useState('any');
    const [bandwidth, setBandwidth] = useState('');

    const [smartResults, setSmartResults] = useState<SmartMatchResult[]>([]);
    const [matchRequestId, setMatchRequestId] = useState<string | null>(null);
    const [explanation, setExplanation] = useState('');

    // shared loading / display
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    // ── fetch use-cases for classic mode ─────────────────────────────────────
    useEffect(() => {
        getUseCases()
            .then((data) => {
                if (data && data.length > 0) {
                    setUseCases(data);
                    setSelectedUseCase(data[0].id);
                }
            })
            .catch(() => {});
    }, []);

    // ── handlers ──────────────────────────────────────────────────────────────

    const handleClassicMatch = async () => {
        if (!selectedUseCase) return;
        setAnalyzing(true);
        setShowResults(false);
        try {
            setLoading(true);
            const data = await getRecommendations(selectedUseCase, minScore);
            setClassicRecs(data?.recommendations || []);
            setShowResults(true);
        } catch {
            // silent
        } finally {
            setAnalyzing(false);
            setLoading(false);
        }
    };

    const handleSmartMatch = async () => {
        setAnalyzing(true);
        setShowResults(false);
        try {
            setLoading(true);
            const res: SmartMatchResponse = await smartMatch({
                use_case: useCase,
                preferred_geo: geo || undefined,
                max_price_per_gb: maxPrice ? parseFloat(maxPrice) : undefined,
                min_uptime_percent: minUptime ? parseFloat(minUptime) : undefined,
                max_latency_ms: maxLatency ? parseInt(maxLatency, 10) : undefined,
                session_type: sessionType,
                required_tier: requiredTier === 'any' ? undefined : requiredTier,
                bandwidth_gb: bandwidth ? parseFloat(bandwidth) : undefined,
            });
            setSmartResults(res.recommended || []);
            setMatchRequestId(res.match_request_id);
            setExplanation(res.explanation);
            setShowResults(true);
        } catch {
            // silent
        } finally {
            setAnalyzing(false);
            setLoading(false);
        }
    };

    const handleConnect = (listingId: string) => {
        setToast(`Provider ${listingId.slice(0, 8)}… queued for session`);
    };

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <>
            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1, transition: { duration: 0.5, staggerChildren: 0.1 } }}
                className="group relative overflow-hidden rounded-[3rem] bg-black/40 backdrop-blur-3xl border border-white/5 p-1 shadow-2xl"
            >
                {/* Background neural grid */}
                <div
                    className="absolute inset-0 opacity-[0.03] pointer-events-none z-0"
                    style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }}
                />

                <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden rounded-[2.9rem]">

                    {/* ── Left panel ────────────────────────────────────────── */}
                    <div className="lg:col-span-4 bg-white/[0.02] border-r border-white/5 p-8 lg:p-12 space-y-8">

                        {/* Header */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 shadow-lg shadow-primary/10">
                                    <BrainCircuit className="text-primary" size={20} />
                                </div>
                                <div className="space-y-0.5">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">Neural Engine V4</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/60">Core Online</span>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <h2 className="text-3xl font-black uppercase tracking-tighter text-white leading-none">Smart Match</h2>
                                <p className="text-[10px] font-black text-white/20 uppercase tracking-widest leading-relaxed">
                                    AI-powered provider selection with real-time scoring.
                                </p>
                            </div>
                        </div>

                        {/* Mode toggle */}
                        <div className="flex gap-2 p-1 bg-white/[0.03] border border-white/5 rounded-2xl">
                            {(['smart', 'classic'] as Mode[]).map((m) => (
                                <button
                                    key={m}
                                    onClick={() => { setMode(m); setShowResults(false); }}
                                    className={`flex-1 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${mode === m
                                        ? 'bg-primary text-black shadow-lg'
                                        : 'text-white/20 hover:text-white/50'
                                        }`}
                                >
                                    {m === 'smart' ? 'Smart' : 'Classic'}
                                </button>
                            ))}
                        </div>

                        {/* ── Classic mode: use-case selector ────────────── */}
                        {mode === 'classic' && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-2.5">
                                    {!useCases.length ? (
                                        <div className="py-16 flex items-center justify-center">
                                            <Loader2 className="animate-spin text-white/10" size={24} />
                                        </div>
                                    ) : useCases.map((uc) => (
                                        <button
                                            key={uc.id}
                                            onClick={() => setSelectedUseCase(uc.id)}
                                            className={`group relative p-4 rounded-2xl text-left transition-all duration-300 border flex items-center gap-4 ${selectedUseCase === uc.id
                                                ? 'bg-primary/10 border-primary/30 shadow-lg shadow-primary/5'
                                                : 'bg-white/[0.02] border-transparent hover:bg-white/[0.05] hover:border-white/10'
                                                }`}
                                        >
                                            <div className={`p-2 rounded-lg transition-all ${selectedUseCase === uc.id ? 'bg-primary text-primary-foreground shadow-lg' : 'bg-white/5 text-white/20'}`}>
                                                <Hexagon size={14} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`font-black text-[11px] uppercase tracking-wider ${selectedUseCase === uc.id ? 'text-white' : 'text-white/40'}`}>
                                                    {uc.name.replace('_', ' ')}
                                                </div>
                                                <div className="text-[8px] font-black uppercase tracking-widest text-white/10 mt-0.5 truncate">
                                                    {uc.description}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center text-[9px] font-black text-white/30 uppercase tracking-[0.2em]">
                                        <span>Trust Threshold</span>
                                        <span className="text-primary">{minScore}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="100" step="10"
                                        value={minScore} onChange={(e) => setMinScore(parseInt(e.target.value))}
                                        className="w-full h-1 bg-white/5 rounded-full appearance-none cursor-pointer accent-primary"
                                    />
                                </div>

                                <button
                                    onClick={handleClassicMatch}
                                    disabled={!selectedUseCase || analyzing}
                                    className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.98] disabled:opacity-50"
                                >
                                    {analyzing ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                                    {analyzing ? 'Scanning...' : 'Run Classic Match'}
                                </button>
                            </div>
                        )}

                        {/* ── Smart mode: criteria form ───────────────────── */}
                        {mode === 'smart' && (
                            <div className="space-y-4">
                                {/* Use case */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Use Case</label>
                                    <select
                                        value={useCase}
                                        onChange={(e) => setUseCase(e.target.value)}
                                        className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 appearance-none cursor-pointer"
                                    >
                                        <option value="web_scraping">Web Scraping</option>
                                        <option value="social_media">Social Media</option>
                                        <option value="streaming">Streaming</option>
                                        <option value="data_collection">Data Collection</option>
                                        <option value="general">General</option>
                                    </select>
                                </div>

                                {/* Geo + Session type */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Country</label>
                                        <input
                                            type="text" placeholder="US" maxLength={2}
                                            value={geo} onChange={(e) => setGeo(e.target.value.toUpperCase())}
                                            className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 placeholder:text-white/10"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Session</label>
                                        <select
                                            value={sessionType}
                                            onChange={(e) => setSessionType(e.target.value)}
                                            className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 appearance-none cursor-pointer"
                                        >
                                            <option value="rotating">Rotating</option>
                                            <option value="sticky">Sticky</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Price + Bandwidth */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Max SOL/GB</label>
                                        <input
                                            type="number" placeholder="0.10" min="0" step="0.01"
                                            value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
                                            className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 placeholder:text-white/10"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Bandwidth GB</label>
                                        <input
                                            type="number" placeholder="10" min="0"
                                            value={bandwidth} onChange={(e) => setBandwidth(e.target.value)}
                                            className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 placeholder:text-white/10"
                                        />
                                    </div>
                                </div>

                                {/* Uptime + Latency */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Min Uptime %</label>
                                        <input
                                            type="number" placeholder="95" min="0" max="100"
                                            value={minUptime} onChange={(e) => setMinUptime(e.target.value)}
                                            className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 placeholder:text-white/10"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Max Latency ms</label>
                                        <input
                                            type="number" placeholder="300" min="0"
                                            value={maxLatency} onChange={(e) => setMaxLatency(e.target.value)}
                                            className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 placeholder:text-white/10"
                                        />
                                    </div>
                                </div>

                                {/* Required tier */}
                                <div className="space-y-1.5">
                                    <label className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Required Tier</label>
                                    <select
                                        value={requiredTier}
                                        onChange={(e) => setRequiredTier(e.target.value)}
                                        className="w-full bg-black/40 border border-white/5 text-[10px] font-black rounded-xl px-4 py-3 outline-none focus:border-primary/40 text-foreground/60 appearance-none cursor-pointer"
                                    >
                                        <option value="any">Any Tier</option>
                                        <option value="Bronze">Bronze</option>
                                        <option value="Silver">Silver</option>
                                        <option value="Gold">Gold</option>
                                    </select>
                                </div>

                                <button
                                    onClick={handleSmartMatch}
                                    disabled={analyzing}
                                    className="w-full group relative overflow-hidden py-4 rounded-2xl bg-primary text-primary-foreground font-black text-[10px] uppercase tracking-[0.4em] flex items-center justify-center gap-3 transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.3)] active:scale-[0.98] disabled:opacity-50"
                                >
                                    <div className="absolute inset-0 bg-white/20 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />
                                    {analyzing ? <Loader2 className="animate-spin" size={16} /> : <Target size={16} />}
                                    {analyzing ? 'Analyzing...' : 'Find Best Providers'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── Right panel ───────────────────────────────────────── */}
                    <div className="lg:col-span-8 relative p-1 overflow-hidden flex flex-col min-h-[500px] bg-black/20">

                        {/* Header overlay */}
                        <div className="absolute top-0 inset-x-0 p-8 flex justify-between items-start z-30 pointer-events-none">
                            <div className="flex gap-4">
                                {isVerified && (
                                    <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 backdrop-blur-md">
                                        <ShieldCheck size={12} /> Authorized
                                    </div>
                                )}
                                <div className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-white/20 text-[9px] font-black uppercase tracking-widest flex items-center gap-2 backdrop-blur-md">
                                    <Globe size={12} className="animate-pulse" /> Mesh Signal: Secure
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <div className="text-[14px] font-black tracking-tighter text-white/50">
                                    {new Date().toLocaleTimeString([], { hour12: false })}
                                </div>
                                <div className="text-[8px] font-black text-white/10 uppercase tracking-[0.3em]">Temporal Registry</div>
                            </div>
                        </div>

                        {/* Main content */}
                        <div className="flex-1 relative z-20 flex items-center justify-center overflow-hidden">
                            <AnimatePresence mode="wait">

                                {/* Idle state */}
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
                                                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                                                className="absolute -inset-16 border border-white/5 rounded-full border-dashed"
                                            />
                                            <motion.div
                                                animate={{ rotate: -360 }}
                                                transition={{ duration: 15, repeat: Infinity, ease: 'linear' }}
                                                className="absolute -inset-10 border border-primary/10 rounded-full"
                                            />
                                            <div className="w-24 h-24 mx-auto rounded-3xl bg-white/[0.03] border border-white/10 flex items-center justify-center relative shadow-2xl backdrop-blur-3xl group">
                                                <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                                                <Radar className="w-10 h-10 text-primary opacity-30" />
                                            </div>
                                        </div>
                                        <div className="space-y-4">
                                            <h4 className="text-xl font-black uppercase tracking-tighter opacity-80">Command Ready</h4>
                                            <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.4em] leading-relaxed">
                                                {mode === 'smart'
                                                    ? 'Configure criteria and click Find Best Providers.'
                                                    : 'Select a use-case vector and initialize scan.'}
                                            </p>
                                        </div>
                                    </motion.div>
                                )}

                                {/* Analyzing state */}
                                {analyzing && (
                                    <motion.div
                                        key="analyzing"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="w-full h-full flex flex-col items-center justify-center p-12"
                                    >
                                        <div className="relative w-72 h-72 lg:w-96 lg:h-96">
                                            <div className="absolute inset-0 border-2 border-primary/5 rounded-full" />
                                            <motion.div
                                                animate={{ rotate: 360 }}
                                                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                                                className="absolute inset-0 border-t-2 border-primary rounded-full shadow-[0_-10px_30px_rgba(16,185,129,0.4)]"
                                            />
                                            <motion.div
                                                animate={{ rotate: -360 }}
                                                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                                                className="absolute inset-8 border-b-2 border-primary/20 rounded-full"
                                            />
                                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 rounded-full backdrop-blur-sm">
                                                <div className="text-3xl font-black tracking-tighter animate-pulse">Scanning</div>
                                                <div className="text-[9px] font-black text-primary/60 uppercase tracking-[0.5em] mt-2">Grid Protocol</div>
                                            </div>
                                        </div>

                                        <div className="absolute bottom-12 inset-x-12 grid grid-cols-4 gap-6">
                                            {[
                                                { label: 'Latency', value: '…' },
                                                { label: 'Uptime', value: '…' },
                                                { label: 'Tier', value: '…' },
                                                { label: 'Score', value: '…' },
                                            ].map((stat, i) => (
                                                <div key={i} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-1">
                                                    <div className="text-[8px] font-black text-white/20 uppercase tracking-widest">{stat.label}</div>
                                                    <div className="text-[11px] font-black tracking-tight text-primary/80 animate-pulse">{stat.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}

                                {/* ── Smart results ──────────────────────── */}
                                {showResults && mode === 'smart' && (
                                    <motion.div
                                        key="smart-results"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="w-full h-full p-8 lg:p-12 flex flex-col"
                                    >
                                        <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded-lg bg-emerald-500 text-black">
                                                    <Check size={16} />
                                                </div>
                                                <div>
                                                    <h4 className="text-base font-black tracking-tighter text-white">
                                                        {smartResults.length} Provider{smartResults.length !== 1 ? 's' : ''} Matched
                                                    </h4>
                                                    {explanation && (
                                                        <p className="text-[8px] font-black text-white/20 uppercase tracking-widest mt-0.5">
                                                            {explanation}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setShowResults(false)}
                                                className="text-[9px] font-black uppercase text-white/30 hover:text-white transition-colors tracking-[0.3em]"
                                            >
                                                New Search
                                            </button>
                                        </div>

                                        {smartResults.length === 0 ? (
                                            <div className="flex-1 flex flex-col items-center justify-center gap-6 opacity-40">
                                                <Filter size={40} className="text-white/10" />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-white/20">
                                                    No providers match your criteria. Try relaxing the filters.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-2 flex-1 pb-6 custom-scrollbar">
                                                {smartResults.map((r, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="relative p-5 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-primary/30 hover:bg-white/[0.05] transition-all duration-300 group flex flex-col gap-4"
                                                    >
                                                        {/* Score ring + title */}
                                                        <div className="flex items-start gap-4">
                                                            <ScoreRing score={r.match_score} />
                                                            <div className="flex-1 min-w-0">
                                                                <Link
                                                                    href={`/marketplace/${r.listing_id}`}
                                                                    className="text-[11px] font-black text-white group-hover:text-primary transition-colors truncate block"
                                                                >
                                                                    {r.title || 'Provider Node'}
                                                                </Link>
                                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                                    <ProviderTierBadge
                                                                        tier={(r.provider_tier || 'unverified') as ProviderTier}
                                                                    />
                                                                    {r.country && (
                                                                        <span className="text-[8px] font-black uppercase tracking-widest text-white/20 flex items-center gap-1">
                                                                            <Globe size={9} /> {r.country}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Metrics row */}
                                                        <div className="grid grid-cols-3 gap-2 text-center">
                                                            <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5">
                                                                <div className="text-[8px] font-black text-white/20 uppercase tracking-widest flex items-center justify-center gap-1">
                                                                    <Clock size={8} /> Latency
                                                                </div>
                                                                <div className="text-[11px] font-black text-white/70 mt-0.5">{r.avg_latency_ms}ms</div>
                                                            </div>
                                                            <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5">
                                                                <div className="text-[8px] font-black text-white/20 uppercase tracking-widest flex items-center justify-center gap-1">
                                                                    <Activity size={8} /> Uptime
                                                                </div>
                                                                <div className="text-[11px] font-black text-white/70 mt-0.5">{Number(r.uptime_percent || 0).toFixed(1)}%</div>
                                                            </div>
                                                            <div className="p-2 rounded-xl bg-white/[0.02] border border-white/5">
                                                                <div className="text-[8px] font-black text-white/20 uppercase tracking-widest flex items-center justify-center gap-1">
                                                                    <Wifi size={8} /> SOL/GB
                                                                </div>
                                                                <div className="text-[11px] font-black text-white/70 mt-0.5">{Number(r.price_per_gb || 0).toFixed(6)}</div>
                                                            </div>
                                                        </div>

                                                        {/* Action */}
                                                        <button
                                                            onClick={() => handleConnect(r.listing_id)}
                                                            className="w-full py-2.5 rounded-2xl bg-primary/10 border border-primary/20 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary hover:text-black transition-all flex items-center justify-center gap-2"
                                                        >
                                                            <Zap size={12} /> Connect to Provider
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {matchRequestId && (
                                            <p className="text-[8px] font-black text-white/10 uppercase tracking-widest mt-2">
                                                Request ID: {matchRequestId.slice(0, 8)}…
                                            </p>
                                        )}
                                    </motion.div>
                                )}

                                {/* ── Classic results ────────────────────── */}
                                {showResults && mode === 'classic' && (
                                    <motion.div
                                        key="classic-results"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="w-full h-full p-12 lg:p-20 flex flex-col"
                                    >
                                        <div className="flex items-center justify-between mb-10 pb-6 border-b border-white/5">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 rounded-lg bg-emerald-500 text-black">
                                                    <Check size={16} />
                                                </div>
                                                <div>
                                                    <h4 className="text-xl font-black tracking-tighter text-white">Results Indexed</h4>
                                                    <p className="text-[9px] font-black text-white/20 uppercase tracking-widest">
                                                        {classicRecs.length} Strategic Matches Found
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setShowResults(false)}
                                                className="text-[9px] font-black uppercase text-white/30 hover:text-white transition-colors tracking-[0.3em]"
                                            >
                                                New Analysis
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-4 custom-scrollbar flex-1 pb-10">
                                            {classicRecs.map((rec, idx) => (
                                                <Link key={idx} href={`/marketplace/${rec.listing?.id}`} className="group">
                                                    <div className="relative p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-primary/40 hover:bg-white/[0.06] transition-all duration-300">
                                                        <div className="absolute left-6 top-0 w-12 h-1 bg-primary/40 rounded-full scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
                                                        <div className="flex justify-between items-start gap-4 mb-4">
                                                            <div className="space-y-1">
                                                                <div className="text-[11px] font-black text-white group-hover:text-primary transition-colors truncate">
                                                                    {rec.listing?.title || 'High Performance Node'}
                                                                </div>
                                                                {rec.reasons?.slice(0, 1).map((r, i) => (
                                                                    <span key={i} className="text-[8px] font-black text-primary/60 uppercase tracking-widest">{r}</span>
                                                                ))}
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="text-2xl font-black tracking-tighter text-white">
                                                                    {Number(rec.score * 100).toFixed(0)}<span className="text-[10px] text-white/20 ml-0.5">%</span>
                                                                </div>
                                                                <div className="text-[7px] font-black text-white/10 uppercase tracking-widest">Match</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                                            <div className="flex items-center gap-2">
                                                                <div className="w-5 h-5 rounded-lg bg-black/40 border border-white/5 flex items-center justify-center">
                                                                    <Wifi size={10} className="text-white/20" />
                                                                </div>
                                                                <span className="text-[9px] font-black text-white/40">{Number(rec.listing?.price_per_gb || 0).toFixed(6)} SOL/GB</span>
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

                        {/* Bottom HUD */}
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

            {/* Toast */}
            <AnimatePresence>
                {toast && <SuccessToast message={toast} onClose={() => setToast(null)} />}
            </AnimatePresence>
        </>
    );
}

export default SmartMatchWidget;
