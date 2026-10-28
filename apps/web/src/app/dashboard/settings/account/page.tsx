"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getWallet, getDailyUsage, getSessions } from "@/lib/api";
import { getMyProfile } from "@/lib/api/profile";
import { accountTierLabel } from "@/lib/account-tier";
import { useAuth } from "@/lib/auth";
import { DeleteAccountPanel, DataExportPanel } from "@/components/settings/DeleteAccountPanel";
import { DataError, Loading, Status } from "@/components/workspace/Patterns";

export default function AccountSettingsPage() {
  const { user } = useAuth();
  const wallet = useQuery({ queryKey: ["wallet"], queryFn: () => getWallet(), enabled: !!user });
  const profile = useQuery({ queryKey: ["profile", "me"], queryFn: getMyProfile, enabled: !!user });
  const usage = useQuery({ queryKey: ["usage", "daily", 30], queryFn: () => getDailyUsage(30), enabled: !!user });
  const sessions = useQuery({ queryKey: ["sessions", "active"], queryFn: () => getSessions("active"), enabled: !!user });
  const usedGb = usage.data?.data.reduce((sum, point) => sum + Number(point.gb_used || 0), 0);
  const balance = wallet.data?.balance_sol;
  return (
    <div className="grid gap-6">
      {profile.isLoading && <Loading label="Loading your account entitlement…" />}
      {profile.isError && <DataError error={profile.error} retry={() => void profile.refetch()} />}
      {profile.data && (
        <section className="ui-surface">
          <div className="ui-section-heading"><h2>Account entitlement</h2><Status>{profile.data.trust_tier || "Not reported"}</Status></div>
          <p className="ui-note">{profile.data.trust_tier ? accountTierLabel(profile.data.trust_tier) : "Your tier has not been reported."}</p>
          <div className="ui-row"><span>Identity verification</span><Status>{profile.data.kyc_status || "Not reported"}</Status></div>
          <div className="ui-actions"><Link className="ui-button secondary" href="/app/activity?tab=billing">View plans & billing →</Link></div>
        </section>
      )}
      <section className="ui-surface">
        <h2>Account measurements</h2>
        <p className="ui-note">Platform balance is separate from linked wallet funds and the public treasury.</p>
        {wallet.isError && <DataError error={wallet.error} retry={() => void wallet.refetch()} />}
        {usage.isError && <DataError error={usage.error} retry={() => void usage.refetch()} />}
        {sessions.isError && <DataError error={sessions.error} retry={() => void sessions.refetch()} />}
        <dl className="explorer-detail-fields">
          <div><dt>Platform balance</dt><dd>{wallet.isLoading ? "Loading…" : balance != null && Number.isFinite(Number(balance)) ? `${Number(balance).toFixed(4)} SOL` : "Not reported"}</dd></div>
          <div><dt>Reported usage · last 30 days</dt><dd>{usedGb != null && Number.isFinite(usedGb) ? `${usedGb.toFixed(2)} GB` : "Not reported"}</dd></div>
          <div><dt>Active sessions</dt><dd>{Array.isArray(sessions.data) ? sessions.data.length : "Not reported"}</dd></div>
          <div><dt>Linked Solana address</dt><dd>{wallet.data?.linked_solana_address || "No linked address reported"}</dd></div>
        </dl>
        <div className="ui-actions"><Link className="ui-button secondary" href="/app/wallet">Open wallet →</Link></div>
      </section>
      <DataExportPanel />
      <DeleteAccountPanel />
    </div>
  );
}
