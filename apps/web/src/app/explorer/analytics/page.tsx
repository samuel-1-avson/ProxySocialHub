"use client";
import { useHydrated } from "@/hooks/useHydrated";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAnalytics, getExplorerMetrics } from "@/lib/services/explorer";
import {
  DataError,
  Loading,
  Stat,
  amount,
} from "@/components/workspace/Patterns";
import {
  PeriodControl,
  RecordChart,
  RecordHeading,
} from "@/components/explorer/RecordPatterns";
export default function AnalyticsPage() {
  const ready = useHydrated();
  const [period, setPeriod] = useState("24h");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const query = useQuery({
    queryKey: ["analytics", period, range?.from, range?.to],
    queryFn: ({ signal }) =>
      getAnalytics(period, range?.from, range?.to, signal),
    retry: false,
    refetchInterval: range ? false : 60000,
  });
  const metrics = useQuery({
    queryKey: ["explorer-metrics", "all"],
    queryFn: ({ signal }) => getExplorerMetrics("all", signal),
    retry: false,
    refetchInterval: 30000,
  });
  const unavailable =
    query.data?.metrics_available === false
      ? query.data.message ||
        "This source does not provide aggregated measurements."
      : undefined;
  return (
    <div className="ui-page">
      <RecordHeading
        title="Network analytics"
        description="Explore reported throughput and activity. Cumulative totals and period measurements are shown separately."
      >
        <PeriodControl
          value={range ? "" : period}
          onChange={(next) => {
            setPeriod(next);
            setRange(null);
          }}
        />
      </RecordHeading>
      <form
        className="ui-surface record-date-range"
        onSubmit={(event) => {
          event.preventDefault();
          if (from && to && from <= to) setRange({ from, to });
        }}
      >
        <div>
          <label htmlFor="analytics-from">From date</label>
          <input
            id="analytics-from"
            disabled={!ready}
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="analytics-to">To date</label>
          <input
            id="analytics-to"
            disabled={!ready}
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            required
          />
        </div>
        <button
          className="ui-button secondary"
          disabled={!from || !to || from > to}
        >
          Apply date range
        </button>
        {range && (
          <button
            type="button"
            className="ui-button ghost"
            onClick={() => setRange(null)}
          >
            Clear date range
          </button>
        )}
      </form>
      {range && (
        <p className="workflow-note">
          Applied date range: {range.from} through {range.to}.
        </p>
      )}
      {metrics.isError && (
        <DataError
          title="Network totals are unavailable"
          error={metrics.error}
          retry={() => void metrics.refetch()}
        />
      )}
      <div className="ui-stats">
        {[
          {
            label: "Transactions per second",
            value: amount(metrics.data?.transactions_per_second, 3),
            detail: "Reported network throughput",
          },
          {
            label: "Cumulative volume",
            value: amount(metrics.data?.total_volume, 4) + " SOL",
            detail: "All returned settlement records",
          },
          {
            label: "Cumulative bandwidth",
            value: amount(metrics.data?.total_bandwidth_gb, 3) + " GB",
            detail: "Total reported network bandwidth",
          },
          {
            label: "Active wallets",
            value: amount(metrics.data?.active_wallets, 0),
            detail: "Reported by the metrics source",
          },
        ].map((stat) => (
          <Stat key={stat.label} {...stat} />
        ))}
      </div>
      {query.isPending ? (
        <Loading label="Loading analytics…" />
      ) : query.isError ? (
        <DataError
          title="Analytics are unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : (
        <div className="record-chart-grid">
          <RecordChart
            title="Transaction volume"
            description="Reported SOL per measurement"
            points={unavailable ? [] : query.data.transaction_volume}
            unit="SOL"
            unavailable={unavailable}
          />
          <RecordChart
            title="Bandwidth"
            description="Reported network throughput"
            points={unavailable ? [] : query.data.bandwidth_gb}
            unit="GB"
            unavailable={unavailable}
          />
          <RecordChart
            title="Active nodes"
            description="Reported active relay count over time"
            points={unavailable ? [] : query.data.active_nodes}
            unavailable={unavailable}
          />
          <RecordChart
            title="Active wallets"
            description="Reported wallet activity over time"
            points={unavailable ? [] : query.data.active_wallets}
            unavailable={unavailable}
          />
        </div>
      )}
      <section className="ui-surface record-regions">
        <div className="ui-section-heading">
          <div>
            <h2>Nodes by region</h2>
            <p className="ui-subtle">
              Current distribution from the metrics source
            </p>
          </div>
        </div>
        {Object.entries(metrics.data?.region_distribution ?? {}).length ? (
          <dl>
            {Object.entries(metrics.data!.region_distribution!).map(
              ([region, count]) => (
                <div key={region}>
                  <dt>{region}</dt>
                  <dd>{amount(count, 0)}</dd>
                </div>
              ),
            )}
          </dl>
        ) : (
          <p className="ui-subtle">
            {metrics.isError
              ? "Region data is unavailable."
              : "No region distribution returned."}
          </p>
        )}
      </section>
    </div>
  );
}
