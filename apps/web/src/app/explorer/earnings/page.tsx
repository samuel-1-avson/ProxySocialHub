"use client";
import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getProviderEarnings,
  isExplorerNotFound,
} from "@/lib/services/explorer";
import { explorerPublicEarningsEnabled } from "@/lib/navigation/explorer-nav";
import {
  DataError,
  EmptyState,
  Loading,
  Stat,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";
import {
  PeriodControl,
  RecordChart,
  RecordHeading,
  exportRecords,
} from "@/components/explorer/RecordPatterns";
export default function EarningsPage() {
  const enabled = explorerPublicEarningsEnabled();
  const [period, setPeriod] = useState("24h");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["provider-earnings", period, page],
    queryFn: ({ signal }) => getProviderEarnings(period, page, 20, signal),
    enabled,
    retry: false,
    refetchInterval: enabled ? 30000 : false,
  });
  const disabled = !enabled || isExplorerNotFound(query.error);
  const rows = query.data?.providers ?? [];
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));
  const summary = query.data?.summary;
  return (
    <div className="ui-page">
      <RecordHeading
        title="Provider earnings"
        description="Inspect reported public provider payouts. Personal balances and withdrawal tools are in the provider workspace."
      >
        <PeriodControl
          value={period}
          periods={["24h", "7d", "30d"]}
          onChange={(next) => {
            setPeriod(next);
            setPage(1);
          }}
        />
      </RecordHeading>
      {disabled ? (
        <EmptyState
          title="Public earnings feed is not enabled"
          description="This deployment does not publish provider earnings through the public explorer."
          href="/provider/earnings"
          action="Open provider earnings"
        />
      ) : (
        <>
          {query.isError && (
            <DataError
              title="Public earnings are unavailable"
              error={query.error}
              retry={() => void query.refetch()}
            />
          )}
          <div className="ui-stats">
            <Stat
              label="Total paid"
              value={amount(summary?.total_paid, 6) + " SOL"}
              detail="Reported for the selected period"
            />
            <Stat
              label="Active providers"
              value={amount(summary?.active_providers, 0)}
              detail="Providers in returned summary"
            />
            <Stat
              label="Average earnings"
              value={amount(summary?.avg_earning, 6) + " SOL"}
              detail="Per provider, as reported"
            />
            <Stat
              label="Payout transactions"
              value={amount(summary?.tx_count, 0)}
              detail="Reported transaction count"
            />
          </div>
          {query.isPending ? (
            <Loading label="Loading public earnings…" />
          ) : (
            query.data && (
              <>
                <RecordChart
                  title="Payout volume"
                  description="Reported volume across the selected period"
                  unit="SOL"
                  points={query.data.volume_chart ?? []}
                />
                <section>
                  <div className="ui-section-heading">
                    <h2>Provider records</h2>
                    <button
                      className="ui-button small secondary"
                      type="button"
                      disabled={!rows.length}
                      onClick={() =>
                        exportRecords(
                          "provider-earnings-" + period + ".csv",
                          [
                            "node_id",
                            "provider_address",
                            "sessions",
                            "bandwidth_gb",
                            "earned_sol",
                            "last_payout",
                          ],
                          rows.map((row) => [
                            row.node_id,
                            row.provider_address,
                            row.session_count,
                            row.bandwidth_gb,
                            row.total_earned,
                            row.last_payout,
                          ]),
                        )
                      }
                    >
                      <Download size={14} />
                      Export current page
                    </button>
                  </div>
                  {!rows.length ? (
                    <EmptyState
                      title="No earnings returned"
                      description="There are no provider records for this period."
                    />
                  ) : (
                    <div className="ui-surface record-table-scroll">
                      <table className="record-table">
                        <caption className="sr-only">
                          Public provider earnings
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Node</th>
                            <th scope="col">Provider address</th>
                            <th scope="col">Sessions</th>
                            <th scope="col">Bandwidth</th>
                            <th scope="col">Earned</th>
                            <th scope="col">Last payout</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.node_id}>
                              <th scope="row">
                                <Link
                                  className="ui-link"
                                  href={
                                    "/explorer/nodes/" +
                                    encodeURIComponent(row.node_id)
                                  }
                                >
                                  {row.node_id}
                                </Link>
                              </th>
                              <td>
                                <Link
                                  className="ui-link"
                                  href={
                                    "/explorer/wallets/" +
                                    encodeURIComponent(row.provider_address)
                                  }
                                >
                                  {row.provider_address}
                                </Link>
                              </td>
                              <td>{amount(row.session_count, 0)}</td>
                              <td>{amount(row.bandwidth_gb, 3)} GB</td>
                              <td>{amount(row.total_earned, 6)} SOL</td>
                              <td>{shortDate(row.last_payout)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="record-pagination">
                    <span>
                      Page {page} of {pages} · {amount(query.data.total, 0)}{" "}
                      records
                    </span>
                    <div className="ui-actions">
                      <button
                        type="button"
                        className="ui-button small secondary"
                        disabled={page <= 1 || query.isFetching}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="ui-button small secondary"
                        disabled={page >= pages || query.isFetching}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </section>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}
