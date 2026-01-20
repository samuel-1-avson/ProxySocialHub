'use client';

import { useState } from 'react';
import { X, ShieldCheck, Zap, Globe, Power, AlertCircle, CheckCircle, Wifi } from 'lucide-react';
import { Listing } from '@/lib/social-api';
import { createOrder } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface BuyListingModalProps {
    listing: Listing;
    onClose: () => void;
    onSuccess: (orderId: string) => void;
}

export function BuyListingModal({ listing, onClose, onSuccess }: BuyListingModalProps) {
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleConnect = async () => {
        setLoading(true);
        setError('');
        try {
            // For IaaS, we send quantity 1 (ignored by backend) to create the connection order
            const order = await createOrder(listing.id, 1);
            setSuccess(true);
            setTimeout(() => {
                onSuccess(order.id);
                onClose();
            }, 2000);
        } catch (err: any) {
            setError(err.message || 'Failed to connect to node');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <div className="bg-[#0a0a0a] border border-green-500/20 rounded-3xl p-8 max-w-sm w-full text-center space-y-4 animate-in fade-in zoom-in duration-300">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto text-green-500 mb-2">
                        <CheckCircle size={32} />
                    </div>
                    <h2 className="text-2xl font-black text-white">Connected!</h2>
                    <p className="text-muted-foreground">Session established. Pay-as-you-go billing active.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                        <Wifi size={24} className="text-green-500" />
                        Connect to Node
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">

                    {/* Listing Summary */}
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex gap-4 items-start">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex-shrink-0 flex items-center justify-center text-white font-black">
                            {listing.proxy_type?.[0].toUpperCase()}
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-sm line-clamp-1">{listing.title}</h3>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1"><ShieldCheck size={10} className="text-blue-400" /> Verified</span>
                                <span className="flex items-center gap-1"><Zap size={10} className="text-yellow-400" /> {listing.avg_latency_ms}ms</span>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-2">
                        <h4 className="text-sm font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                            <AlertCircle size={14} /> IaaS Billing Mode
                        </h4>
                        <p className="text-xs text-blue-200/80 leading-relaxed">
                            This is a <strong className="text-white">Pay-As-You-Go</strong> connection.
                            You will be billed in real-time based on your bandwidth usage.
                            Funds will be deducted from your wallet automatically.
                        </p>
                    </div>

                    <div className="space-y-2 pt-4 border-t border-white/5">
                        <div className="flex justify-between items-center bg-white/5 p-3 rounded-lg">
                            <span className="text-sm text-muted-foreground">Current Rate</span>
                            <span className="font-mono text-xl font-black text-white">₵{listing.price_per_gb.toFixed(2)}<span className="text-xs text-muted-foreground font-sans font-normal ml-1">/ GB</span></span>
                        </div>
                    </div>

                    {error && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium flex gap-2 items-center">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleConnect}
                        disabled={loading}
                        className="w-full py-4 rounded-2xl bg-white text-black font-black text-lg uppercase tracking-wide hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                    >
                        {loading ? (
                            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <Power size={20} />
                                Start Connection
                            </>
                        )}
                    </button>

                    <p className="text-center text-[10px] text-muted-foreground">
                        Connection will auto-terminate if wallet balance reaches zero.
                    </p>

                </div>
            </div>
        </div>
    );
}
