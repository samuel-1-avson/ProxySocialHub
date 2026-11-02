// Sanitized exports. Both formats keep provenance (evidence origin, capture and
// analysis timestamps, route assurance and its source) and limitations, and
// neither contains credentials, the owner id, or full session references.

import type { AuditJob, RegionCapture } from "./contracts.ts";
import { redactSecrets, sanitizeUrl } from "./redact.ts";
import { truncate } from "./util.ts";

const maskRef = (ref: string | null) => (ref ? `${ref.slice(0, 8)}…` : null);

function sanitizedCapture(c: RegionCapture) {
  return {
    evidenceId: c.evidenceId,
    requestedCountry: c.requestedCountry,
    evidenceOrigin: c.origin,
    capturedAt: c.capturedAt,
    route: {
      transport: c.route.transport,
      sessionRef: maskRef(c.route.sessionRef),
      sessionSource: c.route.sessionSource,
      declaredCountry: c.route.declaredCountry,
      observedEgressIp: c.route.observedEgressIp,
      egressObservations: c.route.egressObservations,
      geoip: c.route.geoip,
      assurance: c.route.assurance,
      assuranceReason: c.route.assuranceReason,
    },
    browser: c.browser,
    page: { ...c.page, requestedUrl: sanitizeUrl(c.page.requestedUrl, 2048), finalUrl: c.page.finalUrl ? sanitizeUrl(c.page.finalUrl, 2048) : null },
    screenshots: c.screenshots.map((s) => ({ label: s.label, width: s.width, height: s.height, bytes: s.bytes, sha256: s.sha256 })),
    checks: c.checks,
    failedRequests: c.failedRequests,
    blockedRequests: c.blockedRequests,
    policyViolations: c.policyViolations,
    consoleErrors: c.consoleErrors,
    timings: c.timings,
    timingNotes: c.timingNotes,
    limits: c.limits,
  };
}

export function exportJson(job: AuditJob) {
  return {
    format: "proxyhubb-regional-audit/1",
    exportedAt: new Date().toISOString(),
    audit: {
      id: job.id,
      status: job.status,
      mode: job.mode,
      evidenceOrigin: job.evidenceOrigin,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      previousAuditId: job.previousAuditId,
      replayOfAuditId: job.replayOfAuditId,
      target: sanitizeUrl(job.request.targetUrl, 2048),
      requestedRegions: job.request.regions,
      expectations: redactSecrets(job.request.expectations),
      browserProfile: job.request.browserProfile,
    },
    plan: job.plan,
    regions: job.regions,
    captures: job.captures.map(sanitizedCapture),
    analysis: {
      status: job.analysis.status,
      failure: job.analysis.failure,
      model: job.analysis.model,
      startedAt: job.analysis.startedAt,
      completedAt: job.analysis.completedAt,
      evidenceOrigins: job.analysis.evidenceOrigins,
      expectationResults: job.analysis.expectationResults,
      findings: job.analysis.findings,
      limitations: job.analysis.limitations,
      validation: job.analysis.validation,
      usage: job.analysis.usage,
      note: "Findings are model-generated and validated against the captured evidence; they are not ground truth.",
    },
    comparison: job.comparison,
    limitations: job.limitations,
  };
}

const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const ORIGIN_LABEL: Record<AuditJob["evidenceOrigin"], string> = {
  live_capture: "Live capture",
  recorded_replay: "Recorded replay (earlier live capture, new analysis)",
  synthetic_fixture: "SYNTHETIC FIXTURE - not a real regional capture",
};

/** Self-contained HTML (no scripts) with embedded screenshots. */
export function exportHtml(job: AuditJob, screenshots: Map<string, Buffer>): string {
  const data = exportJson(job);
  const synthetic = job.evidenceOrigin === "synthetic_fixture";
  const shots = (c: RegionCapture) =>
    c.screenshots
      .map((s) => {
        const bytes = screenshots.get(s.artifactId);
        return bytes
          ? `<figure><img alt="${esc(`${c.requestedCountry} ${s.label} screenshot`)}" src="data:image/png;base64,${bytes.toString("base64")}"><figcaption>${esc(s.label)} · ${s.width}×${s.height} · sha256 ${esc(s.sha256.slice(0, 12))}…</figcaption></figure>`
          : `<p class="muted">Screenshot ${esc(s.label)} not available in this export.</p>`;
      })
      .join("");

  const captureHtml = job.captures
    .map(
      (c) => `<section class="card"><h3>${esc(c.requestedCountry)} <span class="pill ${esc(c.route.assurance)}">${esc(c.route.assurance)}</span></h3>
<p class="muted">${esc(ORIGIN_LABEL[c.origin])} · captured ${esc(c.capturedAt)} · evidence <code>${esc(c.evidenceId)}</code></p>
<dl>
<dt>Observed egress IP</dt><dd>${esc(c.route.observedEgressIp ?? "not observed")}</dd>
<dt>GeoIP estimate</dt><dd>${esc(c.route.geoip.country ?? "unknown")} — ${esc(c.route.geoip.source)}${c.route.geoip.lookedUpAt ? ` (${esc(c.route.geoip.lookedUpAt)})` : ""}</dd>
<dt>Provider-declared</dt><dd>${esc(c.route.declaredCountry.value ?? "not available")} — ${esc(c.route.declaredCountry.source)}</dd>
<dt>Assurance</dt><dd>${esc(c.route.assuranceReason)}</dd>
<dt>Page</dt><dd>${esc(c.page.loadState)} · HTTP ${esc(c.page.mainDocumentStatus ?? "n/a")} · ${esc(c.page.title ?? "no title")}</dd>
<dt>Browser</dt><dd>${esc(c.browser.browserVersion)} · ${c.browser.viewport.width}×${c.browser.viewport.height} · ${esc(c.browser.locale)} · ${esc(c.browser.timezoneId)}</dd>
</dl>${shots(c)}</section>`,
    )
    .join("");

  const findings = job.analysis.findings
    .map(
      (f) => `<li class="finding"><strong>${esc(f.summary)}</strong>
<p><span class="pill ${esc(f.severity)}">${esc(f.severity)}</span> <span class="pill">${esc(f.classification.replace("_", " "))}</span> ${esc(f.kind)} · regions ${esc(f.regions.join(", "))}</p>
<p><b>Observed:</b> ${esc(f.observed)}<br><b>Expected:</b> ${esc(f.expected)}</p>
<p><b>Evidence:</b> ${f.evidenceIds.map((id) => `<code>${esc(id)}</code>`).join(" ")}</p>
${f.reproduction.length ? `<ol>${f.reproduction.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
<p><b>Next action:</b> ${esc(f.nextAction)}</p><p class="muted"><b>Uncertainty:</b> ${esc(f.uncertainty)}</p></li>`,
    )
    .join("");

  const comparison = job.comparison
    ? `<h2>Comparison with ${esc(job.comparison.previousAuditId)}</h2><ul>${job.comparison.items
        .map((i) => `<li><span class="pill">${esc(i.status)}</span> ${esc(i.regions.join(", "))} — ${esc(i.summary)}${i.note ? ` <span class="muted">(${esc(i.note)})</span>` : ""}</li>`)
        .join("")}</ul><p class="muted">${esc(job.comparison.caveats.join(" "))}</p>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Regional audit ${esc(job.id)}</title>
<style>body{font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif;margin:0 auto;max-width:980px;padding:24px;color:#14202b}
h1{margin:0 0 4px}.muted{color:#5b6b7b}.banner{padding:10px 14px;border-radius:8px;margin:12px 0;background:#eef3fb}.banner.synthetic{background:#fff4d6;border:1px solid #e3c35c}
.card{border:1px solid #d6dde5;border-radius:10px;padding:14px 18px;margin:14px 0}.pill{display:inline-block;padding:1px 8px;border-radius:999px;background:#e8edf3;font-size:12px}
.pill.verified{background:#d8f1df}.pill.mismatch,.pill.direct_egress,.pill.critical,.pill.high{background:#f8d7d5}.pill.unverified,.pill.unavailable,.pill.medium{background:#fbe9bf}
dl{display:grid;grid-template-columns:170px 1fr;gap:4px 12px}dt{color:#5b6b7b}dd{margin:0}img{max-width:100%;border:1px solid #d6dde5;border-radius:6px}code{background:#f0f3f6;padding:0 4px;border-radius:4px}
.finding{margin:12px 0;padding:10px 14px;border-left:4px solid #2b5fd9;background:#f6f8fb;list-style:none}ul{padding-left:0}</style></head><body>
<h1>Regional audit report</h1>
<p class="muted">Audit <code>${esc(job.id)}</code> · ${esc(job.status)} · target ${esc(sanitizeUrl(job.request.targetUrl, 300))} · regions ${esc(job.request.regions.join(", "))}</p>
<div class="banner ${synthetic ? "synthetic" : ""}"><b>${esc(ORIGIN_LABEL[job.evidenceOrigin])}.</b> Exported ${esc(data.exportedAt)}.</div>
<h2>Expectations</h2><p>${esc(job.request.expectations)}</p>
<h2>AI analysis</h2>
<p>${
    job.analysis.status === "completed"
      ? `Completed ${esc(job.analysis.completedAt)} with ${esc(job.analysis.model?.id)} (${esc(job.analysis.model?.dataMode)} data mode). Findings are model-generated, validated against the captured evidence, and are not ground truth.`
      : job.analysis.status === "not_run"
        ? "AI analysis not run."
        : esc(`${job.analysis.status}: ${job.analysis.failure?.message ?? ""}`)
  }</p>
${findings ? `<ul>${findings}</ul>` : job.analysis.status === "completed" ? "<p>No findings were reported for the verified regions.</p>" : ""}
${comparison}
<h2>Regional evidence</h2>${captureHtml || "<p>No captures.</p>"}
<h2>Limitations</h2><ul>${[...job.limitations, ...job.analysis.limitations].map((l) => `<li>${esc(truncate(l, 400))}</li>`).join("")}</ul>
</body></html>`;
}
