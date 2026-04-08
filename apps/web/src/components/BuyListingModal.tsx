'use client';

import { useState } from 'react';
import { X, ShieldCheck, Zap, Power, AlertCircle, CheckCircle, Wifi, Copy, Eye, EyeOff } from 'lucide-react';
import { Listing, createOrder, createSessionFromListing, type MarketplaceProxyCredentials } from '@/lib/api/marketplace';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { initializeEscrow } from '@/lib/solana';
import { useToast } from '@/stores';
import { getErrorMessage } from '@/lib/utils';

interface BuyListingModalProps {
    listing: Listing;
    onClose: () => void;
    onSuccess: (orderId: string, credentials?: MarketplaceProxyCredentials) => void;
}

export function BuyListingModal({ listing, onClose, onSuccess }: BuyListingModalProps) {
    const { publicKey } = useWallet();
    const wallet = useAnchorWallet();
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [credentials, setCredentials] = useState<MarketplaceProxyCredentials | null>(null);
    const [showPass, setShowPass] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    const [bandwidth, setBandwidth] = useState(listing.min_purchase_gb || 1);

    const bandwidthLimitBytes = bandwidth * 1024 * 1024 * 1024;
    const estimatedCostUSD = listing.price_per_gb * bandwidth;

    const copyToClipboard = (text: string, key: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
        });
    };

    const handleConnect = async () => {
        if (!wallet || !publicKey) {
            toast.warning('Wallet required', 'Please connect your Solana wallet first.');
            return;
        }

        setLoading(true);
        setError('');
        try {
            // Step 1: Create order — locks in rate and creates escrow record
            const order = await createOrder({
                listing_id: listing.id,
                bandwidth_gb: bandwidth,
                session_type: listing.proxy_type === 'sticky' ? 'sticky' : 'rotating',
            });

            // Step 2: Initiate on-chain escrow payment
            const { initiateSmartContractPayment } = await import('@/lib/services/market');
            const params = await initiateSmartContractPayment(order.id);

            const { tx } = await initializeEscrow(
                wallet,
                params.seller_pubkey,
                params.amount_lamports,
                params.bandwidth_gb
            );

            console.log("Solana escrow tx:", tx);

            // Step 3: Provision the P2P session — links to specific provider node
            // bandwidth_limit is in bytes (0 = listing minimum)
            const sessionResult = await createSessionFromListing({
                listing_id: listing.id,
                type: listing.proxy_type === 'sticky' ? 'sticky' : 'rotating',
                bandwidth_limit: bandwidthLimitBytes,
            });

            setCredentials(sessionResult.proxy_credentials);
            onSuccess(order.id, sessionResult.proxy_credentials);
        } catch (err: unknown) {
            console.error(err);
            setError(getErrorMessage(err) || 'Failed to connect. Check your SOL wallet balance.');
        } finally {
            setLoading(false);
        }
    };

    // Success: show proxy credentials
    if (credentials) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <div className="bg-[#0a0a0a] border border-green-500/20 rounded-3xl p-8 max-w-md w-full space-y-6 animate-in fade-in zoom-in duration-300">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                            <CheckCircle size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white">Connected!</h2>
                            <p className="text-xs text-muted-foreground">Pay-as-you-go billing is active</p>
                        </div>
                    </div>

                    <div className="space-y-3 bg-white/5 rounded-2xl p-4 border border-white/10">
                        <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Proxy Credentials</p>
                        {[
                            { label: 'Endpoint', value: credentials.endpoint, key: 'endpoint' },
                            { label: 'Username', value: credentials.username, key: 'username' },
                        ].map(({ label, value, key }) => (
                            <div key={key} className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-[9px] text-white/30 uppercase tracking-widest">{label}</p>
                                    <p className="text-xs font-mono text-white/80 break-all">{value}</p>
                                </div>
                                <button
                                    onClick={() => copyToClipboard(value, key)}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors flex-shrink-0"
                                >
                                    {copied === key ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
                                </button>
                            </div>
                        ))}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] text-white/30 uppercase tracking-widest">Password</p>
                                <p className="text-xs font-mono text-white/80 break-all">
                                    {showPass ? credentials.password : '••••••••••••'}
                                </p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                                <button
                                    onClick={() => setShowPass(v => !v)}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                >
                                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                                <button
                                    onClick={() => copyToClipboard(credentials.password, 'password')}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                >
                                    {copied === 'password' ? <CheckCircle size={14} className="text-green-500" /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <p className="text-[10px] text-white/30 leading-relaxed">
                        Configure your client using <span className="text-white/60">HTTP proxy</span> with the credentials above.
                        Billing is hourly — session auto-terminates when bandwidth quota is reached.
                    </p>

                    <button
                        onClick={onClose}
                        className="w-full py-3 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-400 font-black text-sm uppercase tracking-widest hover:bg-green-500/20 transition-all"
                    >
                        Done
                    </button>
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
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">

                    {/* Listing Summary */}
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex gap-4 items-start">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex-shrink-0 flex items-center justify-center text-white font-black">
                            {listing.proxy_type?.[0]?.toUpperCase()}
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
                            <AlertCircle size={14} /> Pay-As-You-Go Billing
                        </h4>
                        <p className="text-xs text-blue-200/80 leading-relaxed">
                            Charged hourly from your SOL wallet based on actual bandwidth consumed.
                            Session auto-terminates when quota is exhausted.
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
                                <span>AVAIL: {listing.available_bandwidth_gb || 'UNLIMITED'}</span>
                            </div>
                        </div>

                        <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/5">
                            <div>
                                <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-1">Estimated Total</p>
                                <p className="font-mono text-2xl font-black text-emerald-400">{estimatedCostUSD.toFixed(6)} SOL</p>
                            </div>
                            <div className="text-right">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-white/30 mb-1">Rate</p>
                                <p className="text-xs font-mono text-white/60">{listing.price_per_gb.toFixed(6)} SOL/GB</p>
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
                        Session auto-terminates when bandwidth quota or SOL balance is exhausted.
                    </p>

                </div>
            </div>
        </div>
    );
}
