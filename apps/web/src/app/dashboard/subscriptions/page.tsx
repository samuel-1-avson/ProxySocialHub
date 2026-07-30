"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Layers, CheckCircle2, AlertCircle } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import {
    cancelSubscription,
    changePlan,
    getMySubscription,
    getSubscriptionPlans,
    subscribeToPlan,
    type SubscriptionPlan,
    type UserSubscription,
} from "@/lib/api/subscriptions";
import { getErrorMessage } from "@/lib/utils";
import Link from "next/link";
import { ROUTES } from "@/lib/navigation/routes";

function planBandwidthLabel(plan: SubscriptionPlan): string {
    if (plan.bandwidth_limit_gb == null) return "Unlimited GB / period";
    return `${plan.bandwidth_limit_gb} GB / period`;
}

function isFreePlan(plan: SubscriptionPlan): boolean {
    return plan.name.toLowerCase() === "free" || Number(plan.price_monthly || 0) <= 0;
}

export default function SubscriptionsPage() {
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [subscription, setSubscription] = useState<UserSubscription | null>(null);
    const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan | null>(null);
    const [loading, setLoading] = useState(true);
    const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [planList, mine] = await Promise.all([getSubscriptionPlans(), getMySubscription()]);
            setPlans(Array.isArray(planList) ? planList : []);
            setSubscription(mine.subscription);
            setCurrentPlan(mine.current_plan);
        } catch (err) {
            setError(getErrorMessage(err) || "Failed to load subscription data");
            setPlans([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const entitledPlanId = useMemo(() => {
        return subscription?.plan_id || currentPlan?.id || null;
    }, [subscription, currentPlan]);

    const accessUntil = subscription?.current_period_end
        ? new Date(subscription.current_period_end).toLocaleString()
        : null;

    const autoRenewActive =
        !!subscription &&
        subscription.status === "active" &&
        !subscription.cancelled_at;

    async function handleSelectPlan(plan: SubscriptionPlan) {
        setBusyPlanId(plan.id);
        setMessage(null);
        setError(null);
        try {
            if (subscription && subscription.status === "active" && !subscription.cancelled_at) {
                if (subscription.plan_id === plan.id) {
                    setMessage("You are already on this plan.");
                    return;
                }
                const result = await changePlan(plan.id);
                setMessage(result.message || `Switched to ${plan.name}`);
            } else {
                await subscribeToPlan(plan.id, "monthly");
                setMessage(`Subscribed to ${plan.name}. Auto-renew runs from your custodial SOL balance.`);
            }
            await load();
        } catch (err) {
            setError(getErrorMessage(err) || "Plan update failed");
        } finally {
            setBusyPlanId(null);
        }
    }

    async function handleCancel() {
        setBusyPlanId("cancel");
        setMessage(null);
        setError(null);
        try {
            const result = await cancelSubscription("user_cancelled");
            setMessage(
                result.message ||
                    "Subscription cancelled. Access continues until the period ends; auto-renew is off.",
            );
            await load();
        } catch (err) {
            setError(getErrorMessage(err) || "Cancel failed");
        } finally {
            setBusyPlanId(null);
        }
    }

    return (
        <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-2">
                        Plans &amp; billing
                    </p>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-3">
                        <Layers className="text-emerald-400" size={28} />
                        Subscriptions
                    </h1>
                    <p className="text-sm text-white/50 mt-2 max-w-xl">
                        Paid plans unlock higher marketplace bandwidth quotas. Renewals debit custodial
                        SOL automatically unless you cancel.
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
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Current entitlement</p>
                {loading ? (
                    <div className="flex items-center gap-2 text-white/50 text-sm">
                        <Loader2 size={16} className="animate-spin" /> Loading…
                    </div>
                ) : (
                    <>
                        <p className="text-xl font-black text-white capitalize">
                            {currentPlan?.name || subscription?.plan?.name || "Free"}
                        </p>
                        <div className="flex flex-wrap gap-3 text-xs font-mono text-white/50">
                            <span>Status: {subscription?.status || "none"}</span>
                            {accessUntil && <span>Period ends: {accessUntil}</span>}
                            <span>
                                Auto-renew:{" "}
                                {autoRenewActive ? (
                                    <span className="text-emerald-400">on</span>
                                ) : (
                                    <span className="text-white/40">off</span>
                                )}
                            </span>
                        </div>
                        {currentPlan && (
                            <p className="text-sm text-white/60">
                                {planBandwidthLabel(currentPlan)} · {currentPlan.listing_limit} listings
                            </p>
                        )}
                        <div className="flex flex-wrap gap-3 pt-2">
                            {autoRenewActive && (
                                <button
                                    type="button"
                                    disabled={busyPlanId === "cancel"}
                                    onClick={() => void handleCancel()}
                                    className="px-4 py-2 rounded-xl border border-white/15 text-xs font-bold uppercase tracking-widest text-white/80 hover:bg-white/5 disabled:opacity-50"
                                >
                                    {busyPlanId === "cancel" ? "Cancelling…" : "Cancel auto-renew"}
                                </button>
                            )}
                            <Link
                                href={ROUTES.dashboardWallet}
                                className="px-4 py-2 rounded-xl border border-white/15 text-xs font-bold uppercase tracking-widest text-white/80 hover:bg-white/5"
                            >
                                Fund wallet
                            </Link>
                        </div>
                        <p className="text-[11px] text-white/35 leading-relaxed">
                            Cancelling keeps access until the period end, then you drop to Free. Keep custodial
                            SOL funded so renewals succeed; failed renewals mark the plan past due.
                        </p>
                    </>
                )}
            </GlassCard>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => {
                    const selected = entitledPlanId === plan.id;
                    const monthly = Number(plan.price_monthly || 0);
                    return (
                        <GlassCard key={plan.id} className="p-5 flex flex-col gap-4">
                            <div>
                                <p className="text-lg font-black text-white capitalize">{plan.name}</p>
                                {plan.description && (
                                    <p className="text-xs text-white/45 mt-1">{plan.description}</p>
                                )}
                            </div>
                            <p className="font-mono text-2xl font-black text-emerald-400">
                                {isFreePlan(plan) ? "Free" : `$${monthly.toFixed(2)}`}
                                {!isFreePlan(plan) && (
                                    <span className="text-xs text-white/40 font-bold ml-1">/ mo</span>
                                )}
                            </p>
                            <ul className="text-xs text-white/55 space-y-1 font-mono">
                                <li>{planBandwidthLabel(plan)}</li>
                                <li>{plan.listing_limit} listings</li>
                                {plan.priority_support && <li>Priority support</li>}
                            </ul>
                            <button
                                type="button"
                                disabled={loading || selected || busyPlanId === plan.id}
                                onClick={() => void handleSelectPlan(plan)}
                                className="mt-auto w-full py-3 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest disabled:opacity-40 hover:bg-white/90"
                            >
                                {busyPlanId === plan.id
                                    ? "Working…"
                                    : selected
                                      ? "Current plan"
                                      : autoRenewActive
                                        ? "Switch plan"
                                        : "Subscribe"}
                            </button>
                        </GlassCard>
                    );
                })}
            </div>

            {!loading && plans.length === 0 && (
                <p className="text-sm text-white/40">No plans are published yet.</p>
            )}
        </div>
    );
}
