// The audit pipeline: plan -> capture (per region) -> analysis -> finalize.
//
// Capture state and AI state are tracked separately: a model failure never
// discards evidence, and a failed or unverified region never turns into a
// clean bill of health. The job document is persisted after every step so a
// page refresh (or a worker restart) never loses a report.

import { captureRegion, type RegionRoute } from "./browser/capture.ts";
import { MetaClient, summarizeUsage } from "./ai/meta.ts";
import { analyzeEvidence, planInspection } from "./ai/stages.ts";
import { buildDefaultPlan } from "./ai/validate.ts";
import { compareAudits } from "./compare.ts";
import type { AuditorConfig } from "./config.ts";
import type { AuditJob, Comparison, JobStatus, RegionCredential, RegionState, RegionUnavailable, StageName, StageStatus } from "./contracts.ts";
import type { FixtureHarness } from "./fixtures/harness.ts";
import { isInterpretable, type GeoIpProvider } from "./geo.ts";
import type { ArtifactStore } from "./store/types.ts";
import { assertHostResolvesPublic, validateTargetUrl } from "./targetPolicy.ts";
import { Semaphore, errorMessage, nowIso } from "./util.ts";

export class JobAborted extends Error {
  readonly kind: "cancelled" | "timeout";
  constructor(kind: "cancelled" | "timeout") {
    super(kind === "cancelled" ? "The audit was cancelled." : "The audit exceeded its time limit.");
    this.name = "JobAborted";
    this.kind = kind;
  }
}

export interface PipelineContext {
  config: AuditorConfig;
  meta: MetaClient;
  artifacts: ArtifactStore;
  fixture: FixtureHarness | null;
  liveGeoip: GeoIpProvider;
  directIp: () => Promise<string | null>;
  credentials: Record<string, RegionCredential> | undefined;
  unavailable: Record<string, RegionUnavailable> | undefined;
  slots: Semaphore;
  persist: (job: AuditJob) => Promise<void>;
  signal: AbortSignal;
  previous: AuditJob | null;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

function stage(job: AuditJob, name: StageName, status: StageStatus, message: string | null = null): void {
  const s = job.stages.find((x) => x.name === name);
  if (!s) return;
  if (status === "running") s.startedAt ??= nowIso();
  if (status !== "running" && status !== "pending") s.completedAt = nowIso();
  s.status = status;
  s.message = message;
}

function abortKind(signal: AbortSignal): "cancelled" | "timeout" | null {
  if (!signal.aborted) return null;
  return signal.reason instanceof JobAborted ? signal.reason.kind : "cancelled";
}

export async function executePipeline(job: AuditJob, ctx: PipelineContext): Promise<void> {
  const { persist } = ctx;
  try {
    job.status = "running";
    job.startedAt ??= nowIso();
    await persist(job);

    // ---- plan ----------------------------------------------------------
    if (job.plan) {
      stage(job, "plan", "skipped", ctx.previous ? `Reused the plan from audit ${ctx.previous.id} so the same checks run.` : "Plan reused.");
    } else if (job.mode === "live" && !job.request.regions.some((country) => ctx.credentials?.[country])) {
      // Nothing can be captured, so spending a model call on a plan would only buy a report with no evidence.
      job.plan = buildDefaultPlan(job.request.expectations, "No plan was drawn up: no region had a usable session, so nothing was captured.");
      stage(job, "plan", "skipped", "Skipped: no region had a usable session, so no model call was made.");
    } else {
      stage(job, "plan", "running");
      await persist(job);
      const planned = await planInspection(ctx.meta, ctx.config, { targetUrl: job.request.targetUrl, regions: job.request.regions, expectations: job.request.expectations }, ctx.signal, ctx.config.model.maxCallsPerJob);
      job.plan = planned.plan;
      job.planUsage = planned.calls;
      stage(job, "plan", "completed", planned.plan.source === "default" ? planned.plan.note : null);
    }
    await persist(job);
    throwIfAborted(ctx.signal);

    // ---- capture -------------------------------------------------------
    if (job.mode === "replay") {
      stage(job, "capture", "skipped", `Replay of recorded evidence from audit ${job.replayOfAuditId}; no new browser capture was made.`);
    } else {
      stage(job, "capture", "running");
      await persist(job);
      await Promise.all(job.request.regions.map((country) => runRegion(job, country, ctx)));
      const kind = abortKind(ctx.signal);
      stage(job, "capture", kind ? "cancelled" : "completed", kind === "timeout" ? "Stopped at the audit time limit." : null);
    }
    await persist(job);
    throwIfAborted(ctx.signal);

    // ---- analysis ------------------------------------------------------
    await runAnalysis(job, ctx);
  } catch (error) {
    const kind = abortKind(ctx.signal);
    if (!kind) {
      job.failure = { code: "pipeline_error", message: errorMessage(error).slice(0, 300) };
      ctx.log("pipeline_error", { auditId: job.id, message: job.failure.message });
    }
  }
  await finalize(job, ctx);
}

export async function runAnalysis(job: AuditJob, ctx: PipelineContext): Promise<void> {
  if (!job.plan) throw new Error("cannot analyze without a plan");
  stage(job, "analysis", "running");
  job.analysis.status = "running";
  await ctx.persist(job);

  // Earlier analysis attempts (a retry) keep their usage on record and count against the call budget.
  const priorAnalysisCalls = job.analysis.usage.calls.filter((c) => c.stage === "analyze");

  const analysis = await analyzeEvidence(
    ctx.meta,
    ctx.config,
    {
      plan: job.plan,
      userExpectations: job.request.expectations,
      captures: job.captures,
      loadScreenshot: (artifactId) => ctx.artifacts.get(job.id, artifactId),
    },
    job.analysis.attempts,
    ctx.signal,
    ctx.config.model.maxCallsPerJob - job.planUsage.length - priorAnalysisCalls.length,
  );
  const calls = [...job.planUsage, ...priorAnalysisCalls, ...analysis.usage.calls];
  const usage = summarizeUsage(calls, ctx.config.model.pricing);
  job.analysis = { ...analysis, usage: { calls, ...usage } };

  const status: StageStatus =
    analysis.status === "completed" ? "completed" : analysis.status === "failed" ? "failed" : analysis.status === "skipped" ? "skipped" : "not_run";
  stage(job, "analysis", status, analysis.failure?.message ?? null);
  await ctx.persist(job);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new JobAborted("cancelled");
}

// ---------------------------------------------------------------------------
// One region
// ---------------------------------------------------------------------------

async function runRegion(job: AuditJob, country: string, ctx: PipelineContext): Promise<void> {
  const region = job.regions.find((r) => r.country === country);
  if (!region || !job.plan) return;
  const { config } = ctx;

  const finish = async (status: RegionState["status"], failure: RegionState["failure"] = null) => {
    region.status = status;
    region.failure = failure;
    region.completedAt = nowIso();
    await ctx.persist(job);
  };

  region.status = "running";
  region.startedAt = nowIso();
  await ctx.persist(job);

  // Resolve the route for this region. There is no fallback to a direct or
  // different-region connection: a missing route means "unavailable".
  let route: RegionRoute | null = null;
  let unavailable: RegionUnavailable | null = null;
  if (job.mode === "fixture") {
    const cred = ctx.fixture?.credentialFor(country) ?? null;
    if (!ctx.fixture || !cred) {
      unavailable = { code: "region_not_in_fixture", message: `The fixture harness has no synthetic route for ${country}.` };
    } else {
      route = {
        transport: "fixture_proxy",
        proxy: { server: ctx.fixture.proxyServer, username: cred.username, password: cred.password },
        sessionRef: `fixture-route-${country}`,
        declaredCountry: { value: country, source: "fixture harness (synthetic declaration)", observedAt: nowIso() },
        geoip: ctx.fixture.geoip,
        workerDirectIp: null,
        origin: "synthetic_fixture",
        egressEchoUrl: `${ctx.fixture.targetOrigin}/__egress`,
        fixtureOrigins: [ctx.fixture.targetOrigin],
        approvedOrigins: [],
      };
    }
  } else {
    const cred = ctx.credentials?.[country];
    if (!config.proxyEndpoint) {
      unavailable = { code: "proxy_not_configured", message: "AUDITOR_PROXY_ENDPOINT is not configured on the auditor service." };
    } else if (!cred) {
      unavailable = ctx.unavailable?.[country] ?? { code: "no_session", message: `No ProxyHubb session could be obtained for ${country}.` };
    } else {
      route = {
        transport: "proxyhubb_gateway",
        proxy: { server: `http://${config.proxyEndpoint.replace(/^https?:\/\//, "")}`, username: cred.username, password: cred.password },
        sessionRef: cred.sessionRef,
        sessionSource: cred.source,
        declaredCountry: {
          value: cred.declaredCountry ?? null,
          source: cred.declaredCountry ? (cred.declaredCountrySource ?? "ProxyHubb control API") : "not provided by the control API",
          observedAt: cred.declaredCountry ? nowIso() : null,
        },
        geoip: ctx.liveGeoip,
        workerDirectIp: await ctx.directIp().catch(() => null),
        origin: "live_capture",
        egressEchoUrl: config.egressEchoUrl,
        fixtureOrigins: [],
        approvedOrigins: [...new Set([...config.allowedTargetOrigins, ...config.allowedSubresourceOrigins])],
      };
    }
    if (route) {
      // Re-validate at run time (the allow-list or DNS may have changed since the job was queued).
      const decision = validateTargetUrl(job.request.targetUrl, { allowedOrigins: config.allowedTargetOrigins });
      const dns = decision.ok ? await assertHostResolvesPublic(decision.url.hostname) : null;
      if (!decision.ok) unavailable = { code: decision.code, message: decision.message };
      else if (dns && !dns.ok) unavailable = { code: dns.code, message: dns.message };
      if (unavailable) route = null;
    }
  }

  if (!route) {
    await finish("unavailable", unavailable ?? { code: "no_route", message: "No route is available for this region." });
    return;
  }

  let release: (() => void) | null = null;
  try {
    release = await ctx.slots.acquire(ctx.signal);
    const capture = await captureRegion({
      auditId: job.id,
      country,
      targetUrl: job.request.targetUrl,
      plan: job.plan,
      profile: job.request.browserProfile,
      route,
      config,
      signal: ctx.signal,
      saveScreenshot: (artifactId, bytes) => ctx.artifacts.put(job.id, artifactId, bytes),
    });
    job.captures = [...job.captures.filter((c) => c.requestedCountry !== country), capture];
    region.evidenceId = capture.evidenceId;
    region.assurance = capture.route.assurance;

    if (abortKind(ctx.signal)) {
      await finish("cancelled", { code: abortKind(ctx.signal) === "timeout" ? "job_timeout" : "cancelled", message: "Stopped before the capture finished." });
    } else if (capture.route.assurance === "verified") {
      await finish("captured");
    } else if (capture.route.assurance === "unverified") {
      await finish("unverified", { code: "route_unverified", message: capture.route.assuranceReason });
    } else if (capture.route.assurance === "mismatch") {
      await finish("mismatch", { code: "region_mismatch", message: capture.route.assuranceReason });
    } else if (capture.route.assurance === "direct_egress") {
      await finish("failed", { code: "direct_egress", message: capture.route.assuranceReason });
    } else {
      await finish("failed", { code: "egress_probe_failed", message: capture.page.navigationError ?? capture.route.assuranceReason });
    }
  } catch (error) {
    const kind = abortKind(ctx.signal);
    if (kind) await finish("cancelled", { code: kind === "timeout" ? "job_timeout" : "cancelled", message: "Stopped before the capture finished." });
    else {
      ctx.log("region_error", { auditId: job.id, country, message: errorMessage(error).slice(0, 200) });
      await finish("failed", { code: "capture_error", message: "The browser capture failed unexpectedly. Retry the audit." });
    }
  } finally {
    release?.();
  }
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

export function deriveJobStatus(job: AuditJob, kind: "cancelled" | "timeout" | null): JobStatus {
  if (kind === "cancelled") return "cancelled";
  // Only a verified, captured region is usable evidence; anything else is never counted as a result.
  const hasInterpretable = job.regions.some((r) => r.status === "captured") || (job.mode === "replay" && job.captures.some((c) => isInterpretable(c.route.assurance)));
  const allCaptured = job.regions.length > 0 && job.regions.every((r) => r.status === "captured");
  const analysisOk = job.analysis.status === "completed" || job.analysis.status === "not_run";
  if (!hasInterpretable) return "failed";
  if (allCaptured && analysisOk && kind !== "timeout") return "completed";
  return "partial";
}

export function buildLimitations(job: AuditJob): string[] {
  const out: string[] = [];
  if (job.evidenceOrigin === "synthetic_fixture") {
    out.push("Synthetic fixture: evidence comes from a local demo site reached through a local fixture proxy, not through a ProxyHubb regional exit.");
  }
  if (job.evidenceOrigin === "recorded_replay") {
    out.push(`Recorded replay: evidence was captured earlier (see each capture's timestamp); only the analysis is new.`);
  }
  out.push("The country shown for an exit is a GeoIP estimate for the observed IP, not proof of physical location.");
  out.push("Browser timings include proxy hops and page rendering; they are not pure network latency.");
  if (job.mode === "live") {
    out.push("Traffic is forced through the proxy at browser level; the gateway and provider destination controls remain the authoritative network boundary, and local DNS checks cannot rule out DNS rebinding.");
  }
  for (const r of job.regions) {
    if (r.status === "unverified" || r.status === "mismatch" || r.status === "unavailable" || r.status === "failed") {
      out.push(`${r.country}: not interpreted (${r.status}). ${r.failure?.message ?? ""}`.trim().slice(0, 300));
    }
  }
  if (job.plan?.source === "default") out.push(`Inspection plan: default (${job.plan.note ?? "no model plan"}).`);
  if (job.analysis.status === "not_run") out.push("AI analysis not run.");
  return out.slice(0, 20);
}

async function finalize(job: AuditJob, ctx: PipelineContext): Promise<void> {
  const kind = abortKind(ctx.signal);
  if (kind === "cancelled") job.cancelRequestedAt ??= nowIso();
  if (kind) {
    for (const r of job.regions) {
      if (r.status === "pending" || r.status === "running") {
        r.status = "cancelled";
        r.completedAt = nowIso();
        r.failure = { code: kind === "timeout" ? "job_timeout" : "cancelled", message: "Stopped before the capture finished." };
      }
    }
    for (const s of job.stages) if (s.status === "pending" || s.status === "running") stage(job, s.name, "cancelled", kind === "timeout" ? "Time limit reached." : "Cancelled.");
    if (kind === "timeout") job.failure = { code: "job_timeout", message: `The audit exceeded ${Math.round(ctx.config.limits.jobTimeoutMs / 1000)}s and was stopped.` };
  }
  if (job.analysis.status === "running") job.analysis.status = "failed";
  job.status = deriveJobStatus(job, kind);
  job.completedAt = nowIso();
  job.limitations = buildLimitations(job);

  if (ctx.previous && job.status !== "cancelled") {
    try {
      job.comparison = compareAudits(job, ctx.previous) satisfies Comparison;
    } catch (error) {
      ctx.log("compare_error", { auditId: job.id, message: errorMessage(error).slice(0, 200) });
    }
  }
  await ctx.persist(job);
}
