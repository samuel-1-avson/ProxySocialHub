"use client";
import { useQuery } from "@tanstack/react-query";
import { getNetworkHealth, getHealthHistory } from "@/lib/services/explorer";
import {
  DataError,
  EmptyState,
  Loading,
  Stat,
  Status,
  amount,
  shortDate,
} from "@/components/workspace/Patterns";
import {
  RecordChart,
  RecordHeading,
} from "@/components/explorer/RecordPatterns";
function tone(status?: string) {
  return status === "healthy"
    ? ("good" as const)
    : status === "degraded"
      ? ("warning" as const)
      : status === "down"
        ? ("error" as const)
        : ("neutral" as const);
}
export default function HealthPage() {
  const query = useQuery({
    queryKey: ["network-health"],
    queryFn: ({ signal }) => getNetworkHealth(signal),
    refetchInterval: 15000,
    retry: false,
  });
  const history = useQuery({
    queryKey: ["health-history"],
    queryFn: ({ signal }) => getHealthHistory("24h", signal),
    refetchInterval: 60000,
    retry: false,
  });
  const data = query.data;
  const measurements = history.data?.history ?? [];
  const available = history.data?.metrics_available !== false;
  return (
    <div className="ui-page">
      <RecordHeading
        title="Network health"
        description="Inspect reported subsystem health and the last 24 hours of observations. An unavailable source does not establish an outage."
      >
        <Status tone={tone(data?.status)}>
          {data?.status || "Status unavailable"}
        </Status>
      </RecordHeading>
      {query.isPending && <Loading label="Checking reported network health…" />}
      {query.isError && (
        <DataError
          title="Current health is unavailable"
          error={query.error}
          retry={() => void query.refetch()}
        />
      )}
      <div className="ui-stats">
        <Stat
          label="Solana RPC"
          value={data?.solana_health || "Unknown"}
          detail="Status reported by the health service"
        />
        <Stat
          label="Database"
          value={data?.database_health || "Unknown"}
          detail="Status reported by the health service"
        />
        <Stat
          label="Active nodes"
          value={amount(data?.active_nodes, 0)}
          detail="Reported relay count"
        />
        <Stat
          label="Average response"
          value={data ? amount(data.avg_response_time_ms, 0) + " ms" : "—"}
          detail="Response time reported by the service"
        />
      </div>
      {data?.last_checked && (
        <p className="ui-subtle">
          Last checked · {shortDate(data.last_checked)}
        </p>
      )}
      {history.isPending ? (
        <Loading label="Loading health history…" />
      ) : history.isError ? (
        <DataError
          title="Health history is unavailable"
          error={history.error}
          retry={() => void history.refetch()}
        />
      ) : (
        <>
          {available && (
            <section className="ui-surface record-health-summary">
              <div>
                <p className="ui-eyebrow">Last 24 hours</p>
                <h2>
                  {amount(history.data.uptime_percent, 2)}% reported uptime
                </h2>
              </div>
              <p>{measurements.length} observations returned</p>
            </section>
          )}
          <div className="record-chart-grid">
            <RecordChart
              title="Active nodes"
              description="Last 24 hours"
              points={
                available
                  ? measurements.map((point) => ({
                      timestamp: point.timestamp,
                      value: point.active_nodes,
                    }))
                  : []
              }
              unavailable={
                !available
                  ? history.data.message ||
                    "History aggregation is not available."
                  : undefined
              }
            />
            <RecordChart
              title="Response time"
              description="Average response per observation"
              unit="ms"
              points={
                available
                  ? measurements.map((point) => ({
                      timestamp: point.timestamp,
                      value: point.avg_response_ms,
                    }))
                  : []
              }
              unavailable={
                !available
                  ? history.data.message ||
                    "History aggregation is not available."
                  : undefined
              }
            />
          </div>
          <section>
            <div className="ui-section-heading">
              <h2>Health event log</h2>
              <span className="ui-subtle">Returned events</span>
            </div>
            {history.data.events?.length ? (
              <ol className="ui-surface record-events">
                {history.data.events.map((event, index) => (
                  <li key={event.timestamp + index}>
                    <Status tone={tone(event.status)}>{event.status}</Status>
                    <div>
                      <strong>{event.message || "Network observation"}</strong>
                      <p>
                        {event.subsystem || "Network"} ·{" "}
                        {shortDate(event.timestamp)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="No events returned"
                description="This source returned no events for the selected period. Check the current subsystem status above."
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
