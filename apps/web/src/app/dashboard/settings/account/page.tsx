"use client";
import { useRouter } from "next/navigation";
import { DataError } from "@/components/workspace/Patterns";

import { getWallet, getDailyUsage, getSessions } from "@/lib/api";
import { getMyProfile } from "@/lib/api/profile";
import { accountTierLabel } from "@/lib/account-tier";
import { useAuth } from "@/lib/auth";
import {
  Shield,
  Zap,
  Info,
  AlertCircle,
  CheckCircle,
  ArrowUpRight,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  DeleteAccountPanel,
  DataExportPanel,
} from "@/components/settings/DeleteAccountPanel";

const TIER_LIMITS = {
  new: { rpm: 10, bandwidthGb: 5, concurrency: 3, automation: false },
  verified: { rpm: 100, bandwidthGb: 50, concurrency: 10, automation: true },
  premium: {
    rpm: 1000,
    bandwidthGb: null as number | null,
    concurrency: 100,
    automation: true,
  },
};

function barWidth(used: number, cap: number | null): string {
  if (cap == null || cap <= 0) {
    return used > 0 ? "8%" : "0%";
  }
  return `${Math.min(100, Math.max(0, (used / cap) * 100))}%`;
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    data: wallet,
    isLoading: walletLoading,
    error: walletError,
    refetch: refetchWallet,
  } = useQuery({
    queryKey: ["wallet"],
    queryFn: () => getWallet(),
    enabled: !!user,
  });

  const {
    data: profile,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ["profile", "me"],
    queryFn: () => getMyProfile(),
    enabled: !!user,
  });

  const {
    data: dailyUsage,
    error: usageError,
    refetch: refetchUsage,
  } = useQuery({
    queryKey: ["usage", "daily", 30],
    queryFn: () => getDailyUsage(30),
    enabled: !!user,
  });

  const {
    data: activeSessions,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ["sessions", "active"],
    queryFn: () => getSessions("active"),
    enabled: !!user,
  });

  const sourceError =
    walletError || profileError || usageError || sessionsError;
  if (sourceError)
    return (
      <DataError
        title="Account data is unavailable"
        error={sourceError}
        retry={() => {
          void refetchWallet();
          void refetchProfile();
          void refetchUsage();
          void refetchSessions();
        }}
      />
    );
  const tier = profile?.trust_tier || "new";
  const limits =
    TIER_LIMITS[tier as keyof typeof TIER_LIMITS] || TIER_LIMITS.new;
  const usedGb = (dailyUsage?.data || []).reduce(
    (sum, point) => sum + Number(point.gb_used || 0),
    0,
  );
  const usedStreams = Array.isArray(activeSessions) ? activeSessions.length : 0;
  const bandwidthLabel =
    limits.bandwidthGb == null ? "Unlimited" : `${limits.bandwidthGb} GB`;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-700">
      {/* Header Content */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
        <div>
          <h2 className="text-2xl font-semibold font-mono normal-case tracking-tighter flex items-center gap-2">
            Account tier
            <Zap size={20} className="text-primary" />
          </h2>
          <p className="text-xs font-mono text-muted-foreground normal-case tracking-normal mt-1">
            KYC entitlement and usage limits. Identity verification is a
            separate flag.
          </p>
        </div>
      </div>

      {/* KYC & Balance Alert */}
      {profile?.kyc_status === "insufficient_funds" && (
        <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-sm flex items-start gap-4 animate-pulse">
          <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={20} />
          <div className="space-y-1">
            <p className="text-xs font-semibold font-mono normal-case text-amber-500 tracking-tighter">
              Verification Blocked: Insufficient Gas
            </p>
            <p className="text-xs font-mono text-muted-foreground leading-tight normal-case opacity-80">
              YOUR LINKED WALLET MUST MAINTAIN A MINIMUM OF{" "}
              <span className="text-amber-500 font-bold">0.05 SOL</span> TO
              COMPLETE KYC TIER UPGRADE. CURRENT LINKED BALANCE IS BELOW
              THRESHOLD.
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
                <h3 className="text-xs font-semibold font-mono text-primary normal-case tracking-normal mb-2 italic">
                  Account tier (KYC / quotas)
                </h3>
                <h4 className="text-4xl font-semibold font-mono normal-case tracking-tighter text-white">
                  {accountTierLabel(tier)}
                </h4>
              </div>
              <div className="px-3 py-1 bg-primary/20 border border-primary/30 rounded-full">
                <span className="text-xs font-semibold font-mono text-primary normal-case tracking-normal">
                  Active Level
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-8">
              <div className="space-y-1">
                <p className="text-xs font-semibold font-mono text-muted-foreground normal-case tracking-normal">
                  Throughput Cap
                </p>
                <p className="text-sm font-bold font-mono text-white normal-case">
                  {bandwidthLabel}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold font-mono text-muted-foreground normal-case tracking-normal">
                  Velocity Limit
                </p>
                <p className="text-sm font-bold font-mono text-white normal-case">
                  {limits.rpm} RPM
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold font-mono text-muted-foreground normal-case tracking-normal">
                  Concurrency
                </p>
                <p className="text-sm font-bold font-mono text-white normal-case">
                  {limits.concurrency} Nodes
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-semibold font-mono text-muted-foreground normal-case tracking-normal">
              Quota (last 30 days)
            </h3>
            <div className="space-y-6 p-6 bg-white/[0.01] border border-white/5 rounded-sm">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono font-semibold normal-case">
                  <span className="text-muted-foreground/60">Bandwidth</span>
                  <span className="text-primary">
                    {usedGb.toFixed(2)} / {bandwidthLabel}
                  </span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: barWidth(usedGb, limits.bandwidthGb) }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono font-semibold normal-case">
                  <span className="text-muted-foreground/60">
                    Active sessions
                  </span>
                  <span className="text-primary">
                    {usedStreams} / {limits.concurrency}
                  </span>
                </div>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: barWidth(usedStreams, limits.concurrency) }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Account Actions / Wallet Snippet */}
        <div className="space-y-6">
          <div className="p-6 bg-white/[0.01] border border-white/5 rounded-sm space-y-6">
            <h3 className="text-xs font-semibold font-mono text-muted-foreground normal-case tracking-normal">
              Settlement Node
            </h3>

            <div className="space-y-4">
              <div className="p-4 bg-muted border border-white/5 rounded-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold font-mono normal-case">
                    Linked Address
                  </span>
                  {wallet?.linked_solana_address && (
                    <CheckCircle size={10} className="text-emerald-500" />
                  )}
                </div>
                <div className="text-xs font-mono font-bold break-all opacity-80 bg-white/5 p-2 rounded-sm border border-white/5">
                  {wallet?.linked_solana_address || "NO WALLET LINKED"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-sm">
                  <p className="text-xs font-semibold font-mono text-muted-foreground normal-case mb-1">
                    Treasury Balance
                  </p>
                  <p className="text-xs font-semibold font-mono text-primary normal-case">
                    {walletLoading
                      ? "..."
                      : Number(wallet?.balance_sol ?? 0).toFixed(4)}{" "}
                    SOL
                  </p>
                </div>
                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-sm">
                  <p className="text-xs font-semibold font-mono text-muted-foreground normal-case mb-1">
                    Tier Multiplier
                  </p>
                  <p className="text-xs font-semibold font-mono text-white normal-case">
                    {tier === "premium"
                      ? "x5.0"
                      : tier === "verified"
                        ? "x2.0"
                        : "x1.0"}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => router.push("/app/wallet")}
              className="w-full py-3 border border-primary/20 hover:border-primary bg-primary/5 text-primary text-xs font-semibold font-mono normal-case tracking-normal transition-all rounded-sm flex items-center justify-center gap-3 group"
            >
              Open Financial Central
              <ArrowUpRight
                size={14}
                className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform"
              />
            </button>
          </div>

          <div className="p-6 bg-secondary/10 border border-white/5 rounded-sm space-y-4">
            <div className="flex items-center gap-2 text-primary">
              <Info size={14} />
              <h4 className="text-xs font-semibold font-mono normal-case tracking-normal">
                Upgrade Intel
              </h4>
            </div>
            <p className="text-xs font-mono text-muted-foreground leading-relaxed normal-case opacity-80">
              VERIFIED TIER UNLOCKS UNRESTRICTED AUTOMATION AND HIGH-CAPACITY
              BANDWIDTH SEGMENTS. REQUIRES ON-CHAIN IDENTITY PROOF.
            </p>
          </div>
        </div>
      </div>

      <DataExportPanel />
      <DeleteAccountPanel />
    </div>
  );
}
