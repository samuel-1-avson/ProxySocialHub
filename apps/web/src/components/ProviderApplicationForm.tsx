'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyForProvider } from '@/lib/api/provider';
import { getWallet } from '@/lib/api/wallet';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { GlassCard } from './ui/glass-card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { AlertCircle, CheckCircle2, Loader2, Send, ShieldCheck, Globe, Zap, Wallet } from 'lucide-react';

export function ProviderApplicationForm() {
    const { user, refreshUser } = useAuth();
    const qc = useQueryClient();
    const [bandwidth, setBandwidth] = useState('');

    const { data: wallet, isLoading: walletLoading } = useQuery({
        queryKey: ['wallet'],
        queryFn: getWallet,
    });

    const minBalance = 0.05;
    const hasLinkedWallet = !!user?.wallet_address;
    const rawSolanaNetwork = wallet?.solana_network || process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const solanaNetwork = rawSolanaNetwork === 'mainnet' ? 'mainnet-beta' : rawSolanaNetwork;
    const balanceTokenLabel = solanaNetwork === 'mainnet-beta' ? 'SOL' : `${solanaNetwork} SOL`;
    const minBalanceLabel = `${minBalance} ${balanceTokenLabel}`;
    const linkedWalletBalance = typeof wallet?.on_chain_sol === 'number' ? wallet.on_chain_sol : undefined;
    const hasOnChainBalance = typeof linkedWalletBalance === 'number';
    const hasEnoughSol = hasOnChainBalance ? linkedWalletBalance >= minBalance : true;

    const mutation = useMutation({
        mutationFn: () => applyForProvider({ bandwidth }),
        onSuccess: async (result) => {
            await qc.invalidateQueries({ queryKey: ['provider-status'] });

            if (result.application.status === 'approved') {
                await refreshUser();
                await qc.invalidateQueries({ queryKey: ['provider-earnings-summary'] });
                await qc.invalidateQueries({ queryKey: ['my-nodes'] });
            }
        },
        onError: async (error) => {
            if (error instanceof ApiError && error.status === 409) {
                await qc.invalidateQueries({ queryKey: ['provider-status'] });
            }
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: ['provider-status'] });
        },
    });

    const errorMessage = mutation.error instanceof ApiError && mutation.error.status === 409
        ? 'An application already exists for this account. Loading its current status.'
        : (mutation.error as { message?: string } | null)?.message || 'Submission failed';

    if (mutation.isSuccess) {
        const applicationStatus = mutation.data.application.status;
        const title = applicationStatus === 'approved'
            ? 'Application Auto-Approved'
            : applicationStatus === 'pending'
                ? 'Automatic Verification Pending'
                : 'Requirements Not Met Yet';
        const description = mutation.data.eligibility?.reason || (
            applicationStatus === 'approved'
                ? 'Your account has been promoted to provider automatically. The dashboard will switch into provider mode as soon as the refreshed session finishes loading.'
                : applicationStatus === 'pending'
                    ? 'Your application is stored and will be rechecked automatically as soon as on-chain verification is available again.'
                    : 'The application was evaluated immediately, but one or more provider constraints still are not satisfied.'
        );

        const accentClass = applicationStatus === 'approved'
            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
            : applicationStatus === 'pending'
                ? 'bg-amber-500/20 border-amber-500/30 text-amber-400'
                : 'bg-red-500/20 border-red-500/30 text-red-400';

        return (
            <GlassCard className="text-center py-10 space-y-4 animate-in fade-in zoom-in duration-500">
                <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center border ${accentClass}`}>
                    {applicationStatus === 'approved' ? (
                        <CheckCircle2 size={32} className="text-emerald-400" />
                    ) : applicationStatus === 'pending' ? (
                        <Loader2 size={32} className="text-amber-400 animate-spin" />
                    ) : (
                        <AlertCircle size={32} className="text-red-400" />
                    )}
                </div>
                <div>
                    <h2 className="text-xl font-bold font-mono uppercase tracking-tighter">{title}</h2>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-2">
                        {description}
                    </p>
                </div>
            </GlassCard>
        );
    }

    return (
        <GlassCard className="max-w-xl mx-auto border-purple-500/20 bg-purple-500/5">
            <div className="space-y-8 p-2">
                <div>
                    <div className="flex items-center gap-2 text-purple-400 font-bold uppercase tracking-widest text-[10px] mb-2">
                        <ShieldCheck size={14} />
                        Automated Onboarding
                    </div>
                    <h2 className="text-2xl font-black font-sans uppercase italic tracking-tight">Become a Provider</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Submit your bandwidth capacity and the system will decide automatically from objective on-chain constraints.
                    </p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mt-3">
                        Active Solana network: {solanaNetwork}
                    </p>
                </div>

                <div className="space-y-6">
                    {/* Auto-Detection Status */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex flex-col gap-2 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Globe size={40} />
                            </div>
                            <span className="text-[10px] font-mono uppercase font-bold text-muted-foreground">ISP & Location</span>
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-xs font-bold">Auto-Detecting...</span>
                            </div>
                        </div>
                        <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex flex-col gap-2 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Wallet size={40} />
                            </div>
                            <span className="text-[10px] font-mono uppercase font-bold text-muted-foreground">Linked Wallet Balance</span>
                            <div className="flex items-center gap-2">
                                {walletLoading ? (
                                    <Loader2 size={12} className="animate-spin text-muted-foreground" />
                                ) : !hasLinkedWallet ? (
                                    <>
                                        <AlertCircle size={12} className="text-amber-500" />
                                        <span className="text-xs font-bold text-amber-500">Link wallet first</span>
                                    </>
                                ) : !hasOnChainBalance ? (
                                    <>
                                        <AlertCircle size={12} className="text-amber-500" />
                                        <span className="text-xs font-bold text-amber-500">Awaiting {solanaNetwork} check</span>
                                    </>
                                ) : hasEnoughSol ? (
                                    <>
                                        <CheckCircle2 size={12} className="text-emerald-500" />
                                        <span className="text-xs font-bold text-emerald-500">{linkedWalletBalance?.toFixed(3)} {balanceTokenLabel}</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={12} className="text-red-400" />
                                        <span className="text-xs font-bold text-red-500">{linkedWalletBalance?.toFixed(3)} / {minBalanceLabel}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-mono uppercase font-bold text-muted-foreground flex items-center gap-2">
                            <Zap size={12} className="text-amber-500" />
                            Estimated Upload Bandwidth
                        </label>
                        <Input 
                            placeholder="e.g. 1Gbps Fiber, 500Mbps Starlink"
                            value={bandwidth}
                            onChange={(e) => setBandwidth(e.target.value)}
                            className="h-12 bg-white/5 border-white/10 rounded-xl focus:ring-purple-500/50"
                        />
                    </div>

                    {!hasLinkedWallet && (
                        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3 items-start">
                            <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-amber-500 uppercase font-mono">Wallet Required</p>
                                <p className="text-[11px] text-muted-foreground">You must link a Solana wallet in Settings before applying.</p>
                            </div>
                        </div>
                    )}

                    {hasLinkedWallet && hasOnChainBalance && !hasEnoughSol && !walletLoading && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex gap-3 items-start">
                            <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-red-500 uppercase font-mono">Insufficient Funds</p>
                                <p className="text-[11px] text-muted-foreground">A minimum of {minBalanceLabel} is required in your linked wallet before automatic provider approval can succeed. Development stacks use devnet SOL by default.</p>
                            </div>
                        </div>
                    )}

                    {hasLinkedWallet && !walletLoading && !hasOnChainBalance && (
                        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3 items-start">
                            <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-amber-500 uppercase font-mono">Balance Check Pending</p>
                                <p className="text-[11px] text-muted-foreground">The linked wallet is required for provider verification. The backend will validate your {balanceTokenLabel} balance when you submit and recheck automatically if verification is temporarily unavailable.</p>
                            </div>
                        </div>
                    )}
                </div>

                {mutation.isError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-[11px] font-mono">
                        <AlertCircle size={14} />
                        {errorMessage}
                    </div>
                )}

                <Button 
                    className="w-full h-14 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black uppercase italic tracking-widest shadow-[0_0_20px_rgba(168,85,247,0.2)] disabled:opacity-50 disabled:grayscale transition-all"
                    disabled={!bandwidth || !hasLinkedWallet || !hasEnoughSol || mutation.isPending}
                    onClick={() => mutation.mutate()}
                >
                    {mutation.isPending ? (
                        <Loader2 size={20} className="animate-spin" />
                    ) : (
                        <div className="flex items-center justify-center gap-2">
                            Submit Application
                            <Send size={18} />
                        </div>
                    )}
                </Button>
            </div>
        </GlassCard>
    );
}
