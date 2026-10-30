"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, RefreshCw, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getWallet } from "@/lib/api/wallet";
import { getKYCStatus, recheckKYC, startKYC } from "@/lib/api/provider";
import { getOnboardingState, updateOnboarding, type OnboardingState } from "@/lib/api/onboarding";
import { trackOnboardingEvent } from "@/lib/analytics/onboarding-funnel";
import { ROUTES } from "@/lib/navigation/routes";
import { getErrorMessage } from "@/lib/utils";

const MIN_SOL = 0.05;

type KycStatus = OnboardingState["kyc_status"] | "not_started" | string;

function isKycUnset(status: string | undefined | null): boolean {
  const s = (status || "").toLowerCase();
  return !s || s === "none" || s === "not_started";
}

export function OnboardingKYCPanel({
  onboarding,
  onStateChange,
}: {
  onboarding: OnboardingState;
  onStateChange: (next: OnboardingState) => void;
}) {
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [localStatus, setLocalStatus] = useState<KycStatus>(onboarding.kyc_status);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setLocalStatus(onboarding.kyc_status);
  }, [onboarding.kyc_status]);

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["wallet"],
    queryFn: getWallet,
  });

  const { data: liveKyc } = useQuery({
    queryKey: ["kyc-status", user?.id],
    queryFn: () => getKYCStatus(user!.id),
    enabled: !!user?.id,
    refetchInterval: (query) => {
      const status = query.state.data?.kyc_status;
      return status === "pending" || status === "insufficient_funds" ? 12_000 : false;
    },
  });

  useEffect(() => {
    if (!liveKyc?.kyc_status) return;
    if (liveKyc.kyc_status === localStatus) return;
    const previous = localStatus;
    setLocalStatus(liveKyc.kyc_status);
    trackOnboardingEvent("kyc_status_changed", {
      from: previous,
      to: liveKyc.kyc_status,
    });
    if (liveKyc.kyc_status === "approved") {
      void (async () => {
        await refreshUser();
        const next = await getOnboardingState();
        onStateChange(next);
      })();
    }
  }, [liveKyc?.kyc_status, localStatus, onStateChange, refreshUser]);

  const networkRaw = wallet?.solana_network || process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const network = networkRaw === "mainnet" ? "mainnet-beta" : networkRaw;
  const isMainnet = network === "mainnet-beta" || network === "mainnet";
  const tokenLabel = isMainnet ? "SOL" : `${network} SOL`;
  const balance = typeof wallet?.on_chain_sol === "number" ? wallet.on_chain_sol : undefined;
  const hasWallet = !!user?.wallet_address;
  const hasEnough = typeof balance === "number" ? balance >= MIN_SOL : false;

  const syncApproved = async () => {
    await refreshUser();
    await qc.invalidateQueries({ queryKey: ["kyc-status"] });
    let next = await getOnboardingState();
    if (!next.steps?.kyc?.completed_at) {
      next = await updateOnboarding({ complete_step: "kyc" });
      trackOnboardingEvent("step_completed", { step: "kyc" });
    }
    onStateChange(next);
  };

  const startMutation = useMutation({
    mutationFn: startKYC,
    onMutate: () => {
      setError("");
      setMessage("");
      trackOnboardingEvent("kyc_viewed");
    },
    onSuccess: async (res) => {
      setLocalStatus(res.kyc_status);
      setMessage(res.message || "");
      if (res.kyc_status === "approved") {
        await syncApproved();
      } else {
        await qc.invalidateQueries({ queryKey: ["kyc-status"] });
        const next = await getOnboardingState();
        onStateChange(next);
      }
    },
    onError: (err) => {
      setError(getErrorMessage(err) || "Failed to start KYC");
      void qc.invalidateQueries({ queryKey: ["kyc-status", "wallet"] });
    },
  });

  const recheckMutation = useMutation({
    mutationFn: recheckKYC,
    onMutate: () => {
      setError("");
      setMessage("");
    },
    onSuccess: async (res) => {
      setLocalStatus(res.kyc_status);
      setMessage(res.message || "KYC rechecked");
      if (res.kyc_status === "approved") {
        await syncApproved();
      } else {
        await qc.invalidateQueries({ queryKey: ["kyc-status"] });
      }
    },
    onError: (err) => {
      setError(getErrorMessage(err) || "KYC recheck failed");
      void qc.invalidateQueries({ queryKey: ["kyc-status", "wallet"] });
    },
  });

  const busy = startMutation.isPending || recheckMutation.isPending;
  const canRecheck = localStatus === "pending" || localStatus === "insufficient_funds";
  const canStart = isKycUnset(localStatus) || (localStatus === "pending" && !isMainnet);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold font-mono border-b border-border pb-3">
        Identity verification (required)
      </h2>
      <p className="text-sm text-muted-foreground">
        Providers must clear KYC before apply and node setup. On testnet, linked wallet + {MIN_SOL}{" "}
        {tokenLabel} can approve immediately. On mainnet, external verification is required.
      </p>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="border border-border bg-background p-4">
          <p className="text-xs font-mono text-muted-foreground mb-2">Status</p>
          <p className="font-mono font-bold text-sm flex items-center gap-2">
            <Shield className={`w-4 h-4 ${localStatus === "approved" ? "text-primary" : "text-muted-foreground"}`} />
            {isKycUnset(localStatus) ? "not_started" : localStatus}
          </p>
        </div>
        <div className="border border-border bg-background p-4">
          <p className="text-xs font-mono text-muted-foreground mb-2">Wallet</p>
          <p className="font-mono text-xs">
            {hasWallet
              ? `${user!.wallet_address!.slice(0, 6)}…${user!.wallet_address!.slice(-4)}`
              : "Not linked"}
          </p>
        </div>
        <div className="border border-border bg-background p-4">
          <p className="text-xs font-mono text-muted-foreground mb-2">Balance</p>
          {walletLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : typeof balance === "number" ? (
            <p className={`font-mono text-xs font-bold ${hasEnough ? "text-foreground" : "text-destructive"}`}>
              {balance.toFixed(3)} / {MIN_SOL} {tokenLabel}
            </p>
          ) : (
            <p className="font-mono text-xs text-muted-foreground">Pending check</p>
          )}
        </div>
      </div>

      {localStatus === "insufficient_funds" && (
        <div className="flex gap-3 border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p>
            Fund your linked wallet with at least {MIN_SOL} {tokenLabel}, then recheck.{" "}
            <Link href={ROUTES.dashboardWallet} className="underline text-primary">
              Open wallet
            </Link>
          </p>
        </div>
      )}

      {localStatus === "pending" && isMainnet && (
        <div className="border border-border bg-background p-4 text-xs font-mono text-muted-foreground">
          Awaiting verification provider webhook. Status refreshes automatically.
        </div>
      )}

      {message && (
        <p className="text-xs font-mono text-muted-foreground">{message}</p>
      )}
      {error && (
        <div className="border border-destructive/30 bg-destructive/10 text-destructive px-4 py-3 text-sm font-mono">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {localStatus === "approved" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void syncApproved()}
            className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
          >
            Continue to apply
            <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <>
            {canStart && (
              <button
                type="button"
                disabled={busy || !hasWallet || (!hasEnough && !walletLoading)}
                onClick={() => startMutation.mutate()}
                className="btn-retro btn-retro-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm"
              >
                {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                {isKycUnset(localStatus) ? "Start verification" : "Retry verification"}
              </button>
            )}
            {canRecheck && (
              <button
                type="button"
                disabled={busy || !hasWallet}
                onClick={() => recheckMutation.mutate()}
                className="btn-retro btn-retro-outline inline-flex items-center gap-2 px-4 py-2.5 text-sm"
              >
                {recheckMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Recheck now
              </button>
            )}
            {!hasWallet && (
              <Link href={ROUTES.dashboardWallet} className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm">
                Link wallet
              </Link>
            )}
            {hasWallet && !hasEnough && !walletLoading && isKycUnset(localStatus) && (
              <Link href={ROUTES.dashboardWallet} className="btn-retro btn-retro-outline inline-flex px-4 py-2.5 text-sm">
                Fund wallet
              </Link>
            )}
          </>
        )}
      </div>

      {localStatus === "approved" && (
        <p className="text-xs font-mono text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
          KYC approved. You can submit a provider application next.
        </p>
      )}
    </div>
  );
}
