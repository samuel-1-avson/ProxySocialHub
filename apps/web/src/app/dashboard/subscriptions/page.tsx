"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Layers, CheckCircle2, AlertCircle, Wallet } from "lucide-react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { GlassCard } from "@/components/ui/glass-card";
import {
    confirmPassPurchase,
    getMyPass,
    getPassCatalog,
    getPassMigration,
    preparePassPurchase,
    type MyPassResponse,
    type PassCatalogItem,
    type PassMigrationResponse,
} from "@/lib/api/passes";
import { getConnection } from "@/lib/solana";
import { formatSolanaWalletError, sendSolTransfer } from "@/lib/solana-transfer";
import { UnlockWalletPrompt } from "@/components/UnlockWalletPrompt";
import { MoneyRailHint } from "@/components/MoneyRailHint";
import { getErrorMessage } from "@/lib/utils";
import Link from "next/link";
import { ROUTES } from "@/lib/navigation/routes";

function bandwidthLabel(item: PassCatalogItem): string {
    if (item.bandwidth_limit_gb == null) return "Unlimited GB / period";
    return `${item.bandwidth_limit_gb} GB / period`;
}

export default function AccessPassesPage() {
    const { connected, publicKey, signTransaction, sendTransaction } = useSolanaWallet();
    const [catalog, setCatalog] = useState<PassCatalogItem[]>([]);
    const [treasury, setTreasury] = useState("");
    const [me, setMe] = useState<MyPassResponse | null>(null);
    const [migration, setMigration] = useState<PassMigrationResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [busyTier, setBusyTier] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [cat, mine, mig] = await Promise.all([
                getPassCatalog(),
                getMyPass(),
                getPassMigration().catch(() => null),
            ]);
            setCatalog(Array.isArray(cat.passes) ? cat.passes : []);
            setTreasury(cat.treasury || "");
            setMe(mine);
            setMigration(mig);
        } catch (err) {
            setError(getErrorMessage(err) || "Failed to load Access Passes");
            setCatalog([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function handleMint(item: PassCatalogItem) {
        if (item.tier === "none") return;
        setBusyTier(item.tier);
        setMessage(null);
        setError(null);
        try {
            if (item.purchase_url) {
                window.open(item.purchase_url, "_blank", "noopener,noreferrer");
                setMessage(`Opened purchase flow for ${item.name}. After you hold the NFT, refresh this page.`);
                return;
            }
            if (!connected || !publicKey) {
                setError(
                    me?.wallet
                        ? `Unlock your linked wallet (${me.wallet.slice(0, 4)}…${me.wallet.slice(-4)}) to sign the Access Pass payment.`
                        : "Unlock your Solana wallet to sign the Access Pass payment. You're already signed in.",
                );
                return;
            }
            const prepared = await preparePassPurchase(item.tier);
            if (prepared.mode === "external" && prepared.purchase_url) {
                window.open(prepared.purchase_url, "_blank", "noopener,noreferrer");
                setMessage(`Opened purchase flow for ${item.name}.`);
                return;
            }
            if (!prepared.treasury || !prepared.amount_lamports) {
                setError("Purchase destination not configured.");
                return;
            }
            if (me?.wallet && me.wallet !== publicKey.toBase58()) {
                setError(`Pay from your linked wallet (${me.wallet.slice(0, 4)}…${me.wallet.slice(-4)}).`);
                return;
            }
            const connection = getConnection();
            const sig = await sendSolTransfer(
                connection,
                { publicKey, signTransaction, sendTransaction },
                new PublicKey(prepared.treasury),
                prepared.amount_lamports,
            );
            await confirmPassPurchase({
                tx_signature: sig,
                purchase_id: prepared.purchase_id,
                tier: item.tier,
            });
            setMessage(
                `Payment confirmed for ${item.name}. Entitlement is active; NFT mint/transfer to your wallet completes on-chain ownership.`,
            );
            await load();
        } catch (err) {
            setError(formatSolanaWalletError(err) || getErrorMessage(err) || "Purchase failed");
        } finally {
            setBusyTier(null);
        }
    }

    const currentTier = me?.tier || "none";
    const legacyUntil = me?.legacy_access_until
        ? new Date(me.legacy_access_until).toLocaleString()
        : null;

    return (
        <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">
                        Entitlements
                    </p>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-3">
                        <Layers className="text-emerald-400" size={28} />
                        Access Passes
                    </h1>
                    <p className="text-sm text-white/50 mt-2 max-w-xl">
                        Hold a Bronze, Silver, or Gold pass NFT in your linked wallet for higher marketplace
                        quotas. Mint payment uses your <span className="text-white/70">linked Solana wallet</span>
                        {" "}(not platform balance). Bandwidth is still purchased via escrow.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-xs font-bold uppercase tracking-widest text-white/70 hover:bg-white/5"
                >
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    Refresh
                </button>
            </div>

            <MoneyRailHint rail="linked" />

            {error && (
                <div className="flex items-start gap-2 p-4 rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {message && (
                <div className="flex items-start gap-2 p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-sm">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    <span>{message}</span>
                </div>
            )}

            <GlassCard className="p-5 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Current pass</p>
                {loading ? (
                    <div className="flex items-center gap-2 text-white/50 text-sm">
                        <Loader2 size={16} className="animate-spin" /> Loading…
                    </div>
                ) : (
                    <>
                        <p className="text-xl font-black text-white capitalize">{me?.name || currentTier}</p>
                        <div className="flex flex-wrap gap-3 text-xs font-mono text-white/50">
                            <span>Source: {me?.source || "free"}</span>
                            {me?.wallet && (
                                <span className="inline-flex items-center gap-1">
                                    <Wallet size={12} /> {me.wallet.slice(0, 4)}…{me.wallet.slice(-4)}
                                </span>
                            )}
                            {legacyUntil && <span>Legacy grace until: {legacyUntil}</span>}
                        </div>
                        {me && (
                            <p className="text-sm text-white/60">
                                {me.quota.unlimited
                                    ? "Unlimited GB / period"
                                    : `${me.quota.remaining_gb.toFixed(1)} GB remaining of ${me.quota.limit_gb} GB`}
                                {" · "}
                                {me.listing_limit === 0 ? "Unlimited" : me.listing_limit} listings
                            </p>
                        )}
                        {migration?.legacy_grace && migration.airdrop_eligible_tier && (
                            <p className="text-[11px] text-amber-200/80 leading-relaxed">
                                Legacy subscriber: eligible for a one-time {migration.airdrop_eligible_tier} pass
                                airdrop. Access continues until period end, then entitlement is NFT-only.
                            </p>
                        )}
                        <div className="flex flex-wrap gap-3 pt-2">
                            {(!connected || (publicKey && me?.wallet && publicKey.toBase58() !== me.wallet)) && (
                                <div className="w-full">
                                    <UnlockWalletPrompt
                                        expectedAddress={me?.wallet}
                                        mismatch={
                                            !!(
                                                connected &&
                                                publicKey &&
                                                me?.wallet &&
                                                publicKey.toBase58() !== me.wallet
                                            )
                                        }
                                    />
                                </div>
                            )}
                            <Link
                                href={ROUTES.dashboardWallet}
                                className="px-4 py-2 rounded-xl border border-white/15 text-xs font-bold uppercase tracking-widest text-white/80 hover:bg-white/5"
                            >
                                Wallet settings
                            </Link>
                        </div>
                    </>
                )}
            </GlassCard>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {catalog.map((item) => {
                    const selected = currentTier === item.tier || (currentTier === "none" && item.tier === "none");
                    const paid = item.tier !== "none";
                    return (
                        <GlassCard key={item.tier} className="p-5 flex flex-col gap-4">
                            <div>
                                <p className="text-lg font-black text-white">{item.name}</p>
                                <ul className="text-xs text-white/55 space-y-1 font-mono mt-2">
                                    {item.benefits?.map((b) => (
                                        <li key={b}>{b}</li>
                                    )) || (
                                        <>
                                            <li>{bandwidthLabel(item)}</li>
                                            <li>
                                                {item.listing_limit === 0 ? "Unlimited" : item.listing_limit} listings
                                            </li>
                                        </>
                                    )}
                                </ul>
                            </div>
                            <p className="font-mono text-2xl font-black text-emerald-400">
                                {!paid ? "Free" : `${Number(item.price_sol || 0).toFixed(2)} SOL`}
                                {paid && <span className="text-xs text-white/40 font-bold ml-1">once</span>}
                            </p>
                            {item.mint && (
                                <p className="text-[10px] font-mono text-white/30 break-all">Mint {item.mint}</p>
                            )}
                            <button
                                type="button"
                                disabled={loading || !paid || selected || busyTier === item.tier}
                                onClick={() => void handleMint(item)}
                                className="mt-auto w-full py-3 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest disabled:opacity-40 hover:bg-white/90"
                            >
                                {busyTier === item.tier
                                    ? "Working…"
                                    : selected
                                      ? "Current tier"
                                      : !paid
                                        ? "Default"
                                        : item.purchase_url
                                          ? "Buy pass"
                                          : "Mint / buy"}
                            </button>
                        </GlassCard>
                    );
                })}
            </div>

            {treasury && (
                <p className="text-[11px] text-white/30 font-mono">Primary-sale treasury: {treasury}</p>
            )}

            {!loading && catalog.length === 0 && (
                <p className="text-sm text-white/40">No Access Passes are published yet.</p>
            )}
        </div>
    );
}
