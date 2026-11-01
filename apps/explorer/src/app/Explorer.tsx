"use client";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { BrandSymbol, ThemeSymbol, ArrowSymbol, SearchSymbol } from "./SiteIcons";
import type { PublicResource } from "../lib/public-data";
type Data = Record<string, unknown>;
const PublicNodeMap = dynamic(() => import("./PublicNodeMap"), {
  ssr: false,
  loading: () => <p className="ui-loading" role="status">Loading geographic map…</p>,
});
const record = (value: unknown): Data =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
const records = (value: unknown): Data[] =>
  Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown, fallback = "Not reported") =>
  (typeof value === "string" && value) ||
  (typeof value === "number" && Number.isFinite(value))
    ? String(value)
    : fallback;
const num = (value: unknown, digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: digits })
    : "Not available";
const observed = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleString()
    : "Observation time unavailable";
const subscribe = () => () => {};
function usePublic(
  resource: PublicResource,
  id?: string,
  page = 1,
  filters: Record<string, string> = {},
) {
  const filterKey = new URLSearchParams(
    Object.entries(filters).sort(([left], [right]) => left.localeCompare(right)),
  ).toString();
  const key = `${resource}:${id || ""}:${page}:${filterKey}`;
  const [result, setResult] = useState<{
    key: string;
    data?: Data;
    error?: string;
    loading: boolean;
  }>({ key, loading: true });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const load = async () => {
      setResult((previous) =>
        previous.key === key
          ? { ...previous, loading: !previous.data }
          : { key, loading: true },
      );
      try {
        const query = new URLSearchParams({ resource, page: String(page) });
        if (id) query.set("id", id);
        new URLSearchParams(filterKey).forEach((value, name) =>
          query.set(name, value),
        );
        const response = await fetch(`/api/public?${query}`, {
          credentials: "omit",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(text(body.error, "Public source unavailable."));
        if (current) setResult({ key, data: record(body), loading: false });
      } catch (error) {
        if (current && !controller.signal.aborted)
          setResult((previous) => ({
            key,
            data: previous.key === key ? previous.data : undefined,
            error:
              error instanceof Error
                ? error.message
                : "Public source unavailable.",
            loading: false,
          }));
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      current = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [key, resource, id, page, filterKey, version]);
  return {
    ...(result.key === key ? result : { key, loading: true }),
    retry: () => setVersion((value) => value + 1),
  };
}
type Period = "1h" | "24h" | "7d" | "30d";
const periods: Period[] = ["1h", "24h", "7d", "30d"];
function usePeriod() {
  const [period, setPeriod] = useState<Period>("24h");
  useEffect(() => {
    const sync = () => {
      const value = new URL(window.location.href).searchParams.get("period");
      if (periods.includes(value as Period)) setPeriod(value as Period);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const update = (value: Period) => {
    setPeriod(value);
    const url = new URL(window.location.href);
    url.searchParams.set("period", value);
    window.history.replaceState({}, "", url);
  };
  return [period, update] as const;
}
function PeriodSelect({
  value,
  onChange,
}: {
  value: Period;
  onChange: (value: Period) => void;
}) {
  return (
    <label className="ui-control">
      <span>Time window</span>
      <select
        className="ui-select"
        aria-label="Time window"
        value={value}
        onChange={(event) => onChange(event.target.value as Period)}
      >
        <option value="1h">Last hour</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>
    </label>
  );
}
function SourceState({ source }: { source: ReturnType<typeof usePublic> }) {
  return (
    <>
      {source.loading && (
        <p className="ui-loading" role="status">
          Loading public evidence…
        </p>
      )}
      {source.error && (
        <div className="ui-error" role="alert">
          <strong>
            {source.data
              ? "Showing the last loaded record"
              : "Public evidence unavailable"}
          </strong>
          <p>{source.error}</p>
          {source.data && <p>Values below may be stale.</p>}
          <button className="ui-button small secondary" onClick={source.retry}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}
function Theme({ system = false }: { system?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (system) return <button className="explorer-device-theme" onClick={() => setTheme("system")} aria-pressed={mounted && theme === "system"}>Use device appearance</button>;
  const dark = mounted && resolvedTheme === "dark";
  return <button type="button" className="ph-theme-toggle" disabled={!mounted} aria-label={mounted ? `Switch to ${dark ? "light" : "dark"} theme` : "Loading color theme"} onClick={() => setTheme(dark ? "light" : "dark")}><ThemeSymbol dark={dark} /></button>;
}
function Status({ value }: { value: unknown }) {
  const label = text(value, "Unknown");
  return (
    <span
      className={`ui-status ${["healthy", "confirmed", "active", "passed", "executed"].includes(label.toLowerCase()) ? "good" : ["degraded", "pending", "unknown", "partial"].includes(label.toLowerCase()) ? "warning" : "neutral"}`}
    >
      {label.replace(/_/g, " ")}
    </span>
  );
}
function Heading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="ui-page-header">
      <div>
        <div className="ui-eyebrow">Public explorer</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </header>
  );
}
function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <div className="explorer-stat">
      <div className="ui-stat-label">{label}</div>
      <div className="ui-stat-value">{value}</div>
      <p className="ui-stat-detail">{detail}</p>
    </div>
  );
}
function appHref(path: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || "https://proxyhubb.com";
  try {
    const base = new URL(configured);
    if (
      base.protocol === "https:" ||
      (base.protocol === "http:" && process.env.NODE_ENV !== "production")
    )
      return new URL(path, base).toString();
  } catch {
    /* Safe public default. */
  }
  return `https://proxyhubb.com${path}`;
}
function Search() {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [type, setType] = useState("transactions");
  useEffect(() => {
    const sync = () => {
      const query = new URL(window.location.href).searchParams;
      const requested = query.get("type");
      setType(requested && ["transactions", "blocks", "nodes", "wallets", "contracts"].includes(requested) ? requested : "transactions");
      setTerm((query.get("q") || "").slice(0, 160));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return (
    <form
      className="explorer-search"
      role="search"
      aria-label="Public records"
      onSubmit={(event) => {
        event.preventDefault();
        if (term.trim())
          router.push(`/${type}/${encodeURIComponent(term.trim())}`);
      }}
    >
      <label className="sr-only" htmlFor="public-search">
        Public identifier
      </label>
      <span className="explorer-search-icon"><SearchSymbol /></span>
      <input
        id="public-search"
        className="ui-input"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Transaction hash, block, node, or address…"
        maxLength={160}
        required
      />
      <select
        className="ui-select"
        aria-label="Record type"
        value={type}
        onChange={(event) => setType(event.target.value)}
      >
        <option value="transactions">Transaction</option>
        <option value="blocks">Block</option>
        <option value="nodes">Node</option>
        <option value="wallets">Wallet</option>
        <option value="contracts">Program</option>
      </select>
      <button className="ui-button" type="submit">
        Search records <ArrowSymbol />
      </button>
    </form>
  );
}
function MetricSummary() {
  const metrics = usePublic("metrics");
  return (
    <>
      <SourceState source={metrics} />
      <section className="ui-stats explorer-stats">
        <Stat
          label="Active nodes"
          value={num(metrics.data?.active_nodes, 0)}
          detail="Reported network population"
        />
        <Stat
          label="Indexed transactions"
          value={num(metrics.data?.total_transactions, 0)}
          detail="Public indexer aggregate"
        />
        <Stat
          label="Reported bandwidth"
          value={
            metrics.data?.total_bandwidth_gb != null
              ? `${num(metrics.data.total_bandwidth_gb)} GB`
              : "Not available"
          }
          detail="Cumulative indexed bandwidth"
        />
        <Stat
          label="Latest indexed block"
          value={num(metrics.data?.block_height, 0)}
          detail="Source block height"
        />
      </section>
      {metrics.data && (
        <p className="explorer-source">
          Source: {text(metrics.data.data_source, "Public indexer")} ·{" "}
          {observed(metrics.data.last_updated)}
        </p>
      )}
    </>
  );
}
function TrendChart({
  title,
  unit,
  points,
}: {
  title: string;
  unit: string;
  points: Data[];
}) {
  const values = points
    .map((point) => ({
      time: point.timestamp,
      value: point.value,
    }))
    .filter(
      (point): point is { time: unknown; value: number } =>
        typeof point.value === "number" && Number.isFinite(point.value),
    );
  const max = Math.max(0, ...values.map((point) => point.value));
  const min = Math.min(0, ...values.map((point) => point.value));
  const span = Math.max(max - min, 1);
  const line = values
    .map((point, index) => {
      const x = values.length < 2 ? 320 : 16 + (index / (values.length - 1)) * 608;
      const y = 144 - ((point.value - min) / span) * 124;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <section className="ui-surface explorer-chart">
      <div className="ui-section-heading">
        <h2>{title}</h2>
        <span className="explorer-chart-count">
          {values.length ? `${values.length} observations` : "No observations"}
        </span>
      </div>
      {values.length ? (
        <>
          <svg
            className="explorer-line-chart"
            viewBox="0 0 640 168"
            role="img"
            aria-label={`${title}, ${values.length} reported observations`}
          >
            <title>{title}</title>
            {[20, 62, 103, 144].map((y) => (
              <line
                key={y}
                x1="16"
                x2="624"
                y1={y}
                y2={y}
                className="explorer-chart-gridline"
              />
            ))}
            <polyline points={line} className="explorer-chart-line" />
            {values.length === 1 && (
              <circle
                cx="320"
                cy={144 - ((values[0].value - min) / span) * 124}
                r="4"
                className="explorer-chart-point"
              />
            )}
          </svg>
          <dl className="explorer-chart-axis">
            {[values[0], values[values.length - 1]].map((point, index) => <div key={index}><dt>{observed(point.time)}</dt><dd>{num(point.value, 4)} {unit}</dd></div>)}
          </dl>
          <p className="explorer-chart-summary">
            {num(min)}–{num(max)} {unit} across the selected window. Values are
            reported by the public metrics source.
          </p>
          <details className="explorer-chart-data">
            <summary>Show measurement values</summary>
            <div className="ui-table-wrap" role="region" aria-label={`${title} values`} tabIndex={0}>
              <table className="ui-table">
                <thead>
                  <tr><th>Observed</th><th>{title} ({unit})</th></tr>
                </thead>
                <tbody>
                  {values.map((point, index) => (
                    <tr key={`${String(point.time)}-${index}`}>
                      <td>{observed(point.time)}</td><td>{num(point.value, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <div className="explorer-chart-empty">
          Time-series measurements have not been reported for this window.
        </div>
      )}
    </section>
  );
}
function Health({ period = "24h" }: { period?: Period }) {
  const health = usePublic("health");
  const trust = usePublic("trust");
  const historyPeriod = period === "1h" ? "24h" : period;
  const history = usePublic("health-history", undefined, 1, { period: historyPeriod });
  const historyPoints = records(history.data?.history);
  return (
    <>
      <div className="ui-columns">
        <section className="ui-surface">
          <div className="ui-section-heading">
            <h2>Network & source health</h2>
            <Status value={health.data?.status} />
          </div>
          <SourceState source={health} />
          {health.data ? (
            <>
              <div className="ui-row"><span>Solana source</span><Status value={health.data.solana_health} /></div>
              <div className="ui-row"><span>Database source</span><Status value={health.data.database_health} /></div>
              <p className="explorer-source">Last checked · {observed(health.data.last_checked)}</p>
            </>
          ) : !health.loading && !health.error ? (
            <p className="ui-note">No source-health observation is available.</p>
          ) : null}
        </section>
        <section className="ui-surface">
          <h2>Writer evidence</h2>
          <SourceState source={trust} />
          {trust.data ? (
            <>
              <div className="ui-row"><span>Observed / required writers</span><strong>{num(trust.data.unique_writers, 0)} / {num(trust.data.min_writers_required, 0)}</strong></div>
              <div className="ui-row"><span>Indexing mode</span><span>{text(trust.data.explorer_mode).replace(/_/g, " ")}</span></div>
              <div className="ui-row"><span>Full decentralization reported</span><span>{trust.data.fully_decentralized === true ? "Yes" : trust.data.fully_decentralized === false ? "No" : "Not reported"}</span></div>
              <p className="explorer-source">Last updated · {observed(trust.data.last_updated)}</p>
            </>
          ) : !trust.loading && !trust.error ? (
            <p className="ui-note">Writer attestations have not been reported.</p>
          ) : null}
        </section>
      </div>
      <section className="explorer-history">
        <div className="ui-section-heading">
          <div><h2>Network history</h2><p className="ui-note">Reported active nodes and health by observation window.</p></div>
          <span className="explorer-chart-count">{historyPeriod === "24h" && period === "1h" ? "last 24h" : historyPeriod}</span>
        </div>
        <SourceState source={history} />
        {history.data?.metrics_available === false ? (
          <p className="explorer-chart-empty">{text(history.data.message, "No historical health measurements have been reported yet.")}</p>
        ) : historyPoints.length ? (
          <div className="explorer-history-list">
            {historyPoints.map((point, index) => (
              <div className="explorer-history-item" key={`${String(point.timestamp)}-${index}`}>
                <span>{observed(point.timestamp)}</span>
                <Status value={point.status} />
                <strong>{num(point.active_nodes, 0)} active nodes</strong>
              </div>
            ))}
          </div>
        ) : !history.loading && !history.error ? (
          <p className="explorer-chart-empty">No historical health measurements have been reported for this window.</p>
        ) : null}
      </section>
    </>
  );
}
function Ledger({ blocks = false }: { blocks?: boolean }) {
  const [page, setPage] = useState(1);
  const source = usePublic(blocks ? "blocks" : "transactions", undefined, page);
  const rows = records(source.data?.[blocks ? "blocks" : "transactions"]);
  const total =
    typeof source.data?.total === "number" ? source.data.total : undefined;
  return (
    <>
      <nav className="ui-tabs" aria-label="Ledger views">
        <Link className={!blocks ? "active" : ""} href="/transactions">
          Transactions
        </Link>
        <Link className={blocks ? "active" : ""} href="/blocks">
          Blocks
        </Link>
        <Link href="/search">Address lookup</Link>
      </nav>
      <SourceState source={source} />
      {source.data && (
        <div
          className="ui-table-wrap"
          role="region"
          aria-label={blocks ? "Public blocks" : "Public transactions"}
          tabIndex={0}
        >
          <table className="ui-table explorer-ledger-table">
            <thead>
              <tr>
                <th>{blocks ? "Block" : "Transaction"}</th>
                <th>{blocks ? "Transactions" : "State"}</th>
                <th>{blocks ? "Observed" : "Amount"}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = text(blocks ? row.block_number : row.tx_hash, "");
                return (
                  <tr key={id}>
                    <td>
                      <Link
                        className="ui-link"
                        href={`/${blocks ? "blocks" : "transactions"}/${encodeURIComponent(id)}`}
                      >
                        {id.length > 24
                          ? `${id.slice(0, 18)}…${id.slice(-5)}`
                          : id}
                      </Link>
                      {!blocks && <p>{text(row.tx_type).replace(/_/g, " ")}</p>}
                    </td>
                    <td data-label={blocks ? "Transactions" : "State"}>
                      {blocks ? (
                        num(row.transaction_count, 0)
                      ) : (
                        <Status value={row.status} />
                      )}
                    </td>
                    <td data-label={blocks ? "Observed" : "Amount"}>
                      {blocks
                        ? observed(row.timestamp)
                        : `${num(row.amount, 6)} ${text(row.currency, "")}`}
                    </td>
                    <td>
                      <Link
                        className="ui-button small secondary"
                        href={`/${blocks ? "blocks" : "transactions"}/${encodeURIComponent(id)}`}
                      >
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <p className="ui-note">No records were returned for this page.</p>
          )}
        </div>
      )}
      <div className="ui-pagination">
        <button
          className="ui-button secondary small"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page === 1}
        >
          Previous
        </button>
        <span>
          Page {page}
          {total != null ? ` · ${total} records` : ""}
        </span>
        <button
          className="ui-button secondary small"
          onClick={() => setPage((value) => value + 1)}
          disabled={rows.length < 20 || (total != null && page * 20 >= total)}
        >
          Next
        </button>
      </div>
    </>
  );
}
type NodeView = "inventory" | "map" | "compare" | "rankings";
const nodeViews: Array<[NodeView, string]> = [
  ["inventory", "Inventory"],
  ["map", "Regional map"],
  ["compare", "Compare"],
  ["rankings", "Rankings"],
];
function updateQuery(updates: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url);
}
function RegionalMap({ source }: { source: ReturnType<typeof usePublic> }) {
  const rows = records(source.data?.nodes);
  const clusters = new Map<string, { lat: number; lon: number; count: number; active: number }>();
  const regions = new Map<string, { count: number; active: number }>();
  for (const row of rows) {
    const lat = row.lat;
    const lon = row.lon;
    if (typeof lat === "number" && typeof lon === "number") {
      const key = `${lat}:${lon}`;
      const cluster = clusters.get(key) || { lat, lon, count: 0, active: 0 };
      cluster.count += 1;
      if (row.is_active === true) cluster.active += 1;
      clusters.set(key, cluster);
    }
    const region = text(row.region, text(row.country, "Unspecified region"));
    const entry = regions.get(region) || { count: 0, active: 0 };
    entry.count += 1;
    if (row.is_active === true) entry.active += 1;
    regions.set(region, entry);
  }
  const sortedRegions = [...regions.entries()].sort((a, b) => b[1].count - a[1].count);
  return (
    <section className="ui-surface explorer-map-card" aria-labelledby="regional-map-title">
      <div className="ui-section-heading">
        <div>
          <h2 id="regional-map-title">Regional node footprint</h2>
          <p className="ui-note">A public view of node coverage and reported state.</p>
        </div>
        <span className="explorer-chart-count">{num(source.data?.total, 0)} reported</span>
      </div>
      <SourceState source={source} />
      {clusters.size ? (
        <>
          <PublicNodeMap nodes={rows} />
          <div className="explorer-region-grid" aria-label="Node counts by reported region">
            {sortedRegions.slice(0, 8).map(([region, counts]) => (
              <div className="explorer-region-row" key={region}>
                <span>{region}</span><strong>{counts.count}</strong><small>{counts.active} active</small>
              </div>
            ))}
          </div>
        </>
      ) : source.loading ? null : source.error ? null : (
        <div className="explorer-chart-empty">No public node locations have been reported.</div>
      )}
    </section>
  );
}
function RegionalMapView() {
  const source = usePublic("node-geo");
  return <RegionalMap source={source} />;
}
function NodeRankings({
  period,
  onPeriodChange,
}: {
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  const [category, setCategory] = useState("uptime");
  useEffect(() => {
    const metric = new URL(window.location.href).searchParams.get("metric");
    if (metric && ["uptime", "bandwidth", "sessions"].includes(metric))
      setCategory(metric);
  }, []);
  const source = usePublic("leaderboard", undefined, 1, { category, period });
  const rows = records(source.data?.entries);
  const valueLabel = category === "bandwidth" ? "Reported bandwidth" : category === "sessions" ? "Active sessions" : "Reported uptime";
  return (
    <section className="ui-surface">
      <div className="ui-section-heading"><div><h2>Measured node rankings</h2><p className="ui-note">Ranked by the selected public metric; scores are not buying recommendations.</p></div><PeriodSelect value={period} onChange={onPeriodChange} /></div>
      <div className="explorer-toolbar" role="group" aria-label="Ranking metric">
        {([["uptime", "Uptime"], ["bandwidth", "Bandwidth"], ["sessions", "Sessions"]] as const).map(([key, label]) => (
          <button key={key} className={`ui-button small ${category === key ? "" : "secondary"}`} aria-pressed={category === key} onClick={() => { setCategory(key); updateQuery({ metric: key }); }}>{label}</button>
        ))}
      </div>
      <SourceState source={source} />
      {typeof source.data?.note === "string" && <p className="ui-note explorer-source-note">{text(source.data.note)}</p>}
      {source.data && (
        <div className="ui-table-wrap" role="region" aria-label={`${valueLabel} ranking`} tabIndex={0}>
          <table className="ui-table">
            <thead><tr><th>Rank</th><th>Node</th><th>Region</th><th>{valueLabel}</th><th>Status</th></tr></thead>
            <tbody>{rows.map((row) => {
              const id = text(row.node_id, "");
              const value = category === "bandwidth" ? `${num(row.bandwidth_gb)} GB` : category === "sessions" ? num(row.active_sessions, 0) : `${num(row.uptime_percent)}%`;
              return <tr key={id}><td>#{num(row.rank, 0)}</td><td><Link className="ui-link" href={`/nodes/${encodeURIComponent(id)}`}>{text(row.name, id.slice(0, 14))}</Link></td><td>{text(row.country, text(row.region))}</td><td>{value}</td><td><Status value={row.is_validator === true ? "Validator" : "Node"} /></td></tr>;
            })}</tbody>
          </table>
          {!rows.length && <p className="ui-note">No ranking data has been reported.</p>}
        </div>
      )}
      <p className="explorer-map-disclosure">Source: {text(source.data?.data_source, "public index")}. {source.data?.period_applied === false ? "This metric uses current indexed counters; the selected window is not applied." : `Time window: ${text(source.data?.period, period)}.`}</p>
    </section>
  );
}
function Nodes() {
  const [page, setPage] = useState(1);
  const [view, setView] = useState<NodeView>("inventory");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = usePeriod();
  useEffect(() => {
    const sync = () => {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("view") as NodeView | null;
      if (next && nodeViews.some(([key]) => key === next)) setView(next);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const source = usePublic("nodes", undefined, page);
  const rows = records(source.data?.nodes);
  const total = typeof source.data?.total === "number" ? source.data.total : undefined;
  const regionOptions = [...new Set(rows.map((row) => text(row.region, text(row.country, "Unspecified region"))))].sort();
  const query = search.trim().toLowerCase();
  const visibleRows = rows.filter((row) => {
    const searchable = `${text(row.name, "")} ${text(row.node_id, "")} ${text(row.region, "")} ${text(row.country, "")}`.toLowerCase();
    const rowRegion = text(row.region, text(row.country, "Unspecified region"));
    return (!query || searchable.includes(query)) && (region === "all" || region === rowRegion);
  });
  const selectView = (next: NodeView) => {
    setView(next);
    if (next === "compare") setPage(1);
    updateQuery({ view: next === "inventory" ? null : next });
  };
  return (
    <>
      <p className="ui-note">Public regional inventory. Node health, seller presence and purchasable offers remain distinct.</p>
      <nav className="explorer-view-tabs" aria-label="Node views">
        {nodeViews.map(([key, label]) => <button key={key} type="button" className={view === key ? "active" : ""} aria-current={view === key ? "page" : undefined} onClick={() => selectView(key)}>{label}</button>)}
      </nav>
      {view !== "map" && view !== "rankings" && (
        <div className="explorer-toolbar">
          <label className="ui-control explorer-filter"><span>Search nodes</span><input className="ui-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, node ID, or region" /></label>
          <label className="ui-control"><span>Region</span><select className="ui-select" value={region} onChange={(event) => setRegion(event.target.value)}><option value="all">All regions</option>{regionOptions.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          {view === "compare" && <span className="explorer-chart-count">Select up to 3 nodes</span>}
        </div>
      )}
      {view === "map" ? (
        <RegionalMapView />
      ) : view === "rankings" ? (
        <NodeRankings period={period} onPeriodChange={setPeriod} />
      ) : (
        <>
          <SourceState source={source} />
          {source.data && (
            <div className="ui-table-wrap" role="region" aria-label={view === "compare" ? "Select nodes to compare" : "Public nodes"} tabIndex={0}>
              <table className="ui-table">
                <thead><tr>{view === "compare" && <th>Compare</th>}<th>Node</th><th>Region</th><th>Reported state</th><th>Uptime</th><th>Latency</th><th>Last heartbeat</th></tr></thead>
                <tbody>{visibleRows.map((row) => {
                  const id = text(row.node_id, "");
                  const checked = selected.includes(id);
                  return (
                    <tr key={id}>
                      {view === "compare" && <td><input type="checkbox" aria-label={`Select ${text(row.name, id)} for comparison`} checked={checked} disabled={!checked && selected.length >= 3} onChange={(event) => setSelected((items) => event.target.checked ? [...items, id] : items.filter((item) => item !== id))} /></td>}
                      <td><Link href={`/nodes/${encodeURIComponent(id)}`} className="ui-link">{text(row.name, id.slice(0, 14))}</Link><p>{id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id}</p></td>
                      <td>{text(row.country, text(row.region))}</td>
                      <td><Status value={row.is_active === true ? "Active" : row.is_active === false ? "Offline" : "Unknown"} /></td>
                      <td>{typeof row.uptime_percent === "number" ? `${num(row.uptime_percent)}%` : "Not reported"}</td>
                      <td>{typeof row.latency_ms === "number" ? `${num(row.latency_ms, 0)} ms` : "Not reported"}</td>
                      <td>{observed(row.last_heartbeat)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              {!visibleRows.length && <p className="ui-note">No nodes match these filters.</p>}
            </div>
          )}
          {view === "compare" && selected.length > 0 && (
            <section className="ui-surface explorer-compare">
              <div className="ui-section-heading"><div><h2>Node comparison</h2><p className="ui-note">Only reported values are shown.</p></div><button className="ui-button small secondary" onClick={() => setSelected([])}>Clear selection</button></div>
              <div className="ui-table-wrap" role="region" aria-label="Compared node metrics" tabIndex={0}><table className="ui-table"><thead><tr><th>Measure</th>{selected.map((id) => <th key={id}>{text(rows.find((row) => text(row.node_id) === id)?.name, id.slice(0, 12))}</th>)}</tr></thead><tbody>
                {([["Region", (row: Data) => text(row.country, text(row.region))], ["Status", (row: Data) => row.is_active === true ? "Active" : row.is_active === false ? "Offline" : "Not reported"], ["Uptime", (row: Data) => typeof row.uptime_percent === "number" ? `${num(row.uptime_percent)}%` : "Not reported"], ["Bandwidth", (row: Data) => typeof row.bandwidth_gb === "number" ? `${num(row.bandwidth_gb)} GB` : "Not reported"], ["Active sessions", (row: Data) => typeof row.active_sessions === "number" ? num(row.active_sessions, 0) : "Not reported"], ["Last heartbeat", (row: Data) => observed(row.last_heartbeat)]] as Array<[string, (row: Data) => string]>).map(([label, read]) => <tr key={label}><th>{label}</th>{selected.map((id) => <td key={id}>{read(rows.find((row) => text(row.node_id) === id) || {})}</td>)}</tr>)}
              </tbody></table></div>
            </section>
          )}
          <div className="ui-pagination">
            <button className="ui-button secondary small" disabled={page === 1 || view === "compare"} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <span>Page {page}{total != null ? ` · ${num(total, 0)} nodes` : ""}</span>
            <button className="ui-button secondary small" disabled={rows.length < 100 || (total != null && page * 100 >= total) || view === "compare"} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        </>
      )}
    </>
  );
}
function Analytics() {
  const [period, setPeriod] = usePeriod();
  const source = usePublic("analytics", undefined, 1, { period });
  return (
    <>
      <div className="explorer-toolbar explorer-period-toolbar">
        <div><h2>Network measurements</h2><p className="ui-note">Time-series values retain the source window and reported units.</p></div>
        <PeriodSelect value={period} onChange={setPeriod} />
      </div>
      <Health period={period} />
      <SourceState source={source} />
      {source.data?.metrics_available === false ? (
        <section className="ui-surface explorer-chart-empty">
          {text(source.data.message, "Measurements are not available for this time window.")}
        </section>
      ) : source.data ? (
        <div className="explorer-chart-grid">
          <TrendChart title="Bandwidth" unit="GB" points={records(source.data.bandwidth_gb)} />
          <TrendChart title="Active nodes" unit="nodes" points={records(source.data.active_nodes)} />
          <TrendChart title="Transaction volume" unit="SOL" points={records(source.data.transaction_volume)} />
          <TrendChart title="Active wallets" unit="wallets" points={records(source.data.active_wallets)} />
        </div>
      ) : !source.loading && !source.error ? (
        <div className="explorer-chart-empty">No measurement response was returned.</div>
      ) : null}
    </>
  );
}
function Governance({ treasury = false }: { treasury?: boolean }) {
  const source = usePublic(treasury ? "treasury" : "proposals");
  const stats = record(source.data?.treasury);
  const payouts = records(source.data?.recent_batch_payouts);
  return (
    <>
      <nav className="ui-tabs" aria-label="Governance views">
        <Link href="/governance" className={!treasury ? "active" : ""}>
          Proposals
        </Link>
        <Link href="/governance/treasury" className={treasury ? "active" : ""}>
          Treasury
        </Link>
      </nav>
      <SourceState source={source} />
      {source.data &&
        (treasury ? (
          <section className="ui-surface">
            <h2>Public treasury</h2>
            <div className="ui-row">
              <span>Reported combined balance</span>
              <strong>
                {stats.balance_unavailable
                  ? "Unavailable"
                  : `${num(stats.combined_balance_sol, 4)} SOL`}
              </strong>
            </div>
            <div className="ui-row">
              <span>Lifetime provider payments</span>
              <span>{typeof source.data.lifetime_provider_paid_sol === "number" ? `${num(source.data.lifetime_provider_paid_sol, 4)} SOL` : "Not reported"}</span>
            </div>
            <p className="explorer-source">
              {text(source.data.network)} · {observed(stats.last_checked_at)}
            </p>
            <p className="ui-note">
              Treasury aggregates are not your wallet balance.
            </p>
            <h3 className="explorer-subheading">Recent payout batches</h3>
            {payouts.length ? (
              <div className="explorer-execution-list">
                {payouts.map((payout, index) => {
                  const hash = text(payout.tx_hash, "");
                  return <article className="explorer-execution-item" key={text(payout.id, String(index))}>
                    <div className="ui-section-heading"><strong>{num(payout.total_amount, 6)} SOL</strong><Status value={payout.status} /></div>
                    <p>{num(payout.success_count, 0)} of {num(payout.total_count, 0)} payments · {observed(payout.created_at)}</p>
                    {hash && <Link className="ui-link" href={`/transactions/${encodeURIComponent(hash)}`}>Inspect indexed transaction ↗</Link>}
                  </article>;
                })}
              </div>
            ) : <p className="ui-note">No public payout batches were returned.</p>}
          </section>
        ) : (
          <div className="explorer-list">
            {records(source.data.proposals).map((proposal) => (
              <article key={text(proposal.id)}>
                <div className="ui-section-heading">
                  <div><h2>{text(proposal.title)}</h2><p className="explorer-proposal-type">{text(proposal.type, "General proposal").replace(/_/g, " ")}</p></div>
                  <Status value={proposal.status} />
                </div>
                <p className="ui-note">
                  {text(proposal.description, "").slice(0, 250)}
                </p>
                <div className="explorer-proposal-votes"><span>Yes <strong>{num(proposal.yes_votes, 0)}</strong></span><span>No <strong>{num(proposal.no_votes, 0)}</strong></span><span>Quorum <strong>{num(proposal.quorum, 0)}</strong></span><span>Closes <strong>{observed(proposal.end_time)}</strong></span></div>
                <div className="ui-actions">
                  <Link
                    className="ui-button secondary small"
                    href={`/governance/${encodeURIComponent(text(proposal.id, ""))}`}
                  >
                    Read proposal →
                  </Link>
                </div>
              </article>
            ))}
            {!records(source.data.proposals).length && (
              <p className="ui-note">No proposals were returned.</p>
            )}
          </div>
        ))}
      <a className="ui-link" href={appHref("/governance/create")}>
        Create a proposal in the workspace ↗
      </a>
    </>
  );
}
function ProposalExecutionPanel({ id }: { id: string }) {
  const source = usePublic("proposal-execution", id);
  const rows = records(source.data?.treasury_transactions);
  return (
    <section className="ui-surface explorer-execution" aria-labelledby="execution-title">
      <div className="ui-section-heading">
        <div>
          <div className="ui-eyebrow">Public audit records</div>
          <h2 id="execution-title">Execution evidence</h2>
        </div>
        <span className="explorer-chart-count">Proposal-linked transfers</span>
      </div>
      <SourceState source={source} />
      {rows.length ? (
        <div className="explorer-execution-list">
          {rows.map((row, index) => {
            const hash = text(row.tx_hash, "");
            const amount = row.amount == null ? "Amount not reported" : `${num(row.amount, 6)} ${text(row.currency, "")}`;
            return (
              <article key={text(row.id, `${id}-${index}`)} className="explorer-execution-item">
                <div className="ui-section-heading"><strong>{amount}</strong><Status value={row.status} /></div>
                <p>Recorded {observed(row.created_at)}</p>
                <p>Executed {row.executed_at ? observed(row.executed_at) : "Execution time not reported"}</p>
                {hash ? <Link className="ui-link" href={`/transactions/${encodeURIComponent(hash)}`}>Inspect indexed transaction ↗</Link> : <span className="ui-note">No transaction hash is attached to this record.</span>}
              </article>
            );
          })}
        </div>
      ) : source.data ? (
        <div className="explorer-chart-empty">No proposal-linked treasury transfer is available from the public source. Proposal status and executed transfers are separate records.</div>
      ) : null}
    </section>
  );
}
function ProtocolOverview() {
  return (
    <div className="explorer-protocol">
      <section className="ui-surface">
        <div className="ui-eyebrow">Protocol overview</div>
        <h2>What ProxyHubb supports</h2>
        <p className="ui-note">ProxyHubb connects buyers with provider capacity through marketplace offers, measured sessions, and public network records.</p>
        <div className="explorer-protocol-links">
          <a className="ui-button" href={appHref("/marketplace")}>Browse capacity ↗</a>
          <a className="ui-button secondary" href={appHref("/provider")}>Provider workspace ↗</a>
        </div>
      </section>
      <section className="ui-surface">
        <h2>Current verification boundary</h2>
        <p className="ui-note">A complete funded purchase → verified traffic → accepted earnings run has not yet been confirmed end-to-end. This page does not present staking, mining rewards, proof-of-bandwidth claims, or simulated on-chain receipts as active product features.</p>
        <div className="ui-row"><span>Settlement acceptance</span><Status value="Pending" /></div>
        <div className="ui-row"><span>Public source data</span><span>Shown with source and observation context</span></div>
      </section>
    </div>
  );
}
function Detail({ resource, id }: { resource: PublicResource; id: string }) {
  const source = usePublic(resource, id);
  const row = source.data;
  const fields: Record<string, string> = {
    tx_hash: "Transaction hash",
    status: "State",
    tx_type: "Transaction type",
    amount: "Amount",
    currency: "Currency",
    timestamp: "Observed",
    block_number: "Block number",
    transaction_count: "Transaction count",
    address: "Public address",
    name: "Name",
    country: "Country",
    region: "Region",
    last_heartbeat: "Last heartbeat",
    latency_ms: "Reported latency (ms)",
    uptime_percent: "Reported uptime (%)",
    balance_sol: "Public balance (SOL)",
    title: "Title",
    description: "Description",
    end_time: "Voting closes",
    yes_votes: "Yes votes",
    no_votes: "No votes",
    total_votes: "Total votes",
    quorum: "Quorum",
    type: "Proposal type",
    start_time: "Voting opened",
    onchain_pda: "On-chain proposal address",
    created_at: "Created",
    updated_at: "Last updated",
    is_active: "Reported active",
    is_verified: "Verified metadata",
  };
  return (
    <>
      <SourceState source={source} />
      {row && (
        <section className="ui-surface">
          <p className="ui-note" style={{ overflowWrap: "anywhere" }}>
            {id}
          </p>
          <dl className="explorer-detail-fields" style={{ marginTop: 24 }}>
            {Object.entries(fields)
              .filter(([key]) => Object.hasOwn(row, key))
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {typeof row[key] === "boolean"
                      ? row[key]
                        ? "Yes"
                        : "No"
                      : text(row[key])}
                  </dd>
                </div>
              ))}
          </dl>
          {resource === "proposal" && (
            <>
              <div className="ui-actions">
                <a className="ui-button" href={appHref(`/governance/${encodeURIComponent(id)}`)}>
                  Participate in workspace ↗
                </a>
              </div>
              <ProposalExecutionPanel id={id} />
            </>
          )}
          <p className="explorer-source">
            Public source record. Private order IDs, account identities and
            proxy credentials are not available through this explorer.
          </p>
        </section>
      )}
    </>
  );
}
export function Explorer({ path = [] }: { path?: string[] }) {
  const root = path[0] || "";
  const id = path[1];
  const isTreasury = root === "governance" && id === "treasury";
  const isProtocol = root === "about" && !id;
  const active = ["nodes"].includes(root)
    ? "nodes"
    : ["transactions", "blocks", "search", "wallets", "contracts"].includes(
          root,
        )
      ? "ledger"
      : ["analytics", "health"].includes(root)
        ? "analytics"
        : root === "governance"
          ? "governance"
          : "overview";
  const detailType: PublicResource | undefined =
    id && !isTreasury
      ? (
          {
            nodes: "node",
            transactions: "transaction",
            blocks: "block",
            wallets: "wallet",
            contracts: "contract",
            governance: "proposal",
          } as Record<string, PublicResource>
        )[root]
      : undefined;
  const title = detailType
    ? `${detailType[0].toUpperCase() + detailType.slice(1)} detail`
    : (
        {
          nodes: "Nodes",
          transactions: "Ledger",
          blocks: "Ledger",
          search: "Public record lookup",
          analytics: "Analytics & health",
          health: "Analytics & health",
          governance: isTreasury ? "Treasury" : "Governance",
          about: "Protocol overview",
        } as Record<string, string>
      )[root] || "A clear view of the network.";
  return (
    <>
      <header className="explorer-masthead">
      <div className="explorer-header">
        <Link className="ph-brand" href="/">
          <span className="ph-brand-mark" aria-hidden="true"><BrandSymbol /></span>
          <span className="ph-brand-name">ProxyHubb</span>{" "}<span className="ph-product-label">Explorer</span>
        </Link>
      <nav className="explorer-nav" aria-label="Explorer primary">
        {[
          ["overview", "Overview", "/"],
          ["nodes", "Nodes", "/nodes"],
          ["ledger", "Ledger", "/transactions"],
          ["analytics", "Analytics", "/analytics"],
          ["governance", "Governance", "/governance"],
        ].map(([key, label, href]) => (
          <Link
            key={key}
            className={active === key ? "active" : ""}
            aria-current={active === key ? "page" : undefined}
            href={href}
          >
            {label}
          </Link>
        ))}
      </nav>
        <div className="explorer-tools">
          <Theme />
          <a className="ph-subtle-link explorer-docs-link" href="https://docs.proxyhubb.com/docs">Docs <ArrowSymbol /></a>
          <a className="ph-primary-link" href={appHref("/app")} aria-label="Open workspace">Workspace <ArrowSymbol /></a>
        </div>
      </div>
      </header>
      <main id="main-content" tabIndex={-1} className="explorer-content">
        <div className="ui-page">
          <section className={`explorer-page-intro${!root ? " is-overview" : ""}`}>
          <Heading
            title={title}
            description={
              detailType
                ? "Inspect a public source record with its own identity."
                : isProtocol
                  ? "Product scope and evidence boundaries, stated plainly."
                : "Public network and settlement evidence, separate from private workspace operations."
            }
          />
          {!root && <><Search /><MetricSummary /></>}
          </section>
          {detailType ? (
            <Detail resource={detailType} id={id} />
          ) : isProtocol ? (
            <ProtocolOverview />
          ) : root === "nodes" ? (
            <Nodes />
          ) : root === "transactions" || root === "blocks" ? (
            <>
              <Search />
              <Ledger blocks={root === "blocks"} />
            </>
          ) : root === "search" ? (
            <Search />
          ) : root === "analytics" || root === "health" ? (
            <Analytics />
          ) : root === "governance" ? (
            <Governance treasury={isTreasury} />
          ) : (
            <>
              <Health />
              <section>
                <h2 className="explorer-subheading">
                  Recent settlement evidence
                </h2>
                <Ledger />
              </section>
            </>
          )}
        </div>
        <footer className="explorer-footer">
          <span>Public network records · refresh attempted every minute</span>
          <Link href="/about">About the network</Link>
          <a href={appHref("/help")}>Help & operating environment ↗</a>
          <span>No wallet connection required.</span>
          <Theme system />
        </footer>
      </main>
    </>
  );
}
