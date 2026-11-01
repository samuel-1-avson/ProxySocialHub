"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Landmark,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { getPublicTreasury, type WalletBalanceView } from "@/lib/api/treasury";
import { CopyValue } from "@/components/workspace/CopyValue";
import {
  DataError,
  EmptyState,
  Loading,
  PageHeading,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";

function balance(wallet?: WalletBalanceView) {
  if (!wallet?.address) return "Not configured";
  return wallet.balance_unavailable || !Number.isFinite(wallet.balance_sol)
    ? "Unavailable"
    : amount(wallet.balance_sol, 9) + " SOL";
}
function external(value?: string) {
  try {
    return value && new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
export default function TreasuryPage() {
  const query = useQuery({
    queryKey: ["treasury-public"],
    queryFn: ({ signal }) => getPublicTreasury(signal),
    refetchInterval: 60_000,
  });
  const data = query.data;
  const treasury = data?.treasury;
  const degraded =
    treasury?.status === "RPC_UNAVAILABLE" ||
    treasury?.hot?.balance_unavailable ||
    treasury?.cold?.balance_unavailable ||
    treasury?.vault?.balance_unavailable;
  const network = data?.network;
  function accountUrl(address: string) {
    if (
      !["mainnet", "mainnet-beta", "devnet", "testnet"].includes(network || "")
    )
      return null;
    return (
      "https://solscan.io/account/" +
      encodeURIComponent(address) +
      (network === "devnet" || network === "testnet"
        ? "?cluster=" + network
        : "")
    );
  }
  return (
    <div className="ui-page treasury-page">
      <Link href="/explorer" className="ui-button ghost self-start">
        <ArrowLeft size={15} />
        Explorer
      </Link>
      <PageHeading
        eyebrow="Public records / Treasury"
        title="Platform treasury"
        description="Inspect reported wallet balances, liquidity, and provider batch payouts without signing in."
        actions={
          <button
            type="button"
            className="ui-button secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              size={15}
              className={query.isFetching ? "animate-spin" : ""}
            />
            Refresh records
          </button>
        }
      />
      {query.isPending && <Loading label="Loading public treasury records…" />}
      {query.isError && (
        <DataError
          title="Treasury records are unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      )}
      {degraded && (
        <p className="workflow-note" role="status">
          The RPC service could not refresh one or more balances. Configured
          addresses remain visible; unavailable balances are not shown as zero.
        </p>
      )}
      <div className="ui-stats">
        <Stat
          label="Hot wallet"
          value={data ? balance(treasury?.hot) : "—"}
          detail="Reported operational wallet balance"
          icon={<Wallet size={18} />}
        />
        <Stat
          label="Cold wallet"
          value={data ? balance(treasury?.cold) : "—"}
          detail="Reported reserve wallet balance"
          icon={<ShieldCheck size={18} />}
        />
        <Stat
          label="Lifetime provider payouts"
          value={
            data ? amount(data.lifetime_provider_paid_sol, 9) + " SOL" : "—"
          }
          detail={
            network
              ? "Native settlement · " + network
              : "Settlement network unavailable"
          }
          icon={<Landmark size={18} />}
        />
      </div>
      {data && (
        <>
          <div className="treasury-record-header ui-surface">
            <div>
              <p className="ui-eyebrow">Reported service state</p>
              <h2>
                {treasury?.status?.replace(/_/g, " ") ||
                  "Treasury state unavailable"}
              </h2>
              <p>
                Network · {network || "Not reported"}
                {treasury?.last_checked_at
                  ? " · Last checked " +
                    new Date(treasury.last_checked_at).toLocaleString()
                  : ""}
              </p>
            </div>
            <div className="ui-actions">
              <Status tone={data.oracle_configured ? "good" : "warning"}>
                Oracle{" "}
                {data.oracle_configured ? "configured" : "not configured"}
              </Status>
              <Status tone={data.operational_healthy ? "good" : "warning"}>
                {data.operational_healthy
                  ? "Operational health reported"
                  : "Operational health degraded"}
              </Status>
            </div>
          </div>
          <div className="treasury-wallets">
            {[
              ["Hot wallet", treasury?.hot],
              ["Cold wallet", treasury?.cold],
              ["Deposit vault", treasury?.vault],
            ].map(([label, value]) => {
              const wallet = value as WalletBalanceView | undefined;
              const href = wallet?.address ? accountUrl(wallet.address) : null;
              return (
                <section
                  className="ui-surface treasury-wallet"
                  key={label as string}
                >
                  <p className="ui-eyebrow">{label as string}</p>
                  <h2>{balance(wallet)}</h2>
                  {wallet?.address ? (
                    <>
                      <CopyValue
                        label={String(label) + " address"}
                        value={wallet.address}
                      />
                      {href && (
                        <a
                          className="ui-link"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on Solscan
                          <ArrowUpRight size={13} />
                        </a>
                      )}
                      {wallet.needs_replenish &&
                        !wallet.balance_unavailable && (
                          <Status tone="warning">
                            Below the reported minimum
                          </Status>
                        )}
                    </>
                  ) : (
                    <p>No wallet address has been reported for this role.</p>
                  )}
                </section>
              );
            })}
          </div>
          {treasury?.liquidity && (
            <section className="ui-surface treasury-liquidity">
              <div className="ui-section-heading">
                <div>
                  <p className="ui-eyebrow">Liquidity observation</p>
                  <h2>Payout queue & funding</h2>
                </div>
              </div>
              <dl className="detail-spec-grid">
                <div>
                  <dt>Queued payouts</dt>
                  <dd>{amount(treasury.liquidity.queue_depth, 0)}</dd>
                </div>
                <div>
                  <dt>Oldest queued payout</dt>
                  <dd>
                    {treasury.liquidity.queue_oldest_age_secs != null
                      ? amount(
                          treasury.liquidity.queue_oldest_age_secs / 60,
                          1,
                        ) + " minutes"
                      : "Not reported"}
                  </dd>
                </div>
                <div>
                  <dt>Last vault top-up</dt>
                  <dd>
                    {treasury.liquidity.last_topup_sol != null
                      ? amount(treasury.liquidity.last_topup_sol, 9) + " SOL"
                      : "Not reported"}
                  </dd>
                </div>
                <div>
                  <dt>Top-up record</dt>
                  <dd>
                    {treasury.liquidity.last_topup_at
                      ? shortDate(treasury.liquidity.last_topup_at)
                      : "No date reported"}
                    {treasury.liquidity.last_topup_source
                      ? " · " + treasury.liquidity.last_topup_source
                      : ""}
                  </dd>
                </div>
              </dl>
            </section>
          )}
          <section>
            <div className="ui-section-heading">
              <div>
                <p className="ui-eyebrow">Distribution records</p>
                <h2>Recent batch payouts</h2>
              </div>
              <span className="ui-subtle">
                {data.recent_batch_payouts?.length ?? 0} records
              </span>
            </div>
            {!data.recent_batch_payouts?.length ? (
              <EmptyState
                title="No payout records returned"
                description="Reported provider batch payouts will appear here as they become available."
              />
            ) : (
              <div className="ui-surface treasury-payouts">
                <div className="record-table-scroll">
                  <table className="record-table">
                    <caption className="sr-only">
                      Recent provider batch payouts
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Amount</th>
                        <th scope="col">Recipients</th>
                        <th scope="col">Status</th>
                        <th scope="col">Processed</th>
                        <th scope="col">Transaction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_batch_payouts.map((payout) => (
                        <tr key={payout.id}>
                          <td>{amount(payout.total_amount, 9)} SOL</td>
                          <td>
                            {amount(payout.success_count, 0)} /{" "}
                            {amount(payout.total_count, 0)}
                          </td>
                          <td>
                            <Status>{payout.status}</Status>
                          </td>
                          <td>{shortDate(payout.processed_at)}</td>
                          <td>
                            {external(payout.solscan_url) ? (
                              <a
                                className="ui-link"
                                href={external(payout.solscan_url)!}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                View transaction
                                <ArrowUpRight size={12} />
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
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
