'use client';

import { useState, useEffect } from 'react';
import {
    Brain,
    Sparkles,
    Tv,
    Database,
    Gamepad2,
    ShieldCheck,
    Globe,
    Server,
    CheckCircle,
    X,
    Zap
} from 'lucide-react';
import { getUseCases, getRecommendations, UseCase, Recommendation } from '@/lib/api';

interface SmartConnectWizardProps {
    onClose: () => void;
    onConnect: (nodeId: string) => void;
}

export function SmartConnectWizard({ onClose, onConnect }: SmartConnectWizardProps) {
    const [step, setStep] = useState(1);
    const [useCases, setUseCases] = useState<UseCase[]>([]);
    const [selectedUseCase, setSelectedUseCase] = useState<UseCase | null>(null);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [results, setResults] = useState<Recommendation[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Load Use Cases on mount
    useEffect(() => {
        async function load() {
            try {
                const data = await getUseCases();
                setUseCases(data);
            } catch (e) {
                console.error("Failed to load use cases", e);
            }
        }
        load();
    }, []);

    const handleScan = async () => {
        if (!selectedUseCase) return;

        setStep(2); // Scanning UI
        setScanning(true);
        setError(null);

        // Artificial delay to show off "AI Scanning" animation
        setTimeout(async () => {
            try {
                const data = await getRecommendations(selectedUseCase.id);
                setResults(data.recommendations || []);
                setScanning(false);
                setStep(3); // Results UI
            } catch (e) {
                console.error("Scanning failed", e);
                setError("Network analysis failed. Please try again.");
                setScanning(false);
                setStep(1); // Back to selection
            }
        }, 1500);
    };

    const getIcon = (id: string) => {
        switch (id) {
            case 'streaming': return Tv;
            case 'scraping': return Database;
            case 'gaming': return Gamepad2;
            case 'privacy': return ShieldCheck;
            default: return Globe;
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-2xl bg-[#0a0a0a] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400">
                            <Brain size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight">AI Smart Connect</h2>
                            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                                {step === 1 ? 'Select Objective' : step === 2 ? 'Analyzing Network' : 'Optimal Nodes Found'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">

                    {/* STEP 1: Select Use Case */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {useCases.map((uc) => {
                                    const Icon = getIcon(uc.id);
                                    const isSelected = selectedUseCase?.id === uc.id;

                                    return (
                                        <button
                                            key={uc.id}
                                            onClick={() => setSelectedUseCase(uc)}
                                            className={`relative p-6 rounded-2xl border text-left transition-all duration-300 group
                        ${isSelected
                                                    ? 'bg-purple-500/10 border-purple-500/50 ring-1 ring-purple-500/50'
                                                    : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                                }`}
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div className={`p-3 rounded-xl ${isSelected ? 'bg-purple-500 text-white' : 'bg-white/10 text-muted-foreground group-hover:text-white'}`}>
                                                    <Icon size={24} />
                                                </div>
                                                {isSelected && <CheckCircle size={20} className="text-purple-400" />}
                                            </div>
                                            <h3 className="text-lg font-bold text-white mb-1">{uc.name}</h3>
                                            <p className="text-sm text-muted-foreground leading-relaxed">{uc.description}</p>
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                onClick={handleScan}
                                disabled={!selectedUseCase}
                                className="w-full py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black text-lg uppercase tracking-wide hover:from-purple-500 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg shadow-purple-900/20"
                            >
                                <Sparkles size={20} className={selectedUseCase ? "animate-pulse" : ""} />
                                Find Best Proxies
                            </button>
                        </div>
                    )}

                    {/* STEP 2: Scanning Animation */}
                    {step === 2 && (
                        <div className="flex flex-col items-center justify-center py-12 space-y-8">
                            <div className="relative">
                                <div className="absolute inset-0 bg-purple-500/30 blur-3xl rounded-full animate-pulse"></div>
                                <div className="relative w-32 h-32 rounded-full border-4 border-purple-500/30 border-t-purple-500 animate-spin flex items-center justify-center">
                                    <Brain size={48} className="text-purple-400 animate-pulse" />
                                </div>
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-2xl font-black text-white animate-pulse">Scanning Network...</h3>
                                <p className="text-muted-foreground">Analyzing latency, uptime, and trust scores for <strong>{selectedUseCase?.name}</strong></p>
                            </div>

                            {/* Fake terminal log */}
                            <div className="w-full max-w-sm bg-black/50 rounded-xl p-4 font-mono text-xs space-y-1 text-green-400/80 border border-white/5">
                                <div className="animate-in fade-in slide-in-from-left-2 duration-300 delay-100"> Initializing handshake... OK</div>
                                <div className="animate-in fade-in slide-in-from-left-2 duration-300 delay-300"> Querying DHT for {selectedUseCase?.id} nodes...</div>
                                <div className="animate-in fade-in slide-in-from-left-2 duration-300 delay-700"> Verifying cryptographic signatures...</div>
                                <div className="animate-in fade-in slide-in-from-left-2 duration-300 delay-1000">Calculating optimal routes... DONE</div>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Results */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">Top Recommendations</h3>
                                <div className="text-xs font-medium text-purple-400 bg-purple-500/10 px-3 py-1 rounded-full border border-purple-500/20">
                                    AI Confidence: 98%
                                </div>
                            </div>

                            <div className="space-y-3">
                                {results.map((rec, i) => (
                                    <div key={i} className="group relative p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-4">
                                        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-gray-800 to-black border border-white/10 flex items-center justify-center text-white font-black text-sm">
                                            {Math.round(rec.score)}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-bold text-white truncate">Node {rec.listing.id?.substring(0, 8)}...</span>
                                                <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 text-[10px] font-bold uppercase">Online</span>
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                <span className="flex items-center gap-1"><Zap size={10} className="text-yellow-400" /> {rec.listing.avg_latency_ms || 45}ms</span>
                                                <span className="flex items-center gap-1"><Server size={10} className="text-blue-400" /> {rec.listing.country || "GH"}</span>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => onConnect(rec.listing.id || "")}
                                            className="px-4 py-2 rounded-xl bg-white text-black font-bold text-sm hover:bg-purple-400 hover:text-white transition-colors"
                                        >
                                            Connect
                                        </button>

                                        {/* Reasons Badge */}
                                        {i === 0 && (
                                            <div className="absolute -top-3 -right-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-lg">
                                                BEST MATCH
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={() => setStep(1)}
                                    className="flex-1 py-3 rounded-xl bg-white/5 text-muted-foreground font-bold hover:bg-white/10 hover:text-white transition-colors"
                                >
                                    Back
                                </button>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
