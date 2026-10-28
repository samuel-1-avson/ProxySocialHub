"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  claimCustodialEarnings,
  getPayoutSettings,
  getProviderEarnings,
  getProviderEarningsSummary,
  getProviderPayoutHistory,
  updatePayoutSettings,
  type PayoutSettings,
} from "@/lib/api/provider";
import { parseSolAmountLamports } from "@/lib/sol-amount";
import { explorerHref } from "@/lib/navigation/workspace";
import { ProviderClaimPanel } from "@/components/ProviderClaimPanel";
import {
  PageHeading,
  Loading,
  DataError,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";

export function SellerEarnings() {
  const { user } = useAuth();
  const params = useSearchParams();
  const tab = ["history", "payouts"].includes(params.get("tab") ?? "")
    ? params.get("tab")!
    : "overview";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const summary = useQuery({
    queryKey: ["provider-earnings-summary", user?.id],
    queryFn: getProviderEarningsSummary,
    staleTime: 30_000,
  });
  const earnings = useQuery({
    queryKey: ["provider-earnings", user?.id, page],
    queryFn: () => getProviderEarnings({ page, limit: 20 }),
    enabled: tab === "history",
  });
  const payouts = useQuery({
    queryKey: ["provider-payouts", user?.id],
    queryFn: getProviderPayoutHistory,
    enabled: tab === "overview" || tab === "payouts",
    staleTime: 30_000,
  });
  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Seller workspace"
        title="Earnings"
        description="Understand recorded earnings, payout eligibility, and settlement evidence."
      />
      <nav className="ui-tabs" aria-label="Earnings views">
        {[
          ["overview", "Overview"],
          ["history", "Earning history"],
          ["payouts", "Payouts & settings"],
        ].map(([key, label]) => (
          <Link
            key={key}
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
            href={
              key === "overview"
                ? "/provider/earnings"
                : `/provider/earnings?tab=${key}`
            }
          >
            {label}
          </Link>
        ))}
      </nav>
      {summary.isLoading && <Loading label="Loading earnings…" />}
      {summary.isError && (
        <DataError error={summary.error} retry={() => void summary.refetch()} />
      )}
      <section className="ui-stats">
        <Stat
          label="Earned in 30 days"
          value={
            summary.data
              ? `${amount(summary.data.last_30_days_sol, 6)} SOL`
              : "—"
          }
          detail="Recorded earnings for the period"
        />
        <Stat
          label="Pending"
          value={
            summary.data ? `${amount(summary.data.pending_sol, 6)} SOL` : "—"
          }
          detail="Separate from payable and paid funds"
        />
        <Stat
          label="Paid lifetime"
          value={summary.data ? `${amount(summary.data.paid_sol, 6)} SOL` : "—"}
          detail="Completed payments in provider records"
        />
      </section>
      {tab === "overview" && (
        <section className="ui-attention">
          <h3>Review eligibility before requesting a payout.</h3>
          <p>
            Pending earnings, payable account funds, and protocol claims are
            reported by different services. Payout settings show the amount
            available through each supported method.
          </p>
          <Link className="ui-link" href="/provider/earnings?tab=payouts">
            Open payouts & settings →
          </Link>
        </section>
      )}
      {tab === "payouts" && (
        <>
          <AccountPayouts />
          <ProviderClaimPanel />
        </>
      )}
      {tab === "history" && (
        <section>
          <h2 className="mb-4">Earning history</h2>
          {earnings.isLoading && <Loading label="Loading earning records…" />}
          {earnings.isError && (
            <DataError
              error={earnings.error}
              retry={() => void earnings.refetch()}
            />
          )}
          {earnings.data && (
            <>
              <div
                className="ui-table-wrap"
                role="region"
                tabIndex={0}
                aria-label="Earning records"
              >
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>Recorded</th>
                      <th>Bandwidth</th>
                      <th>Gross</th>
                      <th>Fee</th>
                      <th>Net</th>
                      <th>State</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earnings.data.earnings.map((record) => (
                      <tr key={record.id}>
                        <td>
                          {shortDate(record.created_at)}
                          <p>{record.id.slice(0, 12)}</p>
                        </td>
                        <td>{amount(record.bandwidth_gb, 3)} GB</td>
                        <td>{amount(record.gross_amount_sol, 6)} SOL</td>
                        <td>{amount(record.platform_fee_sol, 6)} SOL</td>
                        <td>{amount(record.net_amount_sol, 6)} SOL</td>
                        <td>
                          <Status
                            tone={
                              record.status === "paid"
                                ? "good"
                                : record.status === "failed"
                                  ? "error"
                                  : "neutral"
                            }
                          >
                            {record.status}
                          </Status>
                        </td>
                        <td>
                          {record.tx_hash ? (
                            <a
                              className="ui-link"
                              href={explorerHref(
                                `/transactions/${encodeURIComponent(record.tx_hash)}`,
                              )}
                            >
                              Transaction ↗
                            </a>
                          ) : (
                            "Not reported"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!earnings.data.earnings.length && (
                <p className="ui-note">No earning records were returned.</p>
              )}
              {earnings.data.total > 20 && (
                <div className="ui-pagination mt-4">
                  {page > 1 ? (
                    <Link
                      className="ui-button secondary"
                      href={`/provider/earnings?tab=history&page=${page - 1}`}
                    >
                      Previous
                    </Link>
                  ) : (
                    <span>First page</span>
                  )}
                  <span>
                    Page {page} of {Math.ceil(earnings.data.total / 20)}
                  </span>
                  {page * 20 < earnings.data.total && (
                    <Link
                      className="ui-button secondary"
                      href={`/provider/earnings?tab=history&page=${page + 1}`}
                    >
                      Next
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
      {tab !== "history" && (
        <section>
          <h2 className="mb-4">Payout history</h2>
          {payouts.isLoading && <Loading label="Loading payouts…" />}
          {payouts.isError && (
            <DataError
              error={payouts.error}
              retry={() => void payouts.refetch()}
            />
          )}
          {payouts.data?.payouts.map((record) => (
            <div className="ui-row" key={record.id}>
              <div>
                <h3>{amount(record.net_amount_sol, 6)} SOL</h3>
                <p>
                  {shortDate(record.paid_at || record.created_at)} ·{" "}
                  {record.status}
                </p>
              </div>
              {record.tx_hash && (
                <a
                  className="ui-button secondary small"
                  href={explorerHref(
                    `/transactions/${encodeURIComponent(record.tx_hash)}`,
                  )}
                >
                  Transaction ↗
                </a>
              )}
            </div>
          ))}
          {payouts.isSuccess && !payouts.data.payouts.length && (
            <p className="ui-note">No completed payouts have been reported.</p>
          )}
        </section>
      )}
      <details className="ui-note">
        <summary>Advanced business tools</summary>
        <div className="ui-actions mt-3">
          <Link className="ui-link" href="/dashboard/provider/relationships">
            Customers →
          </Link>
          <Link className="ui-link" href="/dashboard/provider/circle">
            Enterprise pooling →
          </Link>
        </div>
      </details>
    </div>
  );
}

function AccountPayouts() {
  const { user } = useAuth();
  const client = useQueryClient();
  const requestKey = useRef<string | null>(null);
  const settings = useQuery({
    queryKey: ["provider-payout-settings", user?.id],
    queryFn: getPayoutSettings,
    staleTime: 15_000,
  });
  const claim = useMutation({
    retry: false,
    mutationFn: () => {
      requestKey.current ??= crypto.randomUUID();
      return claimCustodialEarnings(0, requestKey.current);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["provider-payout-settings"] });
      void client.invalidateQueries({
        queryKey: ["provider-earnings-summary"],
      });
      void client.invalidateQueries({ queryKey: ["provider-payouts"] });
    },
  });
  return (
    <section className="ui-surface ui-page">
      <div>
        <h2>Account earnings payout</h2>
        <p className="ui-note">
          Request a payout from the provider account’s payable ledger. An
          accepted request is not proof of an on-chain payment.
        </p>
      </div>
      {settings.isLoading && <Loading label="Loading payout eligibility…" />}
      {settings.isError && (
        <DataError
          error={settings.error}
          retry={() => void settings.refetch()}
        />
      )}
      {settings.data && (
        <>
          <div className="ui-row">
            <span>Payable now</span>
            <strong>
              {amount(
                settings.data.payable_sol ??
                  settings.data.payable_lamports / 1_000_000_000,
                9,
              )}{" "}
              SOL
            </strong>
          </div>
          <div className="ui-actions">
            <button
              className="ui-button"
              disabled={
                settings.data.payable_lamports <= 0 ||
                claim.isPending ||
                claim.isSuccess
              }
              onClick={() => claim.mutate()}
            >
              {claim.isPending
                ? "Requesting payout…"
                : claim.isSuccess
                  ? "Payout request accepted"
                  : "Request payable payout"}
            </button>
            <button
              className="ui-button secondary"
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              Refresh eligibility
            </button>
          </div>
          {claim.isError && <DataError error={claim.error} />}
          {claim.data && (
            <div className="ui-attention" role="status">
              <h3>Payout request: {claim.data.status}</h3>
              <p>
                {amount(claim.data.amount_sol, 9)} SOL · Reference{" "}
                {claim.data.payout_id ?? "not returned"}. Check payout history
                for settlement evidence.
              </p>
            </div>
          )}
          <PayoutPreferences
            key={`${settings.data.auto_payout_enabled}-${settings.data.auto_payout_threshold_lamports}`}
            settings={settings.data}
          />
        </>
      )}
    </section>
  );
}

function PayoutPreferences({ settings }: { settings: PayoutSettings }) {
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(settings.auto_payout_enabled);
  const [threshold, setThreshold] = useState(
    (settings.auto_payout_threshold_lamports / 1_000_000_000)
      .toFixed(9)
      .replace(/\.?0+$/, ""),
  );
  const lamports = parseSolAmountLamports(threshold);
  const valid = !enabled || (lamports !== null && lamports > 0);
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      updatePayoutSettings({
        auto_payout_enabled: enabled,
        ...(enabled && lamports !== null
          ? { auto_payout_threshold_lamports: lamports }
          : {}),
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["provider-payout-settings"] }),
  });
  return (
    <form
      className="ui-page"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <h3>Automatic payouts</h3>
      <label className="ui-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={save.isPending}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable automatic account payouts
      </label>
      <label className="ui-field">
        Payout threshold (SOL)
        <input
          className="ui-input"
          aria-label="Payout threshold (SOL)"
          aria-describedby="payout-threshold-help"
          inputMode="decimal"
          value={threshold}
          disabled={!enabled || save.isPending}
          onChange={(e) => setThreshold(e.target.value)}
        />
        <small id="payout-threshold-help">
          Up to 9 decimal places. The server checks eligibility and payout
          limits.
        </small>
      </label>
      {enabled && !valid && (
        <p className="ui-note" role="alert">
          Enter a positive SOL amount with no more than 9 decimal places.
        </p>
      )}
      {save.isError && <DataError error={save.error} />}
      {save.isSuccess && (
        <p className="ui-note" role="status">
          Payout settings saved.
        </p>
      )}
      <button
        className="ui-button secondary self-start"
        disabled={!valid || save.isPending}
      >
        {save.isPending ? "Saving…" : "Save payout settings"}
      </button>
    </form>
  );
}
