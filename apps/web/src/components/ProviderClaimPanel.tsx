'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { Loader2, Wallet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import {
    confirmProviderClaim,
    getProviderClaimSummary,
    prepareProviderClaim,
} from '@/lib/api/provider';

export function ProviderClaimPanel() {
    const { publicKey, signMessage, connected } = useWallet();
    const queryClient = useQueryClient();
    const [claiming, setClaiming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<string | null>(null);

    const { data: claim, isLoading } = useQuery({
        queryKey: ['provider-claim-summary'],
        queryFn: getProviderClaimSummary,
        staleTime: 30_000,
    });

    const canClaim =
        claim &&
        claim.oracle_ready &&
        claim.pending_count > 0 &&
        claim.pending_sol >= claim.min_claim_sol &&
        claim.payout_wallet;

    async function handleClaim() {
        setError(null);
        setTxHash(null);
        if (!signMessage || !connected || !publicKey) {
            setError('Connect the Solana wallet that matches your provider payout address.');
            return;
        }
        if (!canClaim) return;

        setClaiming(true);
        try {
            const prepared = await prepareProviderClaim();
            const encoded = new TextEncoder().encode(prepared.message);
            const sigBytes = await signMessage(encoded);
            const signature = bs58.encode(sigBytes);

            const result = await confirmProviderClaim({
                claim_id: prepared.claim_id,
                message: prepared.message,
                signature,
            });

            setTxHash(result.tx_hash ?? null);
            await queryClient.invalidateQueries({ queryKey: ['provider-claim-summary'] });
            await queryClient.invalidateQueries({ queryKey: ['provider-earnings-summary'] });
            await queryClient.invalidateQueries({ queryKey: ['provider-earnings'] });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Claim failed');
        } finally {
            setClaiming(false);
        }
    }

    if (isLoading) {
        return null;
    }

    if (!claim || claim.pending_sol <= 0) {
        return null;
    }

    return (
        <GlassCard className="p-6 border-violet-500/20 bg-violet-500/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-violet-400 font-mono text-[10px] font-bold uppercase tracking-widest mb-2">
                        <Wallet size={14} />
                        Manual on-chain claim
                    </div>
                    <p className="text-sm text-muted-foreground max-w-xl">
                        Batch payouts run automatically when configured. Use this when you have at least{' '}
                        {claim.min_claim_sol} SOL pending and want to pull funds to{' '}
                        <code className="text-violet-300">{claim.payout_wallet || 'your node payout wallet'}</code>.
                    </p>
                    {!claim.oracle_ready && (
                        <p className="text-xs text-amber-500 mt-2 flex items-center gap-1">
                            <AlertCircle size={12} /> Oracle is not ready — claims are temporarily unavailable.
                        </p>
                    )}
                    {error && (
                        <p className="text-xs text-red-400 mt-2">{error}</p>
                    )}
                    {txHash && (
                        <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Claim submitted — tx {txHash.slice(0, 16)}…
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    disabled={!canClaim || claiming}
                    onClick={handleClaim}
                    className="px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 shrink-0"
                >
                    {claiming ? <Loader2 size={14} className="animate-spin" /> : null}
                    Claim {claim.pending_sol.toFixed(4)} SOL
                </button>
            </div>
        </GlassCard>
    );
}
