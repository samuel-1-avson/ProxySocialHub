'use client';

import { useState } from 'react';
import { X, ShieldCheck, Zap, Globe, Power, AlertCircle, CheckCircle, Wifi } from 'lucide-react';
import { Listing, createOrder } from '@/lib/api/marketplace';
import { useAuth } from '@/lib/auth';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { initializeEscrow } from '@/lib/solana';

interface BuyListingModalProps {
    listing: Listing;
    onClose: () => void;
    onSuccess: (orderId: string) => void;
}

export function BuyListingModal({ listing, onClose, onSuccess }: BuyListingModalProps) {
    const { publicKey, signTransaction } = useWallet();
    // Helper to get full wallet object for Anchor
    const wallet = useAnchorWallet();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const [bandwidth, setBandwidth] = useState(listing.min_purchase_gb || 1);

    const handleConnect = async () => {
        if (!wallet || !publicKey) {
            alert("Please connect your Solana wallet first!");
            return;
        }

        setLoading(true);
        setError('');
        try {
            // 1. Create Backend Order (Lock Rate)
            console.log("Creating Order with dynamic bandwidth:", bandwidth);
            // Modernized V3 Order Signature
            const order = await createOrder({
                listing_id: listing.id,
                bandwidth_gb: bandwidth,
                session_type: (listing.proxy_type === 'sticky' ? 'sticky' : 'rotating')
            });

            // 2. Initiate Smart Contract Payment (Get PDA & Params)
            console.log("Initiating Payment for Order:", order.id);
            const { initiateSmartContractPayment } = await import('@/lib/services/market');
            const params = await initiateSmartContractPayment(order.id);

            // 3. Initialize On-Chain Escrow using Backend Params
            console.log("Starting Solana Transaction with PDA:", params.escrow_pda);

            // We use the seller key verified by backend (params.seller_pubkey)
            const { tx } = await initializeEscrow(
                wallet,
                params.seller_pubkey,
                params.amount_lamports,
                params.bandwidth_gb
            );

            console.log("Solana Tx Success:", tx);

            // Backend listener will pick up the event and activate the order.
            // We can poll order status here if we want immediate feedback, or just succeed.

            setSuccess(true);
            setTimeout(() => {
                onSuccess(order.id);
                onClose();
            }, 2000);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to connect: Transaction rejected or failed');
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

                    <div className="space-y-4 pt-4 border-t border-white/5">
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Bandwidth Quota</label>
                                <span className="text-xs font-mono font-bold text-white">{bandwidth} GB</span>
                            </div>
                            <input
                                type="range"
                                min={listing.min_purchase_gb || 1}
                                max={Math.min(listing.available_bandwidth_gb || 1000, 100)}
                                step="1"
                                value={bandwidth}
                                onChange={(e) => setBandwidth(parseInt(e.target.value))}
                                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                            />
                            <div className="flex justify-between text-[8px] text-white/20 font-mono">
                                <span>MIN: {listing.min_purchase_gb || 1}GB</span>
                                <span>AVAIL: {listing.available_bandwidth_gb || 'UNTETHERED'}</span>
                            </div>
                        </div>

                        <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5">
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-1">Total Estimated Cost</p>
                                <p className="font-mono text-2xl font-black text-emerald-400">₵{(listing.price_per_gb * bandwidth).toFixed(2)}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-1">Rate</p>
                                <p className="text-xs font-mono text-white/60">₵{listing.price_per_gb.toFixed(2)}/GB</p>
                            </div>
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
