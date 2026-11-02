'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyForProvider, getProviderStatus, type ProviderApplicationResponse } from '@/lib/api/provider';
import { getWallet } from '@/lib/api/wallet';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { ROUTES } from '@/lib/navigation/routes';
import { useWorkspaceStore } from '@/lib/store/workspace-store';
import { GlassCard } from './ui/glass-card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { AlertCircle, CheckCircle2, Loader2, Send, ShieldCheck, Globe, Zap, Wallet } from 'lucide-react';

export function ProviderApplicationForm({
    onApplied,
    embedded = false,
}: {
    onApplied?: (result: ProviderApplicationResponse) => void | Promise<void>;
    embedded?: boolean;
} = {}) {
    const { user, refreshUser } = useAuth();
    const qc = useQueryClient();
    const router = useRouter();
    const setPreferredWorkspace = useWorkspaceStore((state) => state.setPreferredWorkspace);
    const [bandwidth, setBandwidth] = useState('');

    const { data: wallet, isLoading: walletLoading } = useQuery({
        queryKey: ['wallet'],
        queryFn: getWallet,
    });
    const { data: providerStatus, isLoading: providerStatusLoading } = useQuery({
        queryKey: ['provider-status'],
        queryFn: getProviderStatus,
        staleTime: 60_000,
    });

    const minBalance = 0.05;
    const hasLinkedWallet = !!user?.wallet_address;
    const rawSolanaNetwork = wallet?.solana_network || process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
    const solanaNetwork = rawSolanaNetwork === 'mainnet' ? 'mainnet-beta' : rawSolanaNetwork;
    const balanceTokenLabel = solanaNetwork === 'mainnet-beta' ? 'SOL' : `${solanaNetwork} SOL`;
    const minBalanceLabel = `${minBalance} ${balanceTokenLabel}`;
    const linkedWalletBalance = typeof wallet?.on_chain_sol === 'number' ? wallet.on_chain_sol : undefined;
    const hasOnChainBalance = typeof linkedWalletBalance === 'number';
    // Google sign-in providers get a ProxyHubb wallet; the SOL balance rule doesn't apply to them.
    const managedWallet = !!user?.managed_wallet?.address;
    const hasEnoughSol = managedWallet || (hasOnChainBalance ? linkedWalletBalance >= minBalance : true);
    const detectedGeo = providerStatus?.detected_geo;
    const applicationGeo = providerStatus?.application;
    const detectedISP = applicationGeo?.isp && applicationGeo.isp !== 'Unknown ISP'
        ? applicationGeo.isp
        : detectedGeo?.isp;
    const detectedLocation = applicationGeo?.location && applicationGeo.location !== 'Unknown'
        ? applicationGeo.location
        : detectedGeo?.location;
    const hasDetectedGeo = !!detectedGeo?.detected || (!!detectedISP && detectedISP !== 'Unknown ISP') || (!!detectedLocation && detectedLocation !== 'Unknown');

    const mutation = useMutation({
        mutationFn: () => applyForProvider({ bandwidth }),
        onSuccess: async (result) => {
            await qc.invalidateQueries({ queryKey: ['provider-status'] });

            if (result.application.status === 'approved') {
                await refreshUser();
                await qc.invalidateQueries({ queryKey: ['provider-earnings-summary'] });
                await qc.invalidateQueries({ queryKey: ['my-nodes'] });
            }

            if (onApplied) {
                await onApplied(result);
            } else if (result.application.status === 'approved' && !embedded) {
                // Approved straight away: switch the workspace to Provider.
                setPreferredWorkspace('seller');
                router.push(ROUTES.seller);
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
            ? 'bg-success/20 border-success/30 text-success'
            : applicationStatus === 'pending'
                ? 'bg-warning/20 border-warning/30 text-warning'
                : 'bg-destructive/20 border-destructive/30 text-destructive';

        return (
            <GlassCard className="text-center py-10 space-y-4 animate-in fade-in zoom-in duration-500">
                <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center border ${accentClass}`}>
                    {applicationStatus === 'approved' ? (
                        <CheckCircle2 size={32} className="text-success" />
                    ) : applicationStatus === 'pending' ? (
                        <Loader2 size={32} className="text-warning animate-spin" />
                    ) : (
                        <AlertCircle size={32} className="text-destructive" />
                    )}
                </div>
                <div>
                    <h2 className="text-xl font-bold font-mono tracking-tight">{title}</h2>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto mt-2">
                        {description}
                    </p>
                </div>
            </GlassCard>
        );
    }

    return (
        <GlassCard className={embedded
            ? "max-w-xl mx-auto border-border bg-card"
            : "max-w-xl mx-auto border-success/20 bg-success/5"
        }>
            <div className="space-y-8 p-2">
                <div>
                    <div className={`flex items-center gap-2 font-bold text-xs mb-2 ${embedded ? 'text-primary' : 'text-primary'}`}>
                        <ShieldCheck size={14} />
                        Automated Onboarding
                    </div>
                    <h2 className={`text-2xl font-semibold font-sans tracking-tight ${embedded ? 'font-mono not-italic' : ''}`}>
                        Become a Provider
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Submit your bandwidth capacity and the system will decide automatically from objective on-chain constraints.
                    </p>
                    <p className="text-xs font-mono text-muted-foreground mt-3">
                        Active Solana network: {solanaNetwork}
                    </p>
                </div>

                <div className="space-y-6">
                    {/* Auto-Detection Status */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-4 rounded-lg bg-secondary border border-border flex flex-col gap-2 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Globe size={40} />
                            </div>
                            <span className="text-xs font-mono font-bold text-muted-foreground">ISP & Location</span>
                            <div className="flex items-center gap-2">
                                {providerStatusLoading ? (
                                    <>
                                        <Loader2 size={12} className="animate-spin text-muted-foreground" />
                                        <span className="text-xs font-bold">Detecting...</span>
                                    </>
                                ) : hasDetectedGeo ? (
                                    <>
                                        <CheckCircle2 size={12} className="text-success" />
                                        <span className="text-xs font-bold text-success truncate">{detectedISP || 'Network detected'}</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={12} className="text-warning" />
                                        <span className="text-xs font-bold text-warning">Unavailable</span>
                                    </>
                                )}
                            </div>
                            {!providerStatusLoading && hasDetectedGeo && (
                                <p className="text-xs text-muted-foreground font-mono truncate">
                                    {detectedLocation || 'Location pending'}
                                </p>
                            )}
                        </div>
                        <div className="p-4 rounded-lg bg-secondary border border-border flex flex-col gap-2 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Wallet size={40} />
                            </div>
                            <span className="text-xs font-mono font-bold text-muted-foreground">
                                {managedWallet ? 'Payout Wallet' : 'Linked Wallet Balance'}
                            </span>
                            <div className="flex items-center gap-2">
                                {managedWallet ? (
                                    <>
                                        <CheckCircle2 size={12} className="text-success" />
                                        <span className="text-xs font-bold text-success">ProxyHubb wallet ready</span>
                                    </>
                                ) : walletLoading ? (
                                    <Loader2 size={12} className="animate-spin text-muted-foreground" />
                                ) : !hasLinkedWallet ? (
                                    <>
                                        <AlertCircle size={12} className="text-warning" />
                                        <span className="text-xs font-bold text-warning">Link wallet first</span>
                                    </>
                                ) : !hasOnChainBalance ? (
                                    <>
                                        <AlertCircle size={12} className="text-warning" />
                                        <span className="text-xs font-bold text-warning">Awaiting {solanaNetwork} check</span>
                                    </>
                                ) : hasEnoughSol ? (
                                    <>
                                        <CheckCircle2 size={12} className="text-success" />
                                        <span className="text-xs font-bold text-success">{linkedWalletBalance?.toFixed(3)} {balanceTokenLabel}</span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={12} className="text-destructive" />
                                        <span className="text-xs font-bold text-destructive">{linkedWalletBalance?.toFixed(3)} / {minBalanceLabel}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-mono font-bold text-muted-foreground flex items-center gap-2">
                            <Zap size={12} className="text-warning" />
                            Estimated Upload Bandwidth
                        </label>
                        <Input 
                            placeholder="e.g. 1Gbps Fiber, 500Mbps Starlink"
                            value={bandwidth}
                            onChange={(e) => setBandwidth(e.target.value)}
                            className="h-12 bg-secondary border-border rounded-lg focus:ring-primary/50"
                        />
                    </div>

                    {!hasLinkedWallet && (
                        <div className="p-4 rounded-lg bg-warning/10 border border-warning/20 flex gap-3 items-start">
                            <AlertCircle size={18} className="text-warning shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-warning font-mono">Wallet Required</p>
                                <p className="text-xs text-muted-foreground">You must link a Solana wallet in Settings before applying.</p>
                            </div>
                        </div>
                    )}

                    {hasLinkedWallet && hasOnChainBalance && !hasEnoughSol && !walletLoading && (
                        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 flex gap-3 items-start">
                            <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-destructive font-mono">Insufficient Funds</p>
                                <p className="text-xs text-muted-foreground">A minimum of {minBalanceLabel} is required in your linked wallet before automatic provider approval can succeed. Development stacks use devnet SOL by default.</p>
                            </div>
                        </div>
                    )}

                    {managedWallet && (
                        <div className="p-4 rounded-lg bg-success/10 border border-success/20 flex gap-3 items-start">
                            <CheckCircle2 size={18} className="text-success shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-success font-mono">No crypto needed</p>
                                <p className="text-xs text-muted-foreground">Your earnings go to your ProxyHubb wallet. You can cash them out to Mobile Money from the Wallet page.</p>
                            </div>
                        </div>
                    )}

                    {hasLinkedWallet && !walletLoading && !hasOnChainBalance && !managedWallet && (
                        <div className="p-4 rounded-lg bg-warning/10 border border-warning/20 flex gap-3 items-start">
                            <AlertCircle size={18} className="text-warning shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="text-xs font-bold text-warning font-mono">Balance Check Pending</p>
                                <p className="text-xs text-muted-foreground">The linked wallet is required for provider verification. The backend will validate your {balanceTokenLabel} balance when you submit and recheck automatically if verification is temporarily unavailable.</p>
                            </div>
                        </div>
                    )}
                </div>

                {mutation.isError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs font-mono">
                        <AlertCircle size={14} />
                        {errorMessage}
                    </div>
                )}

                <Button 
                    className="w-full h-14 rounded-lg bg-primary hover:bg-success text-primary-foreground font-semibold disabled:opacity-50 disabled:grayscale transition-all"
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
