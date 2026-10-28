"use client";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import type { PublicResource } from "../lib/public-data";
type Data = Record<string, unknown>;
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
    : "—";
const observed = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleString()
    : "Observation time unavailable";
const subscribe = () => () => {};
function usePublic(resource: PublicResource, id?: string, page = 1) {
  const key = `${resource}:${id || ""}:${page}`;
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
  }, [key, resource, id, page, version]);
  return {
    ...(result.key === key ? result : { key, loading: true }),
    retry: () => setVersion((value) => value + 1),
  };
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
function Theme() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <label className="workspace-theme">
      <span>Theme</span>
      <select
        aria-label="Color theme"
        value={mounted ? (theme ?? "system") : "system"}
        onChange={(event) => setTheme(event.target.value)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
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
    <div>
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
  const [term, setTerm] = useState("");
  const [type, setType] = useState("transactions");
  return (
    <form
      className="explorer-search"
      onSubmit={(event) => {
        event.preventDefault();
        if (term.trim())
          window.location.assign(`/${type}/${encodeURIComponent(term.trim())}`);
      }}
    >
      <label className="sr-only" htmlFor="public-search">
        Public identifier
      </label>
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
        Search records
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
              : "—"
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
function Health() {
  const health = usePublic("health");
  const trust = usePublic("trust");
  return (
    <div className="ui-columns">
      <section className="ui-surface">
        <div className="ui-section-heading">
          <h2>Network & source health</h2>
          <Status value={health.data?.status} />
        </div>
        <SourceState source={health} />
        {health.data && (
          <>
            <div className="ui-row">
              <span>Solana source</span>
              <Status value={health.data.solana_health} />
            </div>
            <div className="ui-row">
              <span>Database source</span>
              <Status value={health.data.database_health} />
            </div>
            <p className="explorer-source">
              {observed(health.data.last_checked)}
            </p>
          </>
        )}
      </section>
      <section className="ui-surface">
        <h2>Writer evidence</h2>
        <SourceState source={trust} />
        {trust.data && (
          <>
            <div className="ui-row">
              <span>Observed / required writers</span>
              <strong>
                {num(trust.data.unique_writers, 0)} /{" "}
                {num(trust.data.min_writers_required, 0)}
              </strong>
            </div>
            <div className="ui-row">
              <span>Indexing mode</span>
              <span>{text(trust.data.explorer_mode).replace(/_/g, " ")}</span>
            </div>
            <div className="ui-row">
              <span>Full decentralization reported</span>
              <span>
                {trust.data.fully_decentralized === true
                  ? "Yes"
                  : trust.data.fully_decentralized === false
                    ? "No"
                    : "Not reported"}
              </span>
            </div>
            <p className="explorer-source">
              {observed(trust.data.last_updated)}
            </p>
          </>
        )}
      </section>
    </div>
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
          <table className="ui-table">
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
                    <td>
                      {blocks ? (
                        num(row.transaction_count, 0)
                      ) : (
                        <Status value={row.status} />
                      )}
                    </td>
                    <td>
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
function Nodes() {
  const [page, setPage] = useState(1);
  const source = usePublic("nodes", undefined, page);
  const rows = records(source.data?.nodes);
  return (
    <>
      <p className="ui-note">
        Public regional inventory. Node health, seller presence and purchasable
        offers remain distinct.
      </p>
      <SourceState source={source} />
      {source.data && (
        <div
          className="ui-table-wrap"
          role="region"
          aria-label="Public nodes"
          tabIndex={0}
        >
          <table className="ui-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Region</th>
                <th>Reported state</th>
                <th>Last heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={text(row.node_id)}>
                  <td>
                    <Link
                      href={`/nodes/${encodeURIComponent(text(row.node_id, ""))}`}
                      className="ui-link"
                    >
                      {text(row.name, text(row.node_id).slice(0, 14))}
                    </Link>
                  </td>
                  <td>{text(row.country, text(row.region))}</td>
                  <td>
                    <Status
                      value={
                        row.is_active === true
                          ? "Active"
                          : row.is_active === false
                            ? "Offline"
                            : "Unknown"
                      }
                    />
                  </td>
                  <td>{observed(row.last_heartbeat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="ui-note">No public nodes were returned.</p>
          )}
        </div>
      )}
      <div className="ui-pagination">
        <button
          className="ui-button secondary small"
          disabled={page === 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className="ui-button secondary small"
          disabled={rows.length < 20}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
function Analytics() {
  const source = usePublic("analytics");
  return (
    <>
      <Health />
      <SourceState source={source} />
      {source.data && (
        <section className="ui-surface">
          <h2>Reported daily measurements</h2>
          <p className="ui-note">
            {text(
              source.data.message,
              "Source window: " + text(source.data.period, "24h"),
            )}
          </p>
          {source.data.metrics_available === false ? (
            <p className="ui-note">
              Measurements are unavailable for this period. Try again later.
            </p>
          ) : (
            <div
              className="ui-table-wrap"
              role="region"
              aria-label="Reported bandwidth measurements"
              tabIndex={0}
            >
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Observed</th>
                    <th>Bandwidth (GB)</th>
                  </tr>
                </thead>
                <tbody>
                  {records(source.data.bandwidth_gb).map((point, index) => (
                    <tr key={index}>
                      <td>{observed(point.timestamp)}</td>
                      <td>{num(point.value, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
function Governance({ treasury = false }: { treasury?: boolean }) {
  const source = usePublic(treasury ? "treasury" : "proposals");
  const stats = record(source.data?.treasury);
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
              <span>{num(source.data.lifetime_provider_paid_sol, 4)} SOL</span>
            </div>
            <p className="explorer-source">
              {text(source.data.network)} · {observed(stats.last_checked_at)}
            </p>
            <p className="ui-note">
              Treasury aggregates are not your wallet balance.
            </p>
          </section>
        ) : (
          <div className="explorer-list">
            {records(source.data.proposals).map((proposal) => (
              <article key={text(proposal.id)}>
                <div className="ui-section-heading">
                  <h2>{text(proposal.title)}</h2>
                  <Status value={proposal.status} />
                </div>
                <p className="ui-note">
                  {text(proposal.description, "").slice(0, 250)}
                </p>
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
            <div className="ui-actions">
              <a
                className="ui-button"
                href={appHref(`/governance/${encodeURIComponent(id)}`)}
              >
                Participate in workspace ↗
              </a>
            </div>
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
        } as Record<string, string>
      )[root] || "A clear view of the network.";
  return (
    <>
      <header className="explorer-header">
        <Link className="explorer-brand" href="/">
          <span className="workspace-mark" aria-hidden="true">
            ph
          </span>
          ProxyHubb<span>Explorer</span>
        </Link>
        <div className="explorer-tools">
          <span className="explorer-environment">Public evidence</span>
          <Theme />
          <a href={appHref("/app")}>Open workspace ↗</a>
        </div>
      </header>
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
      <main id="main-content" tabIndex={-1} className="explorer-content">
        <div className="ui-page">
          <Heading
            title={title}
            description={
              detailType
                ? "Inspect a public source record with its own identity."
                : "Public network and settlement evidence, separate from private workspace operations."
            }
          />
          {detailType ? (
            <Detail resource={detailType} id={id} />
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
              <Search />
              <MetricSummary />
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
          <span>Public network records · refreshed every minute</span>
          <a href={appHref("/help")}>Help & operating environment ↗</a>
          <span>No wallet connection required.</span>
        </footer>
      </main>
    </>
  );
}
