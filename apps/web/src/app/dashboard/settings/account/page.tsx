"use client";

import { useEffect, useCallback } from 'react';
import { getWallet, getMyProfile, Wallet as WalletType, UserPublicProfile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Shield, Wallet, Zap, Activity, Info, AlertCircle, CheckCircle, Smartphone, Link as LinkIcon, ArrowUpRight, Coins, Loader2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { SolanaWalletButton } from '@/components/SolanaWalletButton';
import { DeleteAccountPanel } from '@/components/settings/DeleteAccountPanel';

const TIER_LIMITS = {
    new: { rpm: 10, bandwidth: '5 GB', concurrency: 3, automation: false },
    verified: { rpm: 100, bandwidth: '50 GB', concurrency: 10, automation: true },
    premium: { rpm: 1000, bandwidth: 'Unlimited', concurrency: 100, automation: true },
};

export default function AccountSettingsPage() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { connected, publicKey, disconnect } = useSolanaWallet();
    const { data: wallet, isLoading: walletLoading } = useQuery({
        queryKey: ['wallet'],
        queryFn: () => getWallet(),
        enabled: !!user,
    });

    const { data: profile, isLoading: profileLoading } = useQuery({
        queryKey: ['profile', 'me'],
        queryFn: () => getMyProfile(),
        enabled: !!user,
    });

    const tier = profile?.trust_tier || 'new';
    const limits = TIER_LIMITS[tier as keyof typeof TIER_LIMITS] || TIER_LIMITS.new;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-700">
            {/* Header Content */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
                <div>
                    <h2 className="text-2xl font-black font-mono uppercase tracking-tighter flex items-center gap-2">
                        System Entitlement
                        <Zap size={20} className="text-primary" />
                    </h2>
                    <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-1 opacity-60">
                        Tier Status & Network Resource Allocation
                    </p>
                </div>
            </div>

            {/* KYC & Balance Alert */}
            {profile?.kyc_status === 'insufficient_funds' && (
                <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-sm flex items-start gap-4 animate-pulse">
                    <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={20} />
                    <div className="space-y-1">
                        <p className="text-[11px] font-black font-mono uppercase text-amber-500 tracking-tighter">Verification Blocked: Insufficient Gas</p>
                        <p className="text-[10px] font-mono text-muted-foreground leading-tight uppercase opacity-80">
                            YOUR LINKED WALLET MUST MAINTAIN A MINIMUM OF <span className="text-amber-500 font-bold">0.05 SOL</span> TO COMPLETE TRUST TIER UPGRADE. 
                            CURRENT LINKED BALANCE IS BELOW THRESHOLD.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Tier Card */}
                <div className="lg:col-span-2 space-y-6">
                    <div className="p-8 bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 rounded-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                            <Shield size={120} />
                        </div>
                        
                        <div className="flex justify-between items-start mb-8">
                            <div>
                                <h3 className="text-[9px] font-black font-mono text-primary uppercase tracking-[0.4em] mb-2 opacity-60 italic">Operational Tier</h3>
                                <h4 className="text-4xl font-black font-mono uppercase tracking-tighter text-white">
                                    {tier}
                                </h4>
                            </div>
                            <div className="px-3 py-1 bg-primary/20 border border-primary/30 rounded-full">
                                <span className="text-[9px] font-black font-mono text-primary uppercase tracking-widest">Active Level</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-8">
                            <div className="space-y-1">
                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Throughput Cap</p>
                                <p className="text-sm font-bold font-mono text-white uppercase">{limits.bandwidth}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Velocity Limit</p>
                                <p className="text-sm font-bold font-mono text-white uppercase">{limits.rpm} RPM</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[8px] font-black font-mono text-muted-foreground uppercase tracking-widest opacity-40">Concurrency</p>
                                <p className="text-sm font-bold font-mono text-white uppercase">{limits.concurrency} Nodes</p>
                            </div>
                        </div>
                    </div>

                    {/* Resources Progress */}
                    <div className="space-y-4">
                        <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] opacity-40">Quota Utilization</h3>
                        <div className="space-y-6 p-6 bg-white/[0.01] border border-white/5 rounded-sm">
                            <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-mono font-black uppercase">
                                    <span className="text-muted-foreground/60">Bandwidth (Monthly)</span>
                                    <span className="text-primary">0.00 / {limits.bandwidth}</span>
                                </div>
                                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary w-[2%] shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-mono font-black uppercase">
                                    <span className="text-muted-foreground/60">Concurrent Streams</span>
                                    <span className="text-primary">0 / {limits.concurrency}</span>
                                </div>
                                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary w-0 shadow-[0_0_8px_rgba(var(--primary),0.5)]" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Account Actions / Wallet Snippet */}
                <div className="space-y-6">
                    <div className="p-6 bg-white/[0.01] border border-white/5 rounded-sm space-y-6">
                        <h3 className="text-[9px] font-black font-mono text-muted-foreground uppercase tracking-[0.4em] opacity-40">Settlement Node</h3>
                        
                        <div className="space-y-4">
                            <div className="p-4 bg-black/40 border border-white/5 rounded-sm space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[9px] font-black font-mono uppercase opacity-40">Linked Address</span>
                                    {wallet?.linked_solana_address && <CheckCircle size={10} className="text-emerald-500" />}
                                </div>
                                <div className="text-[10px] font-mono font-bold break-all opacity-80 bg-white/5 p-2 rounded-sm border border-white/5">
                                    {wallet?.linked_solana_address || 'NO WALLET LINKED'}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-sm">
                                    <p className="text-[8px] font-black font-mono text-muted-foreground uppercase opacity-40 mb-1">Treasury Balance</p>
                                    <p className="text-xs font-black font-mono text-primary uppercase">
                                        {walletLoading ? '...' : Number(wallet?.balance_sol ?? 0).toFixed(4)} SOL
                                    </p>
                                </div>
                                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-sm">
                                    <p className="text-[8px] font-black font-mono text-muted-foreground uppercase opacity-40 mb-1">Tier Multiplier</p>
                                    <p className="text-xs font-black font-mono text-white uppercase">
                                        {tier === 'premium' ? 'x5.0' : tier === 'verified' ? 'x2.0' : 'x1.0'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <button 
                            onClick={() => window.location.href = '/dashboard/wallet'}
                            className="w-full py-3 border border-primary/20 hover:border-primary bg-primary/5 text-primary text-[10px] font-black font-mono uppercase tracking-widest transition-all rounded-sm flex items-center justify-center gap-3 group"
                        >
                            Open Financial Central
                            <ArrowUpRight size={14} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                        </button>
                    </div>

                    <div className="p-6 bg-secondary/10 border border-white/5 rounded-sm space-y-4">
                        <div className="flex items-center gap-2 text-primary">
                            <Info size={14} />
                            <h4 className="text-[10px] font-black font-mono uppercase tracking-widest">Upgrade Intel</h4>
                        </div>
                        <p className="text-[9px] font-mono text-muted-foreground leading-relaxed uppercase opacity-80">
                            VERIFIED TIER UNLOCKS UNRESTRICTED AUTOMATION AND HIGH-CAPACITY BANDWIDTH SEGMENTS. 
                            REQUIRES ON-CHAIN IDENTITY PROOF.
                        </p>
                    </div>
                </div>
            </div>

            <DeleteAccountPanel />
        </div>
    );
}
