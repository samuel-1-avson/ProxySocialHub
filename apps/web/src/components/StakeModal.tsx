'use client';

import { useState } from 'react';
import { X, TrendingUp, ShieldCheck, AlertCircle, Loader2, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { stakeNode } from '@/lib/api/marketplace';

interface StakeModalProps {
    nodeId: string;
    onClose: () => void;
    onSuccess: () => void;
}

export function StakeModal({ nodeId, onClose, onSuccess }: StakeModalProps) {
    const [amount, setAmount] = useState(1.0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleStake = async () => {
        setLoading(true);
        setError('');
        try {
            // In a real industrial scenario, this would trigger a Solana transaction.
            // For now, we interact with the hexagonal API to lock the stake.
            await stakeNode({
                listing_id: nodeId,
                amount_sol: amount
            });

            setSuccess(true);
            setTimeout(() => {
                onSuccess();
                onClose();
            }, 2000);
        } catch (err: any) {
            setError(err.message || 'Failed to submit stake. Protocol rejected.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative w-full max-w-sm bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <h2 className="text-sm font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                        <TrendingUp size={16} className="text-yellow-500" />
                        Priority Boost
                    </h2>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-full text-muted-foreground transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {success ? (
                        <div className="py-10 text-center animate-in zoom-in duration-500">
                            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-500 mb-4">
                                <ShieldCheck size={32} />
                            </div>
                            <h3 className="text-lg font-black text-white uppercase tracking-widest">Stake Locked</h3>
                            <p className="text-xs text-muted-foreground mt-2">Visibility ranking updated. Node prioritized.</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 space-y-3">
                                <div className="flex items-center gap-2 text-yellow-500">
                                    <AlertCircle size={14} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Protocol Staking</span>
                                </div>
                                <p className="text-[10px] text-yellow-200/60 leading-relaxed font-mono">
                                    Lock TAO/SOL to increase your node's Priority Rank.
                                    Staked funds serve as industrial trust signal and are subject to 72h cooldown for withdrawal.
                                </p>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-white/40 uppercase tracking-widest block">Stake Amount (TAO)</label>
                                <div className="relative">
                                    <Coins className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
                                    <input
                                        type="number"
                                        step="0.1"
                                        min="0.1"
                                        value={amount}
                                        onChange={(e) => setAmount(parseFloat(e.target.value))}
                                        className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-white font-mono focus:border-yellow-500/50 outline-none transition-all"
                                    />
                                </div>
                                <div className="flex justify-between text-[8px] font-mono text-white/20 uppercase tracking-widest">
                                    <span>Current: 0.0 TAO</span>
                                    <span>Rank: #128 → #10</span>
                                </div>
                            </div>

                            {error && (
                                <div className="text-[10px] text-red-400 bg-red-400/10 p-3 border border-red-400/20 rounded-md font-mono uppercase tracking-widest text-center">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={handleStake}
                                disabled={loading}
                                className="w-full py-4 bg-white text-black font-black uppercase tracking-widest text-xs rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 size={16} className="animate-spin" /> : "Confirm & Stake"}
                            </button>
                        </>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
