// Job lifecycle: validation, queueing with bounded concurrency, cancellation,
// per-job time limits, recovery of abandoned jobs, rerun and replay. Browser
// work never runs inside a web request handler: callers get a queued job id
// back immediately and poll the persisted document.

import { MetaClient } from "./ai/meta.ts";
import type { AuditorConfig } from "./config.ts";
import {
  AuditJob,
  CreateAuditBody,
  RerunBody,
  SCHEMA_VERSION,
  TERMINAL_JOB_STATUSES,
  type AuditRequest,
  type EvidenceOrigin,
  type RegionCredential,
  type RegionUnavailable,
  type SessionPlan,
} from "./contracts.ts";
import type { FixtureHarness } from "./fixtures/harness.ts";
import { IpWhoIsProvider, NoGeoIpProvider, parseEchoIp, type GeoIpProvider } from "./geo.ts";
import { JobAborted, deriveJobStatus, buildLimitations, executePipeline, runAnalysis, type PipelineContext } from "./pipeline.ts";
import type { ArtifactStore, JobStore } from "./store/types.ts";
import { assertHostResolvesPublic, validateTargetUrl } from "./targetPolicy.ts";
import { HttpError, Semaphore, errorMessage, newAuditId, nowIso } from "./util.ts";

const MAX_ANALYSIS_ATTEMPTS = 3;

interface QueueEntry {
  jobId: string;
  kind: "full" | "analysis";
  credentials?: Record<string, RegionCredential>;
  unavailable?: Record<string, RegionUnavailable>;
}

export interface RunnerDeps {
  config: AuditorConfig;
  store: JobStore;
  artifacts: ArtifactStore;
  meta: MetaClient;
  fixture: FixtureHarness | null;
  liveGeoip?: GeoIpProvider;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

function newJob(ownerId: string, request: AuditRequest, mode: AuditJob["mode"], origin: EvidenceOrigin): AuditJob {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newAuditId(),
    ownerId,
    request,
    mode,
    evidenceOrigin: origin,
    previousAuditId: null,
    replayOfAuditId: null,
    status: "queued",
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    stages: [
      { name: "plan", status: "pending", startedAt: null, completedAt: null, message: null },
      { name: "capture", status: "pending", startedAt: null, completedAt: null, message: null },
      { name: "analysis", status: "pending", startedAt: null, completedAt: null, message: null },
    ],
    plan: null,
    regions: request.regions.map((country) => ({ country, status: "pending", startedAt: null, completedAt: null, evidenceId: null, assurance: null, failure: null })),
    captures: [],
    analysis: {
      status: "not_run",
      failure: null,
      model: null,
      startedAt: null,
      completedAt: null,
      evidenceOrigins: [],
      expectationResults: [],
      findings: [],
      limitations: [],
      validation: { droppedFindings: [], adjustedFindings: [] },
      usage: { calls: [], totalInputTokens: 0, totalOutputTokens: 0, costEstimate: null },
      attempts: 0,
    },
    comparison: null,
    planUsage: [],
    sessionPlan: null,
    failure: null,
    limitations: [],
    revision: 0,
  };
}

/** A session plan only makes sense for a live audit and only for regions the audit actually covers. */
function checkedSessionPlan(plan: SessionPlan | undefined, request: AuditRequest): SessionPlan | null {
  if (!plan) return null;
  if (request.mode !== "live") throw new HttpError(400, "invalid_session_plan", "Marketplace orders can only be used for live audits.");
  const stray = Object.keys(plan.orders).filter((country) => !request.regions.includes(country));
  if (stray.length > 0) throw new HttpError(400, "invalid_session_plan", `Orders were given for regions this audit does not cover: ${stray.join(", ")}.`);
  return plan;
}

export class AuditRunner {
  private readonly deps: RunnerDeps;
  private readonly config: AuditorConfig;
  private readonly queue: QueueEntry[] = [];
  private readonly running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly memory = new Map<string, QueueEntry>();
  private readonly persistChains = new Map<string, Promise<void>>();
  private readonly creates = new Map<string, number[]>();
  private readonly slots: Semaphore;
  private readonly liveGeoip: GeoIpProvider;
  private directIpCache: { at: number; ip: string | null } | null = null;
  private stopping = false;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.config = deps.config;
    this.slots = new Semaphore(deps.config.limits.maxConcurrentBrowsers);
    this.liveGeoip = deps.liveGeoip ?? (deps.config.geoipProvider === "none" ? new NoGeoIpProvider() : new IpWhoIsProvider());
  }

  private log(event: string, fields?: Record<string, unknown>) {
    this.deps.log?.(event, fields);
  }

  // -- capabilities ---------------------------------------------------------

  capabilities() {
    const c = this.config;
    const liveMissing: string[] = [];
    if (!c.proxyEndpoint) liveMissing.push("AUDITOR_PROXY_ENDPOINT");
    if (c.allowedTargetOrigins.length === 0) liveMissing.push("AUDITOR_ALLOWED_TARGET_ORIGINS");
    return {
      modes: {
        live: {
          available: liveMissing.length === 0,
          missing: liveMissing,
          /** host:port of the buyer gateway live routes go through (public; lets the web server check an order targets the same gateway). */
          proxyEndpoint: c.proxyEndpoint,
          allowedTargetOrigins: c.allowedTargetOrigins,
          /** Every host an audit may legitimately contact; used as the gateway-side allow-list when enabled. */
          allowedHosts: [...new Set([...c.allowedTargetOrigins, ...c.allowedSubresourceOrigins, new URL(c.egressEchoUrl).origin].map((o) => new URL(o).hostname))],
        },
        fixture: {
          available: !!this.deps.fixture,
          missing: this.deps.fixture ? [] : ["AUDITOR_FIXTURE_ENABLED"],
          targetUrl: this.deps.fixture ? `${this.deps.fixture.targetOrigin}/` : null,
          regions: this.deps.fixture?.regions ?? [],
          scenario: this.deps.fixture?.scenarioId() ?? null,
        },
        replay: { available: true },
      },
      ai: { provider: "meta", configured: this.deps.meta.configured, model: c.model.id, dataMode: c.model.dataMode },
      limits: { maxRegions: c.limits.maxRegions, maxChecks: c.limits.maxChecks, jobTimeoutSeconds: Math.round(c.limits.jobTimeoutMs / 1000) },
      geoip: c.geoipProvider,
    };
  }

  // -- creation -------------------------------------------------------------

  private async validateRequest(request: AuditRequest): Promise<AuditRequest> {
    const c = this.config;
    const regions = [...new Set(request.regions)];
    if (regions.length > c.limits.maxRegions) {
      throw new HttpError(400, "too_many_regions", `At most ${c.limits.maxRegions} regions are allowed per audit.`);
    }
    if (request.mode === "fixture") {
      const fixture = this.deps.fixture;
      if (!fixture) throw new HttpError(409, "fixture_unavailable", "The development fixture harness is not enabled (AUDITOR_FIXTURE_ENABLED).");
      const url = new URL(request.targetUrl);
      if (url.origin !== fixture.targetOrigin) {
        throw new HttpError(400, "target_not_fixture", "Fixture audits can only target the fixture demo site.");
      }
      const unknown = regions.filter((r) => !fixture.regions.includes(r));
      if (unknown.length > 0) throw new HttpError(400, "region_not_in_fixture", `The fixture harness has no synthetic route for ${unknown.join(", ")}.`);
      return { ...request, regions, targetUrl: url.toString() };
    }
    const missing = this.capabilities().modes.live.missing;
    if (missing.length > 0) {
      throw new HttpError(409, "live_unavailable", `Live audits are not configured on the auditor service. Missing: ${missing.join(", ")}.`);
    }
    const decision = validateTargetUrl(request.targetUrl, { allowedOrigins: c.allowedTargetOrigins });
    if (!decision.ok) throw new HttpError(400, decision.code, decision.message);
    const dns = await assertHostResolvesPublic(decision.url.hostname);
    if (!dns.ok) throw new HttpError(400, dns.code, dns.message);
    decision.url.hash = "";
    return { ...request, regions, targetUrl: decision.url.toString() };
  }

  private async admit(ownerId: string): Promise<void> {
    const c = this.config.limits;
    if (this.stopping) throw new HttpError(503, "shutting_down", "The auditor service is shutting down.");
    if (this.queue.length >= c.maxQueue) throw new HttpError(429, "queue_full", "The audit queue is full; try again shortly.");
    if ((await this.deps.store.countActive(ownerId)) >= c.maxActiveJobsPerOwner) {
      throw new HttpError(429, "too_many_active_audits", `You already have ${c.maxActiveJobsPerOwner} audits in progress.`);
    }
    const now = Date.now();
    const recent = (this.creates.get(ownerId) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= c.createsPerOwnerPerHour) {
      throw new HttpError(429, "rate_limited", "Too many audits were started in the last hour.");
    }
    recent.push(now);
    this.creates.set(ownerId, recent);
  }

  async create(ownerId: string, raw: unknown): Promise<AuditJob> {
    const body = CreateAuditBody.parse(raw);
    const request = await this.validateRequest(body.request);
    const sessionPlan = checkedSessionPlan(body.sessionPlan, request);
    await this.admit(ownerId);
    const origin: EvidenceOrigin = request.mode === "fixture" ? "synthetic_fixture" : "live_capture";
    const job = newJob(ownerId, request, request.mode, origin);
    job.sessionPlan = sessionPlan;
    await this.deps.store.create(job);
    this.enqueue({ jobId: job.id, kind: "full", credentials: body.credentials, unavailable: body.unavailable });
    return job;
  }

  async rerun(ownerId: string, id: string, raw: unknown): Promise<AuditJob> {
    const body = RerunBody.parse(raw ?? {});
    const previous = await this.deps.store.getOwned(id, ownerId);
    if (!previous) throw new HttpError(404, "not_found", "Audit not found.");
    if (!TERMINAL_JOB_STATUSES.includes(previous.status)) throw new HttpError(409, "audit_in_progress", "Wait for the audit to finish before rerunning it.");
    if (previous.mode === "replay") throw new HttpError(409, "rerun_not_supported", "A replay has no live capture to rerun; rerun the original audit instead.");

    const request = await this.validateRequest(previous.request);
    // Describes THIS run's credentials; the web server reads previous.sessionPlan to decide what to send.
    const sessionPlan = checkedSessionPlan(body.sessionPlan, request);
    await this.admit(ownerId);
    const job = newJob(ownerId, request, previous.mode, previous.evidenceOrigin);
    job.sessionPlan = sessionPlan;
    job.previousAuditId = previous.id;
    job.plan = previous.plan; // same checks, so the results are comparable
    job.planUsage = [];
    await this.deps.store.create(job);
    this.enqueue({ jobId: job.id, kind: "full", credentials: body.credentials, unavailable: body.unavailable });
    return job;
  }

  async replay(ownerId: string, id: string): Promise<AuditJob> {
    const source = await this.deps.store.getOwned(id, ownerId);
    if (!source) throw new HttpError(404, "not_found", "Audit not found.");
    if (!TERMINAL_JOB_STATUSES.includes(source.status)) throw new HttpError(409, "audit_in_progress", "Wait for the audit to finish before replaying it.");
    if (source.mode === "replay") throw new HttpError(409, "replay_not_supported", "Replay the original audit instead of a replay.");
    if (source.captures.length === 0 || !source.plan) throw new HttpError(409, "nothing_to_replay", "This audit has no recorded evidence to replay.");
    await this.admit(ownerId);

    // Live evidence becomes "recorded replay"; synthetic evidence stays synthetic.
    const origin: EvidenceOrigin = source.evidenceOrigin === "live_capture" ? "recorded_replay" : source.evidenceOrigin;
    const job = newJob(ownerId, source.request, "replay", origin);
    job.replayOfAuditId = source.id;
    job.plan = source.plan;
    job.planUsage = [];
    job.regions = source.regions.map((r) => ({ ...r }));
    job.captures = source.captures.map((c) => ({ ...structuredClone(c), origin: c.origin === "live_capture" ? "recorded_replay" : c.origin }));
    for (const capture of job.captures) {
      for (const shot of capture.screenshots) await this.deps.artifacts.copy(source.id, job.id, shot.artifactId);
    }
    await this.deps.store.create(job);
    this.enqueue({ jobId: job.id, kind: "full" });
    return job;
  }

  // -- control --------------------------------------------------------------

  async cancel(ownerId: string, id: string): Promise<AuditJob> {
    const job = await this.deps.store.getOwned(id, ownerId);
    if (!job) throw new HttpError(404, "not_found", "Audit not found.");
    if (TERMINAL_JOB_STATUSES.includes(job.status)) return job;

    job.cancelRequestedAt ??= nowIso();
    const queuedAt = this.queue.findIndex((e) => e.jobId === id);
    if (queuedAt >= 0) {
      this.queue.splice(queuedAt, 1);
      this.memory.delete(id);
      for (const r of job.regions) {
        r.status = "cancelled";
        r.completedAt = nowIso();
        r.failure = { code: "cancelled", message: "Cancelled before it started." };
      }
      for (const s of job.stages) {
        s.status = "cancelled";
        s.completedAt = nowIso();
        s.message = "Cancelled.";
      }
      job.status = "cancelled";
      job.completedAt = nowIso();
      job.limitations = buildLimitations(job);
      await this.persist(job);
      return job;
    }
    const active = this.running.get(id);
    if (active) {
      active.controller.abort(new JobAborted("cancelled"));
      await Promise.race([active.done, new Promise((r) => setTimeout(r, 8000))]);
    }
    return (await this.deps.store.getOwned(id, ownerId)) ?? job;
  }

  async retryAnalysis(ownerId: string, id: string): Promise<AuditJob> {
    const job = await this.deps.store.getOwned(id, ownerId);
    if (!job) throw new HttpError(404, "not_found", "Audit not found.");
    if (!TERMINAL_JOB_STATUSES.includes(job.status) || this.running.has(id)) {
      throw new HttpError(409, "audit_in_progress", "Wait for the audit to finish before retrying the analysis.");
    }
    if (job.analysis.status === "completed") throw new HttpError(409, "analysis_complete", "The analysis already completed; there is nothing to retry.");
    if (job.analysis.attempts >= MAX_ANALYSIS_ATTEMPTS) {
      throw new HttpError(409, "retry_limit", `The analysis was already attempted ${MAX_ANALYSIS_ATTEMPTS} times.`);
    }
    if (job.analysis.failure && !job.analysis.failure.retryable && job.analysis.failure.code !== "missing_key") {
      throw new HttpError(409, "not_retryable", job.analysis.failure.message);
    }
    if (!job.plan || job.captures.length === 0) throw new HttpError(409, "nothing_to_analyze", "This audit has no evidence to analyze.");
    await this.admit(ownerId);
    job.status = "running";
    job.completedAt = null;
    await this.persist(job);
    this.enqueue({ jobId: id, kind: "analysis" });
    return job;
  }

  // -- scheduling -----------------------------------------------------------

  private enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
    this.memory.set(entry.jobId, entry);
    queueMicrotask(() => this.pump());
  }

  private pump(): void {
    while (!this.stopping && this.running.size < this.config.limits.maxConcurrentJobs && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new JobAborted("timeout")), this.config.limits.jobTimeoutMs);
      const done = this.run(entry, controller)
        .catch((error) => this.log("run_crashed", { auditId: entry.jobId, message: errorMessage(error).slice(0, 200) }))
        .finally(() => {
          clearTimeout(timer);
          this.running.delete(entry.jobId);
          // Release ephemeral credentials as soon as the job is over, on every path.
          this.memory.delete(entry.jobId);
          this.persistChains.delete(entry.jobId);
          this.pump();
        });
      this.running.set(entry.jobId, { controller, done });
    }
  }

  private persist(job: AuditJob): Promise<void> {
    const prev = this.persistChains.get(job.id) ?? Promise.resolve();
    const next = prev.then(() => this.deps.store.save(job));
    this.persistChains.set(job.id, next.catch(() => undefined));
    return next;
  }

  private async directIp(): Promise<string | null> {
    if (this.directIpCache && Date.now() - this.directIpCache.at < 5 * 60_000) return this.directIpCache.ip;
    let ip: string | null = null;
    try {
      const res = await fetch(this.config.egressEchoUrl, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json, text/plain" } });
      if (res.ok) ip = parseEchoIp((await res.text()).slice(0, 2000));
    } catch {
      ip = null;
    }
    this.directIpCache = { at: Date.now(), ip };
    return ip;
  }

  private async run(entry: QueueEntry, controller: AbortController): Promise<void> {
    const job = await this.deps.store.get(entry.jobId);
    if (!job) return;
    const previous = job.previousAuditId ? await this.deps.store.get(job.previousAuditId) : null;
    const ctx: PipelineContext = {
      config: this.config,
      meta: this.deps.meta,
      artifacts: this.deps.artifacts,
      fixture: this.deps.fixture,
      liveGeoip: this.liveGeoip,
      directIp: () => this.directIp(),
      credentials: entry.credentials,
      unavailable: entry.unavailable,
      slots: this.slots,
      persist: (j) => this.persist(j),
      signal: controller.signal,
      previous,
      log: (event, fields) => this.log(event, fields),
    };
    if (entry.kind === "analysis") {
      job.status = "running";
      try {
        await runAnalysis(job, ctx);
      } catch (error) {
        job.analysis.status = "failed";
        job.analysis.failure = { code: "http_error", message: errorMessage(error).slice(0, 300), retryable: true, attempts: job.analysis.attempts };
      }
      job.status = deriveJobStatus(job, null);
      job.completedAt = nowIso();
      job.limitations = buildLimitations(job);
      await this.persist(job);
      return;
    }
    await executePipeline(job, ctx);
  }

  // -- lifecycle ------------------------------------------------------------

  /** Mark jobs left queued/running by a previous process as interrupted (their credentials are gone). */
  async recoverAbandoned(): Promise<number> {
    const stuck = await this.deps.store.listByStatus(["queued", "running"]);
    for (const job of stuck) {
      for (const r of job.regions) {
        if (r.status === "pending" || r.status === "running") {
          r.status = "cancelled";
          r.completedAt = nowIso();
          r.failure = { code: "worker_restarted", message: "The auditor service restarted before this region finished." };
        }
      }
      for (const s of job.stages) {
        if (s.status === "pending" || s.status === "running") {
          s.status = "cancelled";
          s.completedAt = nowIso();
          s.message = "Interrupted by a service restart.";
        }
      }
      if (job.analysis.status === "running") job.analysis.status = "failed";
      job.failure = { code: "worker_restarted", message: "The auditor service restarted before this audit finished. Rerun it to collect fresh evidence." };
      job.status = deriveJobStatus(job, null);
      if (job.status === "completed") job.status = "partial";
      job.completedAt = nowIso();
      job.limitations = buildLimitations(job);
      await this.deps.store.save(job);
    }
    return stuck.length;
  }

  /** Delete finished audits (and their screenshots) older than the retention period. Returns how many were removed. */
  async prune(now: Date = new Date()): Promise<number> {
    const days = this.config.retentionDays;
    if (days <= 0) return 0;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    const ids = await this.deps.store.deleteFinishedBefore(cutoff);
    for (const id of ids) await this.deps.artifacts.deleteAudit(id).catch(() => undefined);
    if (ids.length > 0) this.log("retention_pruned", { removed: ids.length, olderThan: cutoff });
    return ids.length;
  }

  /** Prune now and then every six hours, without keeping the process alive. */
  startRetention(): void {
    void this.prune().catch((e) => this.log("retention_error", { message: errorMessage(e).slice(0, 200) }));
    const timer = setInterval(() => void this.prune().catch(() => undefined), 6 * 3_600_000);
    timer.unref();
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const { controller } of this.running.values()) controller.abort(new JobAborted("cancelled"));
    await Promise.allSettled([...this.running.values()].map((r) => r.done));
  }

  /** Test/ops hook: wait until the queue is empty and nothing is running. */
  async idle(): Promise<void> {
    while (this.queue.length > 0 || this.running.size > 0) {
      await Promise.allSettled([...this.running.values()].map((r) => r.done));
      await new Promise((r) => setTimeout(r, 5));
    }
  }

}
