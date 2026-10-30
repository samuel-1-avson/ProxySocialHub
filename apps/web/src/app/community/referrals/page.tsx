"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
    generateReferralCode,
    getMyRewards,
    getReferralStats,
    type ReferralReward,
    type ReferralStats,
} from "@/lib/api/referral";
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
    const [inviteOrigin, setInviteOrigin] = useState("");

    const refresh = useCallback(async () => {
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
    }, []);

    useEffect(() => {
        if (isAuthenticated) void refresh();
        else setLoading(false);
    }, [isAuthenticated, refresh]);

    useEffect(() => {
        setInviteOrigin(window.location.origin);
    }, []);

    const code = stats?.referral_code || "";
    const inviteLink = code
        ? `${inviteOrigin || ""}${ROUTES.register}?ref=${encodeURIComponent(code)}`
        : "";

    if (!isAuthenticated) {
        return (
            <div className="ui-surface mx-auto max-w-3xl space-y-4 text-center">
                <Gift className="mx-auto text-primary" size={32} />
                <h2 className="text-xl font-semibold tracking-tight">Referrals</h2>
                <p className="text-sm text-muted-foreground">Sign in to get your referral code and track rewards.</p>
                <Link href={ROUTES.login} className="ui-button w-fit mx-auto">
                    Sign in
                </Link>
            </div>
        );
    }

    return (
        <div className="ui-page" data-testid="account-referrals">
            <div className="ui-surface">
                <p className="ui-eyebrow">Account utility</p>
                <h2>Referrals</h2>
                <p className="ui-note mt-2">Manage your invitation code and review rewards reported by the referral service.</p>
            </div>

            {error && (
                <div className="ui-error" role="alert">{error}</div>
            )}

            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="animate-spin text-primary" />
                </div>
            ) : (
                <>
                    <section className="ui-surface ui-page">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-bold text-muted-foreground">
                                    Your code
                                </p>
                                <p className="text-2xl font-mono font-semibold mt-1">{code || "Not set"}</p>
                                {inviteLink ? (
                                    <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
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
                                    className="ui-button secondary small"
                                >
                                    <Copy size={12} /> {copied ? "Copied link" : "Copy invite link"}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy || Boolean(code)}
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
                                    className="ui-button secondary small"
                                >
                                    <RefreshCw size={12} /> {code ? "Code issued" : busy ? "Generating…" : "Generate code"}
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
                            <div>
                                <p className="text-xs text-muted-foreground">Attributed referrals</p>
                                <p className="text-xl font-semibold">{typeof stats?.total_referrals === "number" ? stats.total_referrals : "Not reported"}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Reward records</p>
                                <p className="text-xl font-semibold">{rewards.length}</p>
                            </div>
                        </div>
                    </section>

                    <section className="ui-surface ui-page">
                        <h2 className="text-base font-semibold">
                            Reward history
                        </h2>
                        {rewards.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No rewards yet.</p>
                        ) : (
                            <ul className="space-y-2">
                                {rewards.map((r) => (
                                    <li
                                        key={r.id}
                                        className="flex flex-wrap justify-between gap-3 border-b border-border pb-3 text-sm"
                                    >
                                        <span className="font-mono text-xs text-muted-foreground">
                                            {r.referral_code}
                                        </span>
                                        <span>{r.reward_amount} · {r.status.replace(/_/g, " ")}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
