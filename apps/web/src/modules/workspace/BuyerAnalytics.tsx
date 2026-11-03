"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { apiGet } from '@/lib/api/client';
import { measurement, measured, sumMeasurements } from '@/lib/measurements';
import { PageHeading, Stat, Loading, DataError } from '@/components/workspace/Patterns';

type Observation = Record<string, unknown>;
type Series = { data: Observation[] };
type Source = { isLoading: boolean; isError: boolean; error: unknown; data?: unknown; refetch: () => unknown };
type Column = { key: string; label: string; unit?: string; text?: boolean; digits?: number };

function useObservation<T>(key: string, endpoint: string, days: number, series = false) {
  const { user, isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ['buyer-analytics', user?.id, key, days],
    queryFn: async () => {
      const data = await apiGet<T>(endpoint);
      if (series && !Array.isArray((data as Series)?.data)) throw new Error('The source did not return measurement records.');
      return data;
    },
    enabled: isAuthenticated, staleTime: 15_000, refetchInterval: 30_000,
  });
}
function SourceState({ source }: { source: Source }) {
  return <>
    {source.isLoading && <Loading label="Loading reported measurements…" />}
    {source.isError && <>
      <DataError error={source.error} retry={() => { void source.refetch(); }} />
      {source.data !== undefined && <p className="ui-note">Previously loaded values may be stale.</p>}
    </>}
  </>;
}
function MeasurementTable({ title, rows, columns }: { title: string; rows: Observation[]; columns: Column[] }) {
  return <div className="ui-table-wrap" role="region" aria-label={title} tabIndex={0}>
    <table className="ui-table">
      <thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => <td key={column.key}>
        {column.text
          ? (typeof row[column.key] === 'string' && row[column.key] ? String(row[column.key]) : 'Not reported')
          : measured(row[column.key], column.digits ?? 2, column.unit)}
      </td>)}</tr>)}</tbody>
    </table>
    {!rows.length && <p className="ui-note">No measurements were returned.</p>}
  </div>;
}

export function BuyerAnalytics() {
  const [days, setDays] = useState(7);
  const overview = useObservation<Observation>('overview', '/v1/analytics/overview', days);
  const daily = useObservation<Series>('daily', `/v1/analytics/usage/daily?days=${days}`, days, true);
  const geography = useObservation<Series>('geography', '/v1/analytics/geo', days, true);
  const destinations = useObservation<Series>('destinations', '/v1/analytics/top-destinations', days, true);
  const network = useObservation<Observation & { node_scores?: Observation[] }>('network', '/v1/network/status', days);
  const dailyRows = daily.data?.data || [];
  const cost = daily.isSuccess ? sumMeasurements(dailyRows.map(point => point.cost_sol)) : undefined;
  const requests = measurement(overview.data?.total_requests);
  const success = measurement(overview.data?.success_rate);
  const bandwidth = dailyRows.map(point => measurement(point.gb_used));
  const maximum = Math.max(0, ...bandwidth.filter((value): value is number => value !== undefined));

  return <div className="ui-page">
    <PageHeading title="Traffic analytics" description="Reported account usage, destinations and network observations."
      actions={<Link className="ui-button secondary" href="/app/activity?tab=usage">Usage & billing →</Link>} />
    <p className="ui-note">Sources refresh every 30 seconds. Unavailable measurements stay unavailable.</p>
    <SourceState source={overview} />
    <section className="ui-stats" aria-label="Reported traffic totals">
      <Stat label="Total bandwidth" value={measured(overview.data?.total_bandwidth_gb, 3, 'GB')} detail="Account usage record" />
      <Stat label="Success rate" value={requests !== undefined && requests > 0 && success !== undefined ? measured(success * 100, 1, '%') : 'Not reported'} detail="Across reported requests" />
      <Stat label="Average latency" value={requests !== undefined && requests > 0 ? measured(overview.data?.avg_latency_ms, 1, 'ms') : 'Not reported'} detail="Across reported requests" />
      <Stat label="Active sessions" value={measured(overview.data?.active_sessions, 0)} detail="Reported session count" />
    </section>
    <section className="ui-surface">
      <div className="ui-section-heading">
        <h2>Daily usage</h2>
        <label className="ui-field">Period
          <select className="ui-select" value={days} onChange={event => setDays(Number(event.target.value))}>
            {[7, 14, 30].map(value => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
      </div>
      <SourceState source={daily} />
      {daily.data && <>
        {maximum > 0 && <div className="flex h-32 items-end gap-1" role="img" aria-label="Reported daily bandwidth; exact values follow in the table">
          {dailyRows.map((point, index) => <div key={index} className="flex-1 bg-primary"
            style={{ height: `${((bandwidth[index] ?? 0) / maximum) * 100}%` }}
            title={`${String(point.date)} · ${measured(point.gb_used, 3, 'GB')}`} />)}
        </div>}
        <MeasurementTable title="Daily usage measurements" rows={dailyRows} columns={[
          { key: 'date', label: 'Date', text: true }, { key: 'gb_used', label: 'Bandwidth', digits: 3, unit: 'GB' },
          { key: 'cost_sol', label: 'Source cost estimate', digits: 6, unit: 'SOL' }, { key: 'requests', label: 'Source records', digits: 0 },
        ]} />
        <p className="ui-note">Analytics cost estimate: {measured(cost, 6, 'SOL')}. Settled charges and order receipts are in Activity. Values in other currencies are not treated as SOL.</p>
      </>}
    </section>
    <section className="ui-surface">
      <h2>Traffic by country</h2><SourceState source={geography} />
      {geography.data && <MeasurementTable title="Traffic by country" rows={geography.data.data} columns={[
        { key: 'country_name', label: 'Country', text: true }, { key: 'request_count', label: 'Requests', digits: 0 }, { key: 'bytes_used', label: 'Bytes', digits: 0 },
      ]} />}
    </section>
    <section className="ui-surface">
      <h2>Top destinations</h2><SourceState source={destinations} />
      {destinations.data && <MeasurementTable title="Reported destinations" rows={destinations.data.data} columns={[
        { key: 'domain', label: 'Destination', text: true }, { key: 'request_count', label: 'Requests', digits: 0 },
        { key: 'bytes_used', label: 'Bytes', digits: 0 }, { key: 'avg_latency_ms', label: 'Latency', digits: 1, unit: 'ms' },
      ]} />}
    </section>
    <section className="ui-surface">
      <h2>Reported network observations</h2><SourceState source={network} />
      {network.data && <>
        <p className="ui-note">{measured(network.data.healthy_nodes, 0)} healthy-flagged ({measured(network.data.healthy_recently_observed_nodes, 0)} observed in the last {measured(typeof network.data.stale_after_seconds === 'number' ? network.data.stale_after_seconds / 60 : undefined, 0, 'min')}) / {measured(network.data.total_nodes, 0)} registered nodes · {measured(network.data.avg_latency, 1, 'ms')} average reported latency across {measured(network.data.latency_sample_size, 0)} samples{typeof network.data.last_observed_at === 'string' && network.data.last_observed_at ? ` · last node seen ${new Date(network.data.last_observed_at).toLocaleString()}` : ' · no node observation reported'}.</p>
        {Array.isArray(network.data.node_scores) && <MeasurementTable title="Reported node scores" rows={network.data.node_scores} columns={[
          { key: 'id', label: 'Node', text: true }, { key: 'country', label: 'Country', text: true }, { key: 'score', label: 'Source score' },
        ]} />}
      </>}
    </section>
    <section className="ui-surface">
      <h2>Account observations</h2>
      <dl className="explorer-detail-fields">
        <div><dt>Top country</dt><dd>{String(overview.data?.top_country || 'Not reported')}</dd></div>
        <div><dt>Top carrier</dt><dd>{String(overview.data?.top_isp || 'Not reported')}</dd></div>
        <div><dt>Unique destinations</dt><dd>{measured(overview.data?.unique_destinations, 0)}</dd></div>
      </dl>
    </section>
  </div>;
}
