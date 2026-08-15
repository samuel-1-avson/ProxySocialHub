"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Globe,
  Loader2,
  UserRound,
  Wallet,
  Zap,
} from "lucide-react";
import { getMyProfile, updateProfile } from "@/lib/api/profile";
import { getWallet } from "@/lib/api/wallet";
import { getSessions, listSessionIntents } from "@/lib/api/sessions";
import { updateOnboarding, type OnboardingState } from "@/lib/api/onboarding";
import { trackOnboardingEvent } from "@/lib/analytics/onboarding-funnel";
import { ROUTES } from "@/lib/navigation/routes";
import { getErrorMessage } from "@/lib/utils";

const MIN_FUNDED_SOL = 0.01; // legacy platform-balance gate (no longer required for Continue)


type PanelProps = {
  onboarding: OnboardingState;
  onStateChange: (next: OnboardingState) => void;
};

async function completeBuyerStep(
  onboarding: OnboardingState,
  step: "profile" | "fund" | "browse" | "session",
  meta?: Record<string, unknown>,
) {
  let next = onboarding;
  if (!next.steps?.[step]?.completed_at) {
    next = await updateOnboarding({ complete_step: step, step_meta: meta });
    trackOnboardingEvent("step_completed", { step });
  }
  return next;
}

function isProfileComplete(profile: {
  username?: string;
  display_name?: string | null;
} | null | undefined) {
  const username = profile?.username?.trim() || "";
  const displayName = profile?.display_name?.trim() || "";
  return username.length >= 3 && displayName.length >= 2;
}

export function OnboardingProfilePanel({ onboarding, onStateChange }: PanelProps) {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ["my-profile"],
    queryFn: getMyProfile,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (profile?.display_name) {
      setDisplayName(profile.display_name);
    }
  }, [profile?.display_name]);

  const complete = useMutation({
    mutationFn: async () => {
      const next = await completeBuyerStep(onboarding, "profile", {
        username: profile?.username,
        display_name: profile?.display_name || displayName,
      });
      onStateChange(next);
    },
    onError: (err) => setError(getErrorMessage(err) || "Failed to save progress"),
  });

  const saveProfile = useMutation({
    mutationFn: async () => {
      const name = displayName.trim();
      if (name.length < 2) {
        throw new Error("Display name must be at least 2 characters");
      }
      await updateProfile({ display_name: name });
      const refreshed = await refetch();
      if (!isProfileComplete(refreshed.data)) {
        throw new Error("Profile still incomplete — set a display name");
      }
      const next = await completeBuyerStep(onboarding, "profile", {
        username: refreshed.data?.username,
        display_name: name,
      });
      onStateChange(next);
    },
    onError: (err) => setError(getErrorMessage(err) || "Failed to update profile"),
  });

  const ready = isProfileComplete(profile);
  const busy = complete.isPending || saveProfile.isPending;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold font-mono uppercase border-b border-border pb-3 flex items-center gap-2">
        <UserRound className="w-4 h-4 text-primary" />
        Complete profile
      </h2>
      <p className="text-sm text-muted-foreground">
        Set a display name so others can recognize you on the marketplace and community.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="border border-border bg-background p-4">
          <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Username</p>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <p className="font-mono text-sm">{profile?.username || "—"}</p>
          )}
        </div>
        <div className="border border-border bg-background p-4">
          <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2">Display name</p>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <p className="font-mono text-sm">{profile?.display_name || "Not set"}</p>
          )}
        </div>
      </div>

      {!ready && (
        <div className="space-y-3">
          <label className="block text-[10px] font-mono uppercase text-muted-foreground">
            Display name
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full border border-border bg-background px-3 py-2.5 font-mono text-sm"
            placeholder="e.g. Northstar"
            maxLength={100}
          />
        </div>
      )}

      {error && <p className="text-sm font-mono text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {ready ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError("");
              complete.mutate();
            }}
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Continue
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || displayName.trim().length < 2}
            onClick={() => {
              setError("");
              saveProfile.mutate();
            }}
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Save & continue
          </button>
        )}
        <Link
          href={ROUTES.dashboardSettingsIdentity}
          className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm"
        >
          Full identity settings
        </Link>
      </div>
    </div>
  );
}

export function OnboardingFundPanel({ onboarding, onStateChange }: PanelProps) {
  const [error, setError] = useState("");

  const { data: wallet, isLoading, refetch } = useQuery({
    queryKey: ["wallet"],
    queryFn: getWallet,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const balance = typeof wallet?.balance_sol === "number" ? wallet.balance_sol : 0;
  const linked = Boolean(wallet?.linked_solana_address);
  const network = wallet?.solana_network || process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const tokenLabel = network === "mainnet" || network === "mainnet-beta" ? "SOL" : `${network} SOL`;

  const complete = useMutation({
    mutationFn: async () => {
      const latest = await refetch();
      const addr = latest.data?.linked_solana_address;
      if (!addr) {
        throw new Error("Link a Solana wallet first — marketplace buys fund escrow from your linked wallet");
      }
      const next = await completeBuyerStep(onboarding, "fund", {
        linked_solana_address: addr,
        platform_balance_sol: latest.data?.balance_sol ?? 0,
        rail: "escrow_first",
      });
      onStateChange(next);
    },
    onError: (err) => setError(getErrorMessage(err) || "Failed to confirm wallet link"),
  });

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold font-mono uppercase border-b border-border pb-3 flex items-center gap-2">
        <Wallet className="w-4 h-4 text-primary" />
        Link wallet for escrow
      </h2>
      <p className="text-sm text-muted-foreground">
        Marketplace bandwidth is funded from your <strong className="text-foreground">linked Solana wallet</strong> into
        an on-chain escrow PDA — not from platform balance. Platform deposits remain optional dust for
        staking/referrals.
      </p>

      <div className="border border-border bg-background p-4 space-y-2">
        <p className="text-[10px] font-mono uppercase text-muted-foreground">Linked Solana wallet</p>
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : linked ? (
          <p className="font-mono text-sm font-bold text-foreground">
            {wallet?.linked_solana_address?.slice(0, 8)}…{wallet?.linked_solana_address?.slice(-6)}
          </p>
        ) : (
          <p className="font-mono text-sm text-muted-foreground">Not linked</p>
        )}
        <p className="text-[10px] font-mono uppercase text-muted-foreground pt-2">
          Optional platform balance · {balance.toFixed(4)} {tokenLabel}
          {balance > 0 && balance < MIN_FUNDED_SOL ? " (dust)" : ""}
        </p>
      </div>

      {!linked && (
        <div className="border border-border bg-background p-4 text-xs font-mono text-muted-foreground uppercase tracking-wide">
          Open the wallet page to link Phantom/Solflare, then return here.
        </div>
      )}

      {error && <p className="text-sm font-mono text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {linked ? (
          <button
            type="button"
            disabled={complete.isPending}
            onClick={() => {
              setError("");
              complete.mutate();
            }}
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            {complete.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Continue
          </button>
        ) : (
          <Link
            href={`${ROUTES.dashboardWallet}?next=${encodeURIComponent(ROUTES.onboarding)}`}
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            Open wallet to link
            <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        <button
          type="button"
          onClick={() => void refetch()}
          className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

export function OnboardingBrowsePanel({ onboarding, onStateChange }: PanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const markBrowsed = async (navigateHref?: string) => {
    setBusy(true);
    setError("");
    try {
      trackOnboardingEvent("buyer_marketplace_opened");
      const next = await completeBuyerStep(onboarding, "browse");
      onStateChange(next);
      if (navigateHref && typeof window !== "undefined") {
        window.location.assign(navigateHref);
      }
    } catch (err) {
      setError(getErrorMessage(err) || "Failed to save browse step");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold font-mono uppercase border-b border-border pb-3 flex items-center gap-2">
        <Globe className="w-4 h-4 text-primary" />
        Browse marketplace
      </h2>
      <p className="text-sm text-muted-foreground">
        Explore listings by region, price, and uptime. You can buy later — this step just opens the
        catalog.
      </p>

      {error && <p className="text-sm font-mono text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void markBrowsed(ROUTES.marketplace)}
          className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          Open marketplace
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void markBrowsed()}
          className="btn-retro btn-retro-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          I&apos;ve already browsed — continue
          <ArrowRight className="w-4 h-4" />
        </button>
        <Link
          href={ROUTES.marketplaceMap}
          className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm"
          onClick={() => {
            trackOnboardingEvent("buyer_marketplace_opened", { surface: "map" });
          }}
        >
          Map view
        </Link>
      </div>
    </div>
  );
}

function hasStartedSession(sessions: Awaited<ReturnType<typeof getSessions>>, intents: Awaited<ReturnType<typeof listSessionIntents>>) {
  const activeSession = sessions.some(
    (s) => s.status === "active" || s.status === "activation_pending",
  );
  const activeIntent = intents.some((intent) => {
    const state = intent.lifecycle_state;
    return (
      state === "authorized" ||
      state === "routed" ||
      state === "active" ||
      state === "closing" ||
      state === "ledger_committed" ||
      state === "batched" ||
      state === "chain_committed"
    );
  });
  return activeSession || activeIntent;
}

export function OnboardingSessionPanel({ onboarding, onStateChange }: PanelProps) {
  const [error, setError] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["onboarding-session-check"],
    queryFn: async () => {
      const [sessions, intents] = await Promise.all([
        getSessions().catch(() => []),
        listSessionIntents().catch(() => []),
      ]);
      return { sessions, intents };
    },
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
  });

  const started = data ? hasStartedSession(data.sessions, data.intents) : false;

  const complete = useMutation({
    mutationFn: async () => {
      const latest = await refetch();
      const ready = latest.data
        ? hasStartedSession(latest.data.sessions, latest.data.intents)
        : false;
      if (!ready) {
        throw new Error("No active session or intent yet — start one from Connect or Marketplace");
      }
      let next = await completeBuyerStep(onboarding, "session", {
        sessions: latest.data?.sessions.length || 0,
      });
      next = await updateOnboarding({ complete: true });
      trackOnboardingEvent("onboarding_completed", { intent: next.intent || "buyer" });
      onStateChange(next);
    },
    onError: (err) => setError(getErrorMessage(err) || "Failed to finish onboarding"),
  });

  useEffect(() => {
    if (!started || onboarding.steps?.session?.completed_at) return;
    // Soft prompt only — user clicks finish; auto-complete can feel surprising mid-poll.
  }, [started, onboarding.steps?.session?.completed_at]);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold font-mono uppercase border-b border-border pb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        Start a session
      </h2>
      <p className="text-sm text-muted-foreground">
        Launch your first proxy session from Connect (quick start) or buy a listing on the marketplace.
      </p>

      <div className="border border-border bg-background p-4 text-xs font-mono uppercase tracking-wide space-y-1">
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <p>Sessions: {data?.sessions.length ?? 0}</p>
            <p>Intents: {data?.intents.length ?? 0}</p>
            <p className={started ? "text-foreground" : "text-muted-foreground"}>
              Status: {started ? "session activity detected" : "waiting for first session"}
            </p>
          </>
        )}
      </div>

      {error && <p className="text-sm font-mono text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <Link
          href={ROUTES.dashboardProxy}
          className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          Open Connect
          <ArrowRight className="w-4 h-4" />
        </Link>
        <Link
          href={ROUTES.marketplace}
          className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm"
        >
          Buy a listing
        </Link>
        <button
          type="button"
          disabled={complete.isPending || !started}
          onClick={() => {
            setError("");
            complete.mutate();
          }}
          className="btn-retro btn-retro-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {complete.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {started ? "Finish onboarding" : "Waiting for session…"}
        </button>
        <button
          type="button"
          onClick={() => void refetch()}
          className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
