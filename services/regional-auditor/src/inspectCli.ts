// node src/inspectCli.ts [auditId | latest]
//
// Prints a plain summary of a stored audit: per-region route evidence, why a region was or was not
// interpreted, findings, model usage. Reads the local job store only (stored jobs never contain proxy
// credentials or API keys). Useful right after the first live run.

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.ts";
import type { AuditJob } from "./contracts.ts";
import { FileJobStore } from "./store/fileStore.ts";
import { PgJobStore } from "./store/pgStore.ts";
import type { JobStore } from "./store/types.ts";
import { AUDIT_ID_RE } from "./util.ts";

const config = loadConfig();
let wanted = process.argv[2] ?? "latest";
const store: JobStore = config.databaseUrl ? new PgJobStore(config.databaseUrl) : new FileJobStore(config.dataDir);

if (wanted === "latest") {
  if (config.databaseUrl) {
    console.error("With PostgreSQL, pass an audit id (aud_...).");
    process.exit(2);
  }
  const dir = path.join(config.dataDir, "jobs");
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /^aud_[0-9a-f]{12}\.json$/.test(n));
  const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(path.join(dir, n))).mtimeMs })));
  const newest = stats.sort((a, b) => b.t - a.t)[0];
  if (!newest) {
    console.error(`No audits found in ${dir}`);
    process.exit(1);
  }
  wanted = newest.n.replace(/\.json$/, "");
}
if (!AUDIT_ID_RE.test(wanted)) {
  console.error("Expected an audit id like aud_0123456789ab, or 'latest'.");
  process.exit(2);
}

const job: AuditJob | null = await store.get(wanted);
await store.close?.();
if (!job) {
  console.error(`Audit ${wanted} was not found.`);
  process.exit(1);
}

const line = (label: string, value: string) => console.log(`  ${label.padEnd(22)} ${value}`);
console.log(`\nAudit ${job.id}  [${job.mode} / ${job.evidenceOrigin}]  status: ${job.status}`);
line("target", job.request.targetUrl);
line("created / finished", `${job.createdAt} / ${job.completedAt ?? "not finished"}`);
if (job.failure) line("failure", `${job.failure.code}: ${job.failure.message}`);
console.log("\nStages");
for (const s of job.stages) line(s.name, `${s.status}${s.message ? ` - ${s.message}` : ""}`);

console.log("\nRegions");
for (const r of job.regions) {
  console.log(`  ${r.country}  ${r.status}${r.failure ? `  (${r.failure.code}: ${r.failure.message})` : ""}`);
  const c = job.captures.find((x) => x.requestedCountry === r.country);
  if (!c) continue;
  line("exit IP observed", `${c.route.observedEgressIp ?? "none"}   (${c.route.egressObservations.map((o) => `${o.phase}:${o.ip ?? "fail"}`).join(", ")})`);
  line("GeoIP estimate", `${c.route.geoip.country ?? "unknown"}  via ${c.route.geoip.source}`);
  line("provider declared", `${c.route.declaredCountry.value ?? "not provided"}  (${c.route.declaredCountry.source})`);
  line("assurance", `${c.route.assurance}: ${c.route.assuranceReason}`);
  line("page", `${c.page.loadState}  HTTP ${c.page.mainDocumentStatus ?? "n/a"}  ${c.page.navigationError ?? ""}`.trim());
  if (c.policyViolations.length > 0) line("policy violations", c.policyViolations.map((v) => v.url).join(", "));
  if (c.blockedRequests.length > 0) line("blocked by policy", String(c.blockedRequests.length));
  if (c.failedRequests.length > 0) line("failed requests", String(c.failedRequests.length));
  line("screenshots", c.screenshots.map((s) => s.artifactId).join(", ") || "none");
}

const a = job.analysis;
console.log(`\nAI analysis: ${a.status}${a.model ? `  (${a.model.id}, ${a.model.dataMode})` : ""}`);
if (a.failure) line("reason", `${a.failure.code}: ${a.failure.message}`);
for (const f of a.findings) console.log(`  [${f.id}] ${f.classification}/${f.kind}/${f.severity} [${f.regions.join(",")}] ${f.summary}`);
if (a.status === "completed" && a.findings.length === 0) console.log("  no findings reported for the verified regions");
if (a.validation.droppedFindings.length + a.validation.adjustedFindings.length > 0) {
  line("validation", `${a.validation.droppedFindings.length} removed, ${a.validation.adjustedFindings.length} adjusted`);
}
if (a.usage.calls.length > 0) {
  line("usage", `${a.usage.totalInputTokens} in / ${a.usage.totalOutputTokens} out tokens, ${a.usage.calls.length} call(s)${a.usage.costEstimate ? `, estimated $${a.usage.costEstimate.usd.toFixed(4)}` : ""}`);
}
if (job.limitations.length > 0) {
  console.log("\nLimitations");
  for (const l of job.limitations) console.log(`  - ${l}`);
}
console.log();
