"use client";
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2, ShieldCheck } from "lucide-react";
import { DataError, EmptyState, Loading, Status, countryName } from "@/components/workspace/Patterns";
import { useAuth } from "@/lib/auth";
import { orderStatusLabel } from "@/lib/order-status";
import { auditKeys, createAudit, isActive, listAudits, listAuditOrders, type AuditCapabilities, type AuditOrderOption } from "@/lib/api/audits";
import { JobStatusLabel, ModeBadge, formatTime, hostOf } from "./shared";
import { useAuditCapabilities } from "./useAuditCapabilities";

const DEFAULT_EXPECTATIONS =
  "Check that signup is usable and that the expected currency is displayed for customers in Ghana and the US.";
const ORDER_EXPECTATIONS = "Check that the page loads, signup is usable and prices are shown in the expected currency.";

/**
 * The audits area inside Connections: start an audit over any of your orders and see your past reports.
 * (Starting one for a single order is also offered on that order's own page; see AuditLauncher.)
 */
export function AuditsPanel() {
  const { isAuthenticated } = useAuth();
  const caps = useAuditCapabilities();
  const list = useQuery({
    queryKey: auditKeys.list(),
    queryFn: listAudits,
    enabled: isAuthenticated,
    refetchInterval: (q) => (q.state.data?.some((a) => isActive(a.status)) ? 3000 : 20_000),
  });

  return (
    <div className="audits-panel">
      <div className="workflow-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          Each region&rsquo;s exit is checked from the same browser that loads your site, and nothing is interpreted for a region whose exit
          cannot be verified. Findings are written by an AI model from the captured evidence and are checked against it; they are not ground
          truth. Audits are read-only: nothing is submitted, purchased or changed on your site.
        </p>
      </div>

      {caps.isLoading && <Loading label="Checking what this server can audit…" />}
      {caps.isError && <DataError error={caps.error} retry={() => void caps.refetch()} title="Audit capabilities are unavailable" />}
      {caps.data && <AuditForm caps={caps.data} />}

      <section aria-labelledby="audit-history" className="ui-surface">
        <div className="ui-section-heading">
          <h2 id="audit-history">Your audits</h2>
        </div>
        {list.isLoading && <Loading label="Loading your audits…" />}
        {list.isError && <DataError error={list.error} retry={() => void list.refetch()} title="Your audits could not be loaded" />}
        {list.data && list.data.length === 0 && (
          <EmptyState
            title="No audits yet"
            description="Start your first audit above. Results stay available here after you leave this page."
            icon={<Globe2 size={24} />}
          />
        )}
        {list.data && list.data.length > 0 && (
          <div className="ui-table-wrap" tabIndex={0} role="region" aria-label="Your regional audits (scrollable)">
            <table className="ui-table">
              <caption className="sr-only">Your regional audits, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Regions</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Status</th>
                  <th scope="col">Findings</th>
                  <th scope="col">Started</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((audit) => (
                  <tr key={audit.id}>
                    <td>
                      <Link className="ui-link" href={`/app/audits/${audit.id}`}>
                        {hostOf(audit.targetUrl)}
                        <span className="sr-only"> audit {audit.id}</span>
                      </Link>
                      {audit.previousAuditId && <div className="ui-small ui-muted">Rerun</div>}
                    </td>
                    <td>{audit.regions.join(", ")}</td>
                    <td>
                      <ModeBadge origin={audit.evidenceOrigin} />
                    </td>
                    <td>
                      <JobStatusLabel status={audit.status} />
                    </td>
                    <td>
                      {audit.analysisStatus === "completed"
                        ? audit.findingCount
                        : audit.analysisStatus === "not_run"
                          ? "AI analysis not run"
                          : audit.analysisStatus === "failed"
                            ? "Analysis failed"
                            : "n/a"}
                    </td>
                    <td>{formatTime(audit.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * With a `preset` the form is a one-order audit: live, over that order, in that order's region, so only the
 * address and the expectations are asked. `embedded` drops the card chrome for use inside a dialog.
 */
export function AuditForm({ caps, preset, embedded = false }: { caps: AuditCapabilities; preset?: { orderId: string }; embedded?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auditor = caps.auditor;
  const live = auditor?.modes.live;
  const fixture = auditor?.modes.fixture;
  const maxRegions = auditor?.limits.maxRegions ?? 2;

  const [mode, setMode] = useState<"live" | "fixture">(live?.available || !fixture?.available ? "live" : "fixture");
  const [liveUrl, setLiveUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [expectations, setExpectations] = useState(preset ? ORDER_EXPECTATIONS : DEFAULT_EXPECTATIONS);
  const [touched, setTouched] = useState(false);
  // Funded orders are the default: deployments that require escrow (the testnet does) refuse traffic on a newly
  // opened session until a wallet funds it, which the audit never does, so "new sessions" would fail there.
  const [sessionSource, setSessionSource] = useState<"intent" | "order">("order");
  const [orderPick, setOrderPick] = useState<Record<string, string>>({});

  const effectiveMode = preset ? "live" : mode === "fixture" && fixture?.available ? "fixture" : "live";
  const useOrders = effectiveMode === "live" && (!!preset || sessionSource === "order");
  const targetUrl = effectiveMode === "fixture" ? (fixture?.targetUrl ?? "") : liveUrl.trim();

  // The user's own active orders, grouped by the country the listing declares. Only read in "orders" mode.
  const orders = useQuery({ queryKey: auditKeys.orders(), queryFn: listAuditOrders, enabled: useOrders, staleTime: 15_000 });
  const ordersByCountry = useMemo(() => {
    const groups: Record<string, AuditOrderOption[]> = {};
    for (const o of orders.data?.orders ?? []) if (o.country) (groups[o.country] ??= []).push(o);
    return groups;
  }, [orders.data]);
  const unlabelledOrders = (orders.data?.orders ?? []).filter((o) => !o.country).length;
  const presetOrder = preset ? orders.data?.orders.find((o) => o.id === preset.orderId) : undefined;
  const orderFor = (code: string): string | undefined => {
    if (preset) return preset.orderId;
    const list = ordersByCountry[code] ?? [];
    return list.find((o) => o.id === orderPick[code])?.id ?? list[0]?.id;
  };

  const regionOptions = useMemo(
    () =>
      effectiveMode === "fixture"
        ? (fixture?.regions ?? []).map((code) => ({ code, note: "synthetic route" }))
        : useOrders
          ? Object.entries(ordersByCountry)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([code, list]) => ({ code, note: `${list.length} active order${list.length === 1 ? "" : "s"}` }))
          : caps.listingRegions.regions.map((r) => ({ code: r.code, note: `${r.listings} active listing${r.listings === 1 ? "" : "s"}` })),
    [effectiveMode, fixture, useOrders, ordersByCountry, caps.listingRegions.regions],
  );
  const chosen = preset ? (presetOrder?.country ? [presetOrder.country] : []) : picked.filter((code) => regionOptions.some((r) => r.code === code));

  const create = useMutation({
    mutationFn: () =>
      createAudit({
        targetUrl,
        regions: chosen,
        expectations: expectations.trim(),
        mode: effectiveMode,
        ...(useOrders ? { sessionSource: "order" as const, orders: Object.fromEntries(chosen.map((code) => [code, orderFor(code) ?? ""])) } : {}),
      }),
    onSuccess: async (audit) => {
      await queryClient.invalidateQueries({ queryKey: auditKeys.list() });
      router.push(`/app/audits/${audit.id}`);
    },
  });

  const problems: string[] = [];
  if (!targetUrl) problems.push("Enter the HTTPS address of a site you are authorized to test.");
  if (preset) {
    if (orders.isPending) problems.push("Your order is still loading.");
    else if (orders.isError) problems.push("Your orders could not be loaded, so this audit cannot use this one.");
    else if (!presetOrder) problems.push("This order is not active, so it cannot carry an audit.");
    else if (!presetOrder.country) problems.push("This order's listing does not declare a country, so there is no region to audit from.");
  } else {
    if (useOrders && orders.isPending) problems.push("Your orders are still loading.");
    if (useOrders && orders.isError) problems.push("Your orders could not be loaded, so this audit cannot use them.");
    if (chosen.length === 0) problems.push(useOrders && orders.isSuccess && regionOptions.length === 0 ? "You have no active marketplace order with a declared country to audit through." : "Choose at least one region.");
  }
  if (expectations.trim().length < 10) problems.push("Describe what should be true in at least 10 characters.");
  const modeReady = effectiveMode === "fixture" ? !!fixture?.available : !!live?.available;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problems.length === 0 && modeReady) create.mutate();
  };

  const toggle = (code: string) =>
    setPicked((current) => {
      if (current.includes(code)) return current.filter((c) => c !== code);
      return current.length >= maxRegions ? current : [...current, code];
    });

  if (!auditor) {
    return (
      <div className="ui-error" role="alert">
        <strong className="ui-inline-icon">The Regional Auditor service is unavailable</strong>
        <p>{caps.auditorProblem?.message ?? "It could not be reached."} Audits cannot be started until it is running; nothing has been simulated in its place.</p>
      </div>
    );
  }

  return (
    <form className={embedded ? "audit-form-embedded" : "ui-surface"} onSubmit={submit} noValidate aria-labelledby={embedded ? undefined : "audit-new"} aria-label={embedded ? "New audit" : undefined}>
      {!embedded && (
        <div className="ui-section-heading">
          <h2 id="audit-new">New audit</h2>
        </div>
      )}

      {!preset && (
      <fieldset className="ui-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ui-muted" style={{ marginBottom: 8 }}>
          Evidence mode
        </legend>
        <div className="audit-mode-options">
          <label className="audit-mode-option" aria-disabled={!live?.available}>
            <input type="radio" name="mode" value="live" checked={effectiveMode === "live"} disabled={!live?.available} onChange={() => setMode("live")} />
            <span>
              <strong>Live</strong>
              <small>
                {live?.available
                  ? "New capture through ProxyHubb regional sessions opened with your account. Uses your plan's bandwidth."
                  : `Not available on this server. Missing configuration: ${live?.missing.join(", ") || "unknown"}.`}
              </small>
            </span>
          </label>
          <label className="audit-mode-option" aria-disabled={!fixture?.available}>
            <input type="radio" name="mode" value="fixture" checked={effectiveMode === "fixture"} disabled={!fixture?.available} onChange={() => setMode("fixture")} />
            <span>
              <strong>Synthetic fixture (development demo)</strong>
              <small>
                {fixture?.available
                  ? "A controlled demo site with seeded defects, visited through a local fixture proxy. Not a real regional capture."
                  : "Not enabled: the development fixture harness is off on this server."}
              </small>
            </span>
          </label>
        </div>
      </fieldset>
      )}

      {!preset && effectiveMode === "live" && (
        <fieldset className="ui-field ui-section-space" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ui-muted" style={{ marginBottom: 8 }}>
            Where the traffic comes from
          </legend>
          <div className="audit-mode-options">
            <label className="audit-mode-option">
              <input
                type="radio"
                name="session-source"
                value="intent"
                checked={sessionSource === "intent"}
                onChange={() => {
                  setSessionSource("intent");
                  setPicked([]);
                }}
              />
              <span>
                <strong>Open new sessions</strong>
                <small>
                  One session per region, requested with your account. If this deployment requires an escrow-funded session, the request cannot carry traffic until it is funded, and the audit will not fund it.
                </small>
              </span>
            </label>
            <label className="audit-mode-option">
              <input
                type="radio"
                name="session-source"
                value="order"
                checked={sessionSource === "order"}
                onChange={() => {
                  setSessionSource("order");
                  setPicked([]);
                }}
              />
              <span>
                <strong>Use my funded orders</strong>
                <small>
                  Run over active marketplace orders you already paid for. Nothing is bought or funded here; the audit reads each order&apos;s session with your account and uses some of that order&apos;s bandwidth.
                </small>
              </span>
            </label>
          </div>
        </fieldset>
      )}

      <div className={embedded ? "ui-form-grid" : "ui-section-space ui-form-grid"} style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        {preset && (
          <dl className="audit-preset-summary" aria-label="Where this audit runs">
            <div>
              <dt>Region</dt>
              <dd>{presetOrder?.country ? `${countryName(presetOrder.country)} (${presetOrder.country})` : orders.isPending ? "Loading…" : "Unavailable"}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>{presetOrder ? orderLabel(presetOrder) : orders.isPending ? "Loading…" : "Not an active order"}</dd>
            </div>
          </dl>
        )}
        <label className="ui-field">
          <span>Website address</span>
          <input
            className="ui-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            value={targetUrl}
            readOnly={effectiveMode === "fixture"}
            onChange={(e) => setLiveUrl(e.target.value)}
            placeholder="https://your-site.example/"
            aria-describedby="audit-url-help"
          />
          <small id="audit-url-help">
            {effectiveMode === "fixture"
              ? "Fixed to the local demo site in fixture mode."
              : live?.allowedTargetOrigins.length
                ? `Only origins an operator has authorized can be audited: ${live.allowedTargetOrigins.join(", ")}.`
                : "Only HTTPS sites that an operator has authorized can be audited."}
          </small>
        </label>

        {!preset && (
        <fieldset className="ui-field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>
            Regions <span className="ui-muted">(choose up to {maxRegions})</span>
          </legend>
          {effectiveMode === "live" && !useOrders && !caps.listingRegions.available && (
            <p className="ui-muted" role="status">
              {caps.listingRegions.message ?? "The region list is unavailable."}
            </p>
          )}
          {useOrders && orders.isPending && (
            <p className="ui-muted" role="status">
              Loading your active orders…
            </p>
          )}
          {useOrders && orders.isError && <DataError error={orders.error} title="Your orders could not be loaded" />}
          {useOrders && orders.isSuccess && regionOptions.length === 0 && (
            <p className="ui-muted" role="status">
              You have no active marketplace order with a declared country.{" "}
              {otherOrdersNote(orders.data.otherStatuses, unlabelledOrders)}
              <Link href="/marketplace">Buy bandwidth in the marketplace</Link>, wait for the order to become active, then come back.
            </p>
          )}
          {!useOrders && regionOptions.length === 0 && (effectiveMode === "fixture" || caps.listingRegions.available) && (
            <p className="ui-muted">No regions are currently offered. Nothing is shown here that cannot be requested.</p>
          )}
          <div className="audit-region-grid" role="group" aria-label="Regions">
            {regionOptions.map((r) => {
              const checked = chosen.includes(r.code);
              return (
                <label className="audit-region-option" key={r.code}>
                  <input type="checkbox" checked={checked} disabled={!checked && chosen.length >= maxRegions} onChange={() => toggle(r.code)} />
                  <span>
                    {countryName(r.code)} <small>({r.code}) · {r.note}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {useOrders && chosen.length > 0 && (
            <div className="ui-form-grid" style={{ gridTemplateColumns: "minmax(0,1fr)", marginTop: 12 }}>
              {chosen.map((code) => {
                const list = ordersByCountry[code] ?? [];
                return (
                  <label className="ui-field" key={code}>
                    <span>
                      Order for {countryName(code)} ({code})
                    </span>
                    <select className="ui-select" value={orderFor(code) ?? ""} onChange={(e) => setOrderPick((current) => ({ ...current, [code]: e.target.value }))}>
                      {list.map((o) => (
                        <option key={o.id} value={o.id}>
                          {orderLabel(o)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
          {effectiveMode === "live" && (
            <small>
              {useOrders
                ? `Your active ProxyHubb marketplace orders${unlabelledOrders > 0 ? ` (${unlabelledOrders} without a declared country ${unlabelledOrders === 1 ? "is" : "are"} not offered)` : ""}. The country is the seller's claim about the listing`
                : `${caps.listingRegions.source}. These are provider claims about where supply exists`}
              ; the audit verifies each exit and will refuse to interpret a region whose exit does not match.
            </small>
          )}
        </fieldset>
        )}
        {preset && (
          <small>
            The country is the seller&apos;s claim about this listing. The audit verifies the real exit and will not interpret the site if it does not match. To compare several regions, start an audit from the Audits tab in Connections.
          </small>
        )}

        <label className="ui-field">
          <span>What should be true?</span>
          <textarea className="audit-textarea" value={expectations} onChange={(e) => setExpectations(e.target.value)} maxLength={2000} aria-describedby="audit-exp-help" />
          <small id="audit-exp-help">Plain language. Each expectation is turned into a few bounded, read-only checks.</small>
        </label>

        <p className="ui-muted ui-small">
          Browser profile: desktop Chromium 1280×800, locale en-US, timezone UTC, identical in every region so that differences come from the network, not
          the device. Assistant: {auditor.ai.configured ? `Meta ${auditor.ai.model} (${auditor.ai.dataMode === "standard" ? "standard mode, your content is not used for training" : "contributor mode, content may be used for training"})` : "not configured: captures will be taken but “AI analysis not run”"}.
        </p>
      </div>

      {touched && problems.length > 0 && (
        <div className="ui-error" role="alert">
          <strong>Check the form</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {create.isError && <DataError error={create.error} title="The audit could not be started" />}

      <div className="audit-form-actions ui-section-space">
        <button type="submit" className="ui-button" disabled={create.isPending || !modeReady}>
          {create.isPending ? <Loader2 size={16} className="audit-spinner" aria-hidden="true" /> : null}
          {create.isPending ? "Starting…" : "Run audit"}
        </button>
        {!modeReady && <Status tone="warning">{effectiveMode === "live" ? "Live mode is not configured" : "Fixture mode is not enabled"}</Status>}
      </div>
    </form>
  );
}

function orderLabel(o: AuditOrderOption): string {
  const place = [o.city, o.isp].filter(Boolean).join(" · ");
  const bandwidth = o.bandwidthGb !== null ? `${o.bandwidthGb} GB bought` : "";
  return [o.title, place, bandwidth, `order ${o.id.slice(0, 8)}`].filter(Boolean).join(" · ");
}

/** "This account has 3 other orders that are not active: Pending payment 2, Completed 1. " or "" when there are none. */
function otherOrdersNote(otherStatuses: Record<string, number>, activeWithoutCountry: number): string {
  const entries = Object.entries(otherStatuses).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return activeWithoutCountry ? "" : "This account has no marketplace orders at all. ";
  const parts = entries.map(([status, n]) => `${orderStatusLabel(status)} ${n}`).join(", ");
  return `This account has ${total} other order${total === 1 ? "" : "s"} that ${total === 1 ? "is" : "are"} not active: ${parts}. `;
}
