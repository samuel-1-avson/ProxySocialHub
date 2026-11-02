"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Download, FlaskConical, Loader2, RefreshCw, RotateCcw, Square } from "lucide-react";
import { DataError, EmptyState, Loading, PageHeading, Status, countryName } from "@/components/workspace/Patterns";
import { Modal } from "@/components/patterns/Modal";
import { useAuth } from "@/lib/auth";
import {
  auditAction,
  auditKeys,
  downloadExport,
  fetchScreenshotBlob,
  getAudit,
  getFixtureScenarios,
  isActive,
  setFixtureScenario,
  type Audit,
  type Capture,
  type ComparisonItem,
  type Finding,
} from "@/lib/api/audits";
import { ASSURANCE_LABEL, JobStatusLabel, ModeBadge, OriginBanner, RegionStatusLabel, formatTime, hostOf, ms } from "./shared";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;
const CLASS_LABEL = { observed_defect: "Observed defect", regional_difference: "Regional difference (may be intentional)", hypothesis: "Hypothesis to investigate" } as const;
const STAGE_LABEL = { plan: "1. Plan the checks", capture: "2. Capture each region", analysis: "3. AI analysis" } as const;

export function AuditDetail({ auditId }: { auditId: string }) {
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: auditKeys.detail(auditId),
    queryFn: () => getAudit(auditId),
    enabled: isAuthenticated,
    refetchInterval: (q) => (q.state.data && isActive(q.state.data.status) ? 1500 : false),
  });

  if (query.isLoading) return <Loading label="Loading the audit…" />;
  if (query.isError) {
    return (
      <div className="ui-page">
        <DataError error={query.error} retry={() => void query.refetch()} title="This audit could not be loaded" />
        <Link className="ui-button secondary" href="/app/connections?tab=audits">
          <ArrowLeft size={15} aria-hidden="true" /> Back to audits
        </Link>
      </div>
    );
  }
  const audit = query.data;
  if (!audit) return <EmptyState title="Audit not found" description="It may belong to another account or no longer exist." href="/app/connections?tab=audits" action="Back to audits" />;
  return <AuditView audit={audit} />;
}

function AuditView({ audit }: { audit: Audit }) {
  const active = isActive(audit.status);
  const interpretedRegions = new Set(audit.captures.filter((c) => c.route.assurance === "verified").map((c) => c.requestedCountry));
  const severity = (f: Finding) => SEVERITY_ORDER.indexOf(f.severity);
  const findings = [...audit.analysis.findings].sort((a, b) => severity(a) - severity(b));

  return (
    <div className="ui-page">
      <PageHeading
        eyebrow="Regional audit"
        title={hostOf(audit.request.targetUrl)}
        description={`Started ${formatTime(audit.createdAt)} · regions ${audit.request.regions.join(", ")}${audit.previousAuditId ? " · rerun" : ""}${audit.replayOfAuditId ? " · replay" : ""}`}
        actions={
          <Link className="ui-button secondary" href="/app/connections?tab=audits">
            <ArrowLeft size={15} aria-hidden="true" /> All audits
          </Link>
        }
      />

      <OriginBanner origin={audit.evidenceOrigin} />

      <section aria-label="Audit status" className="ui-surface">
        <div className="audit-toolbar" style={{ justifyContent: "space-between" }}>
          <div role="status" aria-live="polite" className="audit-toolbar">
            {active && <Loader2 size={16} className="audit-spinner" aria-hidden="true" />}
            <JobStatusLabel status={audit.status} />
            <ModeBadge origin={audit.evidenceOrigin} />
            <span className="ui-muted ui-small">{audit.completedAt ? `Finished ${formatTime(audit.completedAt)}` : "In progress"}</span>
          </div>
          <Actions audit={audit} />
        </div>
        {audit.failure && (
          <p className="ui-muted" role="alert" style={{ marginTop: 12 }}>
            {audit.failure.message}
          </p>
        )}
        <ol className="audit-stepper" aria-label="Audit stages" style={{ marginTop: 16 }}>
          {audit.stages.map((s) => (
            <li key={s.name} className="audit-step" data-state={s.status}>
              <strong>{STAGE_LABEL[s.name]}</strong>
              <Status tone={s.status === "completed" ? "good" : s.status === "failed" ? "error" : s.status === "running" ? "warning" : "neutral"}>
                {{ pending: "Waiting", running: "Running", completed: "Done", failed: "Failed", skipped: "Skipped", cancelled: "Cancelled", not_run: "Not run" }[s.status]}
              </Status>
              {s.message && <p>{s.message}</p>}
            </li>
          ))}
        </ol>
      </section>

      {audit.mode === "fixture" && <FixturePanel audit={audit} />}

      <section aria-labelledby="audit-expect" className="ui-surface">
        <div className="ui-section-heading">
          <h2 id="audit-expect">What was checked</h2>
        </div>
        <p>{audit.request.expectations}</p>
        {audit.plan && (
          <details className="audit-details">
            <summary>
              Inspection plan ({audit.plan.source === "model" ? "written by the AI model, validated" : "default plan"}; {audit.plan.checks.length} read-only check
              {audit.plan.checks.length === 1 ? "" : "s"})
            </summary>
            {audit.plan.note && <p className="ui-muted ui-small">{audit.plan.note}</p>}
            <ul>
              {audit.plan.expectations.map((e) => (
                <li key={e.id}>
                  <strong>{e.id}</strong> {e.text} <span className="ui-muted">(checks {e.checkIds.join(", ") || "none"})</span>
                </li>
              ))}
            </ul>
            <ul className="ui-muted ui-small">
              {audit.plan.checks.map((c) => (
                <li key={c.id}>
                  {c.id}: {c.action}
                  {c.name ? ` “${c.name}”` : ""}
                  {c.text ? ` “${c.text}”` : ""}
                  {c.role ? ` (${c.role})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section aria-labelledby="audit-regions">
        <div className="ui-section-heading">
          <h2 id="audit-regions">Regional evidence</h2>
          <span className="ui-muted ui-small">Each exit is observed from the same browser that loaded the page.</span>
        </div>
        <div className="audit-regions">
          {audit.regions.map((region) => (
            <RegionCard key={region.country} audit={audit} country={region.country} />
          ))}
        </div>
      </section>

      <AnalysisSection audit={audit} findings={findings} interpretedRegions={interpretedRegions} />

      {audit.comparison && <ComparisonPanel audit={audit} />}

      <section aria-labelledby="audit-limits" className="ui-surface">
        <div className="ui-section-heading">
          <h2 id="audit-limits">Limitations</h2>
        </div>
        <ul>
          {[...audit.limitations, ...audit.analysis.limitations].map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <p className="ui-muted ui-small">
          Audit {audit.id} · schema {audit.schemaVersion} · evidence {audit.captures.map((c) => c.evidenceId).join(", ") || "none"}
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function Actions({ audit }: { audit: Audit }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const active = isActive(audit.status);
  const hasEvidence = audit.captures.length > 0;
  const canRetryAnalysis =
    !active && hasEvidence && (audit.analysis.status === "failed" || audit.analysis.status === "not_run") && (audit.analysis.failure?.retryable === true || audit.analysis.failure?.code === "missing_key");

  const act = useMutation({
    mutationFn: (action: "cancel" | "rerun" | "replay" | "retry-analysis") => auditAction(audit.id, action),
    onMutate: () => setError(null),
    onSuccess: async (result, action) => {
      await queryClient.invalidateQueries({ queryKey: auditKeys.all });
      if ((action === "rerun" || action === "replay") && result.id !== audit.id) router.push(`/app/audits/${result.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "The action failed."),
  });
  const download = useMutation({
    mutationFn: (format: "json" | "html") => downloadExport(audit.id, format),
    onMutate: () => setError(null),
    onError: (e) => setError(e instanceof Error ? e.message : "The export failed."),
  });

  return (
    <div className="audit-toolbar" role="group" aria-label="Audit actions">
      {active && (
        <button type="button" className="ui-button secondary small" onClick={() => act.mutate("cancel")} disabled={act.isPending}>
          <Square size={13} aria-hidden="true" /> Cancel audit
        </button>
      )}
      {!active && audit.mode !== "replay" && (
        <button type="button" className="ui-button small" onClick={() => act.mutate("rerun")} disabled={act.isPending}>
          <RotateCcw size={13} aria-hidden="true" /> Rerun and compare
        </button>
      )}
      {!active && audit.mode === "live" && audit.sessionPlan?.source === "marketplace_order" && (
        <span className="ui-muted ui-small">Rerun uses the same orders again and draws on their bandwidth.</span>
      )}
      {canRetryAnalysis && (
        <button type="button" className="ui-button small" onClick={() => act.mutate("retry-analysis")} disabled={act.isPending}>
          <RefreshCw size={13} aria-hidden="true" /> Retry AI analysis
        </button>
      )}
      {!active && hasEvidence && audit.mode !== "replay" && (
        <button type="button" className="ui-button secondary small" onClick={() => act.mutate("replay")} disabled={act.isPending}>
          Re-analyze stored evidence
        </button>
      )}
      <button type="button" className="ui-button secondary small" onClick={() => download.mutate("html")} disabled={download.isPending || !hasEvidence}>
        <Download size={13} aria-hidden="true" /> Report (HTML)
      </button>
      <button type="button" className="ui-button secondary small" onClick={() => download.mutate("json")} disabled={download.isPending || !hasEvidence}>
        <Download size={13} aria-hidden="true" /> Data (JSON)
      </button>
      <span role="alert" className="ui-small" style={{ color: "var(--error)" }}>
        {error}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixture (development) controls
// ---------------------------------------------------------------------------

function FixturePanel({ audit }: { audit: Audit }) {
  const queryClient = useQueryClient();
  const scenarios = useQuery({ queryKey: ["audits", "fixture-scenarios"], queryFn: getFixtureScenarios, staleTime: 5000 });
  const set = useMutation({
    mutationFn: (id: string) => setFixtureScenario(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audits", "fixture-scenarios"] }),
  });
  const current = scenarios.data?.current;
  return (
    <section aria-labelledby="audit-fixture" className="ui-surface">
      <div className="ui-section-heading">
        <h2 id="audit-fixture" className="ui-inline-icon">
          <FlaskConical size={17} aria-hidden="true" /> Demo site (fixture harness)
        </h2>
      </div>
      <p className="ui-muted">
        This controlled site has labelled, seeded defects. Version <code>demo-v1</code> has two: the signup button is covered by a cookie banner in Ghana, and the US sees
        the Ghana price. Switch to <code>demo-v2</code> (the fixed site), then rerun this audit to compare.
      </p>
      <div className="audit-toolbar">
        <span>
          Current version: <strong>{current ?? "unknown"}</strong> <span className="ui-muted">(this audit ran against {audit.request.targetUrl})</span>
        </span>
        <button type="button" className="ui-button small" disabled={set.isPending || current === "demo-v2"} onClick={() => set.mutate("demo-v2")}>
          Apply the fix (demo-v2)
        </button>
        <button type="button" className="ui-button secondary small" disabled={set.isPending || current === "demo-v1"} onClick={() => set.mutate("demo-v1")}>
          Reintroduce the defects (demo-v1)
        </button>
      </div>
      {set.isError && <p role="alert">{set.error instanceof Error ? set.error.message : "Could not switch the demo site."}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

function RegionCard({ audit, country }: { audit: Audit; country: string }) {
  const region = audit.regions.find((r) => r.country === country)!;
  const capture = audit.captures.find((c) => c.requestedCountry === country);
  const interpreted = capture?.route.assurance === "verified";

  return (
    <article id={`region-${country}`} className="audit-region-card" aria-labelledby={`region-${country}-title`}>
      <header>
        <h3 id={`region-${country}-title`}>
          {countryName(country)} <span className="ui-muted">({country})</span>
        </h3>
        <RegionStatusLabel status={region.status} />
      </header>

      {!capture && (
        <p className={region.status === "pending" || region.status === "running" ? "ui-muted" : "audit-not-interpreted"} role={region.failure ? "alert" : undefined}>
          {region.failure?.message ?? (region.status === "running" ? "Capturing this region…" : "Waiting to capture.")}
          {region.failure && " No evidence exists for this region, so it says nothing about your site."}
        </p>
      )}

      {capture && (
        <>
          {!interpreted && (
            <p className="audit-not-interpreted" role="alert">
              <AlertTriangle size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> <strong>Not interpreted.</strong> {capture.route.assuranceReason}{" "}
              {capture.screenshots.length > 0
                ? "The capture is kept so you can inspect it, but the AI did not use it and it does not count as this region's behaviour."
                : "The page was not loaded through this exit, so there is nothing to show."}
            </p>
          )}

          <dl className="audit-facts">
            <dt>Observed exit IP</dt>
            <dd>
              <code>{capture.route.observedEgressIp ?? "not observed"}</code>
              {capture.route.egressObservations.length > 0 && (
                <span className="ui-muted ui-small"> · measured {capture.route.egressObservations.map((o) => o.phase).join(" and ")} the page loaded, in the same browser</span>
              )}
            </dd>
            <dt>Country estimate</dt>
            <dd>
              {capture.route.geoip.country ?? "unknown"} <span className="ui-muted ui-small">· {capture.route.geoip.source}{capture.route.geoip.lookedUpAt ? ` · ${formatTime(capture.route.geoip.lookedUpAt)}` : ""}. An estimate for the IP, not proof of physical location.</span>
            </dd>
            <dt>Provider declared</dt>
            <dd>
              {capture.route.declaredCountry.value ?? "not provided"} <span className="ui-muted ui-small">· {capture.route.declaredCountry.source}</span>
            </dd>
            <dt>Assurance</dt>
            <dd>
              <span className={`audit-badge ${capture.route.assurance === "verified" ? "good" : capture.route.assurance === "unverified" ? "warn" : "bad"}`}>
                {ASSURANCE_LABEL[capture.route.assurance]}
              </span>
            </dd>
            <dt>Route</dt>
            <dd>
              {capture.route.transport === "proxyhubb_gateway" ? "ProxyHubb gateway (HTTP CONNECT)" : "Local fixture proxy (synthetic)"}
              {capture.route.sessionRef && (
                <span className="ui-muted ui-small">
                  {" "}
                  · {capture.route.sessionSource === "marketplace_order" ? "your marketplace order" : "session"} {capture.route.sessionRef}
                </span>
              )}
            </dd>
            <dt>Evidence</dt>
            <dd>
              <code>{capture.evidenceId}</code> <span className="ui-muted ui-small">· captured {formatTime(capture.capturedAt)}</span> <ModeBadge origin={capture.origin} />
            </dd>
            <dt>Page</dt>
            <dd>
              {capture.page.loadState === "not_attempted"
                ? "not loaded"
                : `${capture.page.loadState}${capture.page.mainDocumentStatus ? ` · HTTP ${capture.page.mainDocumentStatus}` : ""}`}
              {capture.page.title && <span className="ui-muted"> · “{capture.page.title}”</span>}
              {capture.page.navigationError && <div className="ui-small" style={{ color: "var(--error)" }}>{capture.page.navigationError}</div>}
            </dd>
            <dt>Browser</dt>
            <dd>
              Chromium {capture.browser.browserVersion} · {capture.browser.viewport.width}×{capture.browser.viewport.height} · {capture.browser.locale} · {capture.browser.timezoneId}
            </dd>
            <dt>Page timings</dt>
            <dd>
              DOM ready {ms(capture.timings.domContentLoadedMs)} · load {ms(capture.timings.loadEventMs)} · navigation {ms(capture.timings.navigationWallMs)}
              <div className="ui-muted ui-small">Measured in the browser through the proxy; not a pure network latency.</div>
            </dd>
          </dl>

          {capture.screenshots.map((shot) => (
            <Screenshot key={shot.artifactId} auditId={audit.id} artifactId={shot.artifactId} label={`${countryName(country)} (${country}), ${shot.label} view`} caption={`${shot.label} · ${shot.width}×${shot.height}`} />
          ))}

          {capture.checks.length > 0 && (
            <details className="audit-details">
              <summary>Checks run ({capture.checks.length})</summary>
              <ul className="ui-small">
                {capture.checks.map((c) => (
                  <li key={c.checkId}>
                    <strong>{c.checkId}</strong> {c.action}: <em>{c.status}</em>. {c.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <RequestDetails capture={capture} />
        </>
      )}
    </article>
  );
}

function RequestDetails({ capture }: { capture: Capture }) {
  const violations = capture.policyViolations ?? [];
  const total = capture.failedRequests.length + capture.blockedRequests.length + capture.consoleErrors.length + violations.length;
  if (total === 0) return <p className="ui-muted ui-small">No failed requests, policy-blocked requests or console errors were recorded. {capture.limits.requestCount} requests were made.</p>;
  return (
    <details className="audit-details">
      <summary>
        Requests and errors ({capture.failedRequests.length} failed · {capture.blockedRequests.length} blocked by audit policy · {violations.length} contacted despite policy · {capture.consoleErrors.length} console)
      </summary>
      {violations.length > 0 && (
        <>
          <p className="audit-not-interpreted" role="alert">
            <strong>Contacted despite the audit policy.</strong> A redirect led the browser to a destination this audit does not approve. The browser had already made the request
            before it could be stopped, so it was stopped immediately, nothing from it was captured, and the preventive control is the gateway&rsquo;s allowed-domains list.
          </p>
          <ul className="ui-small">
            {violations.map((v, i) => (
              <li key={i}>
                {v.url} <span className="ui-muted">({v.reason})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {capture.failedRequests.length > 0 && (
        <ul className="ui-small">
          {capture.failedRequests.map((r, i) => (
            <li key={i}>
              {r.method} {r.url} → {r.status ?? r.failure}
            </li>
          ))}
        </ul>
      )}
      {capture.blockedRequests.length > 0 && (
        <>
          <p className="ui-muted ui-small">Blocked by the auditor&rsquo;s safety policy (not by your site):</p>
          <ul className="ui-small">
            {capture.blockedRequests.map((r, i) => (
              <li key={i}>
                {r.url} <span className="ui-muted">({r.reason})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {capture.consoleErrors.length > 0 && (
        <ul className="ui-small">
          {capture.consoleErrors.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function Screenshot({ auditId, artifactId, label, caption }: { auditId: string; artifactId: string; label: string; caption: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    fetchScreenshotBlob(auditId, artifactId)
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [auditId, artifactId]);

  return (
    <figure className="audit-shot">
      {url ? (
        <button type="button" onClick={() => setOpen(true)} aria-label={`Enlarge screenshot: ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL, not optimizable */}
          <img src={url} alt={`Screenshot: ${label}`} />
        </button>
      ) : (
        <div className="audit-shot-placeholder" role={failed ? "alert" : "status"}>
          {failed ? "This screenshot could not be loaded." : "Loading screenshot…"}
        </div>
      )}
      <figcaption>{caption}</figcaption>
      {url && (
        <Modal open={open} onOpenChange={setOpen} title={label} description="Full-size screenshot" size="xl" contentClassName="audit-lightbox">
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL, not optimizable */}
          <img src={url} alt={`Screenshot: ${label}`} />
        </Modal>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Analysis, findings, comparison
// ---------------------------------------------------------------------------

function AnalysisSection({ audit, findings, interpretedRegions }: { audit: Audit; findings: Finding[]; interpretedRegions: Set<string> }) {
  const a = audit.analysis;
  return (
    <section aria-labelledby="audit-analysis" className="ui-surface">
      <div className="ui-section-heading">
        <h2 id="audit-analysis">AI analysis</h2>
        {a.model && (
          <span className="ui-muted ui-small">
            Meta {a.model.id} · {a.model.dataMode === "standard" ? "standard mode (not used for training)" : "contributor mode (content may be used for training)"}
          </span>
        )}
      </div>

      {a.status === "running" && (
        <p role="status" className="ui-inline-icon">
          <Loader2 size={15} className="audit-spinner" aria-hidden="true" /> The model is comparing the evidence against your expectations…
        </p>
      )}
      {a.status === "not_run" && (
        <div className="audit-not-interpreted" role="status">
          <strong>AI analysis not run.</strong> {a.failure?.message ?? "No analysis was performed."} The captured evidence above is complete and unaffected; no findings are implied.
        </div>
      )}
      {a.status === "skipped" && (
        <div className="audit-not-interpreted" role="status">
          <strong>AI analysis skipped.</strong> {a.failure?.message}
        </div>
      )}
      {a.status === "failed" && (
        <div className="ui-error" role="alert">
          <strong>The AI analysis failed</strong>
          <p>
            {a.failure?.message ?? "Unknown error."} {a.failure?.retryable ? "Your evidence was kept. Use “Retry AI analysis” above; capture is not repeated." : "This failure is not retryable."} (attempt{" "}
            {a.attempts})
          </p>
        </div>
      )}

      {a.status === "completed" && (
        <>
          <p className="ui-muted ui-small">
            Findings are written by an AI model from the captured evidence and then checked against it: references to evidence that does not exist are removed. They are not
            ground truth, and confidence is stated in words, not numbers. Analyzed regions: {[...interpretedRegions].join(", ") || "none"}. Evidence origin: {a.evidenceOrigins.join(", ")}.
          </p>
          {findings.length === 0 ? (
            <p role="status">
              <strong>No findings were reported for the verified regions.</strong> That is the model&rsquo;s reading of the captured evidence for the checks that ran. It is not a guarantee the site
              is defect-free.
            </p>
          ) : (
            <ul className="audit-findings" aria-label="Findings">
              {findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </ul>
          )}

          {a.expectationResults.length > 0 && (
            <div className="ui-table-wrap ui-section-space" tabIndex={0} role="region" aria-label="Expectation results (scrollable)">
              <table className="ui-table">
                <caption className="sr-only">Expectation results</caption>
                <thead>
                  <tr>
                    <th scope="col">Expectation</th>
                    <th scope="col">Result</th>
                    <th scope="col">Regions</th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {a.expectationResults.map((r) => (
                    <tr key={r.expectationId}>
                      <td>
                        {r.expectationId}: {audit.plan?.expectations.find((e) => e.id === r.expectationId)?.text}
                      </td>
                      <td>
                        <Status tone={r.status === "met" ? "good" : r.status === "not_met" ? "error" : "warning"}>{r.status.replace("_", " ")}</Status>
                      </td>
                      <td>{r.regions.join(", ") || "n/a"}</td>
                      <td>{r.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(a.validation.droppedFindings.length > 0 || a.validation.adjustedFindings.length > 0) && (
            <details className="audit-details">
              <summary>
                Validation: {a.validation.droppedFindings.length} model claim(s) removed, {a.validation.adjustedFindings.length} adjusted
              </summary>
              <ul className="ui-small">
                {a.validation.droppedFindings.map((d, i) => (
                  <li key={`d${i}`}>
                    Removed “{d.summary}”: {d.reason}
                  </li>
                ))}
                {a.validation.adjustedFindings.map((d, i) => (
                  <li key={`a${i}`}>
                    {d.findingId}: {d.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {a.usage.calls.length > 0 && (
        <p className="ui-muted ui-small">
          Provider-reported usage: {a.usage.totalInputTokens.toLocaleString()} input and {a.usage.totalOutputTokens.toLocaleString()} output tokens across {a.usage.calls.length} call
          {a.usage.calls.length === 1 ? "" : "s"}
          {a.usage.costEstimate ? ` · estimated cost $${a.usage.costEstimate.usd.toFixed(4)} (estimate from ${a.usage.costEstimate.priceSource})` : " · no price configured, so no cost is shown"}.
        </p>
      )}
    </section>
  );
}

function FindingCard({ finding: f }: { finding: Finding }) {
  return (
    <li className="audit-finding" data-severity={f.severity} data-class={f.classification} id={`finding-${f.id}`}>
      <div className="audit-finding-meta">
        <span className="audit-badge">{f.severity}</span>
        <span className="audit-badge">{CLASS_LABEL[f.classification]}</span>
        <span className="ui-muted ui-small">{f.kind.replace(/_/g, " ")}</span>
        {f.regions.map((r) => (
          <span key={r} className="audit-chip">
            {r}
          </span>
        ))}
      </div>
      <h3>{f.summary}</h3>
      <div className="audit-compare-grid">
        <div>
          <b>Observed</b>
          {f.observed}
        </div>
        <div>
          <b>Expected</b>
          {f.expected}
        </div>
      </div>
      <p>
        <strong>Evidence:</strong>{" "}
        {f.evidenceIds.length === 0 ? (
          <span className="ui-muted">none cited (a hypothesis)</span>
        ) : (
          f.evidenceIds.map((id) => (
            <a key={id} className="audit-chip" href={`#region-${id.split("-").pop()}`}>
              <code>{id}</code>
            </a>
          ))
        )}
      </p>
      {f.location && (
        <p>
          <strong>Where to look:</strong> {f.location.description} <span className="ui-muted">({f.location.evidenceId}
          {f.location.screenshot ? `, ${f.location.screenshot} screenshot` : ""}
          {f.location.checkId ? `, check ${f.location.checkId}` : ""})</span>
        </p>
      )}
      {f.reproduction.length > 0 && (
        <>
          <p>
            <strong>Reproduce:</strong>
          </p>
          <ol>
            {f.reproduction.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
      <p>
        <strong>Next step:</strong> {f.nextAction}
      </p>
      <p className="ui-muted">
        <strong>Uncertainty:</strong> {f.uncertainty}
      </p>
    </li>
  );
}

function ComparisonPanel({ audit }: { audit: Audit }) {
  const c = audit.comparison!;
  const groups: Array<{ status: ComparisonItem["status"]; title: string; hint: string }> = [
    { status: "resolved", title: "Resolved", hint: "Reported before, absent now, and the region was verified and analyzed both times." },
    { status: "persisting", title: "Still present", hint: "Reported in both runs." },
    { status: "new", title: "New", hint: "Not reported before." },
    { status: "incomparable", title: "Cannot be compared", hint: "A region was not verified or analyzed in one of the runs, so it is never counted as fixed." },
  ];
  return (
    <section aria-labelledby="audit-compare" className="ui-surface">
      <div className="ui-section-heading">
        <h2 id="audit-compare">Compared with the previous run</h2>
        <Link className="ui-link" href={`/app/audits/${c.previousAuditId}`}>
          Open the previous audit
        </Link>
      </div>
      {c.items.length === 0 && <p>No findings in either run, and both runs analyzed the same verified regions.</p>}
      {groups.map((g) => {
        const items = c.items.filter((i) => i.status === g.status);
        if (items.length === 0) return null;
        return (
          <div className="audit-compare-group" key={g.status}>
            <h3>
              {g.title} ({items.length}) <span className="ui-muted" style={{ fontWeight: 400 }}>· {g.hint}</span>
            </h3>
            <ul>
              {items.map((i) => (
                <li key={`${i.status}-${i.key}`}>
                  <span className="audit-chip">{i.regions.join(", ")}</span> {i.summary}
                  {i.note && <span className="ui-muted ui-small"> ({i.note})</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <ul className="ui-muted ui-small">
        {c.caveats.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </section>
  );
}
