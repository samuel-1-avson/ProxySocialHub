"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    generateReferralCode,
    getMyRewards,
    getReferralStats,
    type ReferralReward,
    type ReferralStats,
} from "@/lib/api/referral";
import { GlassCard } from "@/components/ui/glass-card";
import { ROUTES } from "@/lib/navigation/routes";
import { Copy, Gift, Loader2, RefreshCw } from "lucide-react";

export default function ReferralPage() {
    const { isAuthenticated } = useAuth();
    const [stats, setStats] = useState<ReferralStats | null>(null);
    const [rewards, setRewards] = useState<ReferralReward[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
        setLoading(true);
        setError("");
        try {
            const [s, r] = await Promise.all([getReferralStats(), getMyRewards()]);
            setStats(s);
            setRewards(r || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load referral data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAuthenticated) void refresh();
        else setLoading(false);
    }, [isAuthenticated]);

    if (!isAuthenticated) {
        return (
            <div className="max-w-3xl mx-auto py-16 px-4 text-center space-y-4">
                <Gift className="mx-auto text-primary" size={32} />
                <h1 className="text-2xl font-black uppercase tracking-tight">Referrals</h1>
                <p className="text-sm text-muted-foreground">Sign in to get your referral code and track rewards.</p>
                <Link href={ROUTES.login} className="text-primary text-sm font-bold uppercase tracking-widest">
                    Sign in
                </Link>
            </div>
        );
    }

    const code = stats?.referral_code || "";
    const [inviteOrigin, setInviteOrigin] = useState("");
    useEffect(() => {
        setInviteOrigin(window.location.origin);
    }, []);
    const inviteLink = code
        ? `${inviteOrigin || ""}${ROUTES.register}?ref=${encodeURIComponent(code)}`
        : "";

    return (
        <div className="max-w-3xl mx-auto py-10 px-4 space-y-8" data-testid="community-referrals">
            <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary mb-2">Community</p>
                <h1 className="text-3xl font-black uppercase tracking-tight italic">
                    Invite <span className="text-primary">&amp; earn</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-2">
                    Share your invite link. Earn rewards when new users create an account with your code.
                </p>
            </div>

            {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">{error}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-primary" />
                </div>
            ) : (
                <>
                    <GlassCard className="!p-6 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    Your code
                                </p>
                                <p className="text-2xl font-mono font-black mt-1">{code || "—"}</p>
                                {inviteLink ? (
                                    <p className="mt-2 text-[10px] font-mono text-muted-foreground break-all">
                                        {inviteLink}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    disabled={!inviteLink}
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(inviteLink);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 1500);
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-widest"
                                >
                                    <Copy size={12} /> {copied ? "Copied link" : "Copy invite link"}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={async () => {
                                        setBusy(true);
                                        try {
                                            await generateReferralCode();
                                            await refresh();
                                        } catch (e) {
                                            setError(e instanceof Error ? e.message : "Failed to generate code");
                                        } finally {
                                            setBusy(false);
                                        }
                                    }}
                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold uppercase tracking-widest"
                                >
                                    <RefreshCw size={12} /> {code ? "New code" : "Generate"}
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-2">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Referrals</p>
                                <p className="text-xl font-black">{stats?.total_referrals ?? 0}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Rewards</p>
                                <p className="text-xl font-black">{rewards.length}</p>
                            </div>
                        </div>
                    </GlassCard>

                    <GlassCard className="!p-6 space-y-3">
                        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                            Reward history
                        </h2>
                        {rewards.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No rewards yet.</p>
                        ) : (
                            <ul className="space-y-2">
                                {rewards.map((r) => (
                                    <li
                                        key={r.id}
                                        className="flex justify-between text-sm border-b border-white/5 pb-2"
                                    >
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {r.referral_code}
                                        </span>
                                        <span className="font-bold">{r.reward_amount} ({r.status})</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </GlassCard>
                </>
            )}
        </div>
    );
}
