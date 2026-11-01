"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getReferralStats,
  getMyRewards,
  generateReferralCode,
} from "@/lib/api/referral";
import { useAuth } from "@/lib/auth";
import { useHydrated } from "@/hooks/useHydrated";
import { CopyValue } from "@/components/workspace/CopyValue";
import {
  DataError,
  EmptyState,
  Loading,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";
export default function ReferralsPanel() {
  const { user } = useAuth();
  const client = useQueryClient();
  const hydrated = useHydrated();
  const stats = useQuery({
    queryKey: ["referral-stats", user?.id],
    queryFn: getReferralStats,
    enabled: !!user,
  });
  const rewards = useQuery({
    queryKey: ["referral-rewards", user?.id],
    queryFn: getMyRewards,
    enabled: !!user,
  });
  const generate = useMutation({
    retry: false,
    mutationFn: generateReferralCode,
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["referral-stats"] }),
  });
  const code = stats.data?.referral_code || generate.data?.code || "";
  const invite =
    code && hydrated
      ? window.location.origin + "/register?ref=" + encodeURIComponent(code)
      : "";
  return (
    <div className="ui-page" data-testid="account-referrals">
      <section className="ui-surface referral-panel">
        <p className="ui-eyebrow">Account utility</p>
        <h2>Referrals</h2>
        <p>
          Manage your invitation code and review rewards reported by the
          referral service.
        </p>
        {stats.isPending ? (
          <Loading label="Loading referral details…" />
        ) : stats.isError ? (
          <DataError error={stats.error} retry={() => void stats.refetch()} />
        ) : (
          <div className="referral-invite">
            <div>
              <p className="ui-eyebrow">Your referral code</p>
              <strong>{code || "No code issued"}</strong>
              {invite && (
                <CopyValue label="Referral invitation link" value={invite} />
              )}
            </div>
            <button
              type="button"
              className="ui-button secondary"
              disabled={!!code || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {code
                ? "Code issued"
                : generate.isPending
                  ? "Generating…"
                  : "Generate code"}
            </button>
          </div>
        )}
        {generate.isError && (
          <DataError
            title="Referral code was not generated"
            error={generate.error}
          />
        )}
      </section>
      <div className="ui-stats">
        <Stat
          label="Attributed referrals"
          value={amount(stats.data?.total_referrals, 0)}
          detail="Reported referral count"
        />
        <Stat
          label="Reward records"
          value={rewards.data ? amount(rewards.data.length, 0) : "—"}
          detail="Returned by the rewards service"
        />
      </div>
      <section className="ui-surface referral-panel">
        <h2>Reward history</h2>
        {rewards.isPending ? (
          <Loading label="Loading reward history…" />
        ) : rewards.isError ? (
          <DataError
            error={rewards.error}
            retry={() => void rewards.refetch()}
          />
        ) : !rewards.data?.length ? (
          <EmptyState
            title="No rewards returned"
            description="Attributed reward records will appear here when available."
          />
        ) : (
          <ul className="referral-rewards">
            {rewards.data.map((reward) => (
              <li key={reward.id}>
                <div>
                  <strong>{reward.referral_code}</strong>
                  <p>
                    {reward.reward_type?.replace(/_/g, " ")} ·{" "}
                    {shortDate(reward.created_at)}
                  </p>
                </div>
                <span>{amount(reward.reward_amount, 6)}</span>
                <Status>{reward.status?.replace(/_/g, " ")}</Status>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
