"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getLeaderboard } from "@/lib/services/explorer";
import {
  DataError,
  EmptyState,
  Loading,
  Status,
  amount,
} from "@/components/workspace/Patterns";
import {
  PeriodControl,
  RecordHeading,
} from "@/components/explorer/RecordPatterns";
const categories = [
  { id: "uptime", label: "Uptime", unit: "%" },
  { id: "bandwidth", label: "Bandwidth", unit: "GB" },
  { id: "sessions", label: "Sessions", unit: "sessions" },
];
export default function LeaderboardPage() {
  const router = useRouter();
  const params = useSearchParams();
  const category =
    categories.find((item) => item.id === params.get("category")) ??
    categories[0];
  const [period, setPeriod] = useState("24h");
  const query = useQuery({
    queryKey: ["leaderboard", category.id, period],
    queryFn: ({ signal }) => getLeaderboard(category.id, period, signal),
    retry: false,
    refetchInterval: 30000,
  });
  const entries = query.data?.entries ?? [];
  return (
    <div className="ui-page">
      <RecordHeading
        title="Node leaderboard"
        description="Compare reported node performance by uptime, bandwidth, or sessions. Rankings reflect the returned source and reporting window."
      >
        <PeriodControl value={period} onChange={setPeriod} />
      </RecordHeading>
      <div className="ui-tabs" role="group" aria-label="Ranking metric">
        {categories.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={category.id === item.id}
            className={category.id === item.id ? "active" : ""}
            onClick={() => {
              const next = new URLSearchParams(params.toString());
              next.set("category", item.id);
              router.replace("/explorer/leaderboard?" + next.toString(), {
                scroll: false,
              });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {query.data?.note && <p className="workflow-note">{query.data.note}</p>}
      {query.data?.period_applied === false && (
        <p className="workflow-note">
          The source does not apply the selected period. These rankings reflect
          the available snapshot.
        </p>
      )}
      {query.isPending ? (
        <Loading label="Loading node rankings…" />
      ) : query.isError ? (
        <DataError
          title="Rankings are unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !entries.length ? (
        <EmptyState
          title="No rankings returned"
          description="Try a different metric or reporting period."
        />
      ) : (
        <section className="ui-surface">
          <div className="record-table-scroll">
            <table className="record-table">
              <caption className="sr-only">
                Node rankings by {category.label}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Node</th>
                  <th scope="col">Region</th>
                  <th scope="col">Role</th>
                  <th scope="col">{category.label}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.node_id}>
                    <td>
                      <span className="record-rank">
                        {entry.rank ?? index + 1}
                      </span>
                    </td>
                    <th scope="row">
                      <Link
                        className="ui-link"
                        href={
                          "/explorer/nodes/" + encodeURIComponent(entry.node_id)
                        }
                      >
                        {entry.name || entry.node_id}
                      </Link>
                      <span className="record-id">
                        {entry.name ? entry.node_id : ""}
                      </span>
                    </th>
                    <td>
                      {[entry.country, entry.region]
                        .filter(Boolean)
                        .join(" · ") || "Not reported"}
                    </td>
                    <td>
                      <Status>
                        {entry.is_validator ? "Validator" : "Proxy"}
                      </Status>
                    </td>
                    <td className="record-value">
                      {amount(
                        category.id === "uptime"
                          ? entry.uptime_percent
                          : category.id === "bandwidth"
                            ? entry.bandwidth_gb
                            : entry.active_sessions,
                        category.id === "sessions" ? 0 : 3,
                      )}{" "}
                      {category.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {query.data?.data_source && (
        <p className="ui-subtle">Data source · {query.data.data_source}</p>
      )}
    </div>
  );
}
