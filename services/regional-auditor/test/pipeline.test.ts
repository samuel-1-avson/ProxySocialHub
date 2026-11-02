// End-to-end pipeline tests with a REAL browser, a REAL authenticating proxy and a
// REAL demo website (all local, synthetic). Only the model is replaced.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { MetaClient } from "../src/ai/meta.ts";
import { loadConfig } from "../src/config.ts";
import type { AuditJob } from "../src/contracts.ts";
import { startFixtureHarness, type FixtureHarness } from "../src/fixtures/harness.ts";
import { AuditRunner } from "../src/runner.ts";
import { FileArtifactStore, FileJobStore } from "../src/store/fileStore.ts";
import { HttpError } from "../src/util.ts";
import { makeFakeModel, type FakeModel } from "./fakeModel.ts";
import { testConfig } from "./helpers.ts";

const OWNER = "owner-0000-aaaa";
const OTHER = "owner-0000-bbbb";

let harness: FixtureHarness;
let dir: string;

before(async () => {
  harness = await startFixtureHarness({ scenario: "demo-v1" });
  dir = await mkdtemp(path.join(tmpdir(), "auditor-pipeline-"));
});
after(async () => {
  await harness.stop();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  harness.setScenario("demo-v1");
  for (const c of harness.regions) harness.setFault(c, null);
});

function setup(model: FakeModel | null, extra: Record<string, string> = {}) {
  const base = testConfig({ AUDITOR_FIXTURE_ENABLED: "1", AUDITOR_NAV_TIMEOUT_MS: "10000", AUDITOR_JOB_TIMEOUT_MS: "90000", ...extra });
  const config = model ? base : loadConfig({ NODE_ENV: "test", AUDITOR_FIXTURE_ENABLED: "1", AUDITOR_NAV_TIMEOUT_MS: "10000", ...extra });
  const store = new FileJobStore(path.join(dir, `s-${Math.random().toString(16).slice(2)}`));
  const artifacts = new FileArtifactStore(path.join(dir, `a-${Math.random().toString(16).slice(2)}`));
  const meta = new MetaClient(config.model, model?.fetch);
  const runner = new AuditRunner({ config, store, artifacts, meta, fixture: harness });
  return { runner, store, artifacts, config };
}

const fixtureBody = (regions = ["GH", "US"]) => ({
  request: { targetUrl: `${harness.targetOrigin}/`, regions, expectations: "Check that signup is usable and that the expected currency is displayed for customers in Ghana and the US.", mode: "fixture" },
});

async function finish(env: ReturnType<typeof setup>, job: AuditJob): Promise<AuditJob> {
  await env.runner.idle();
  return (await env.store.get(job.id))!;
}

describe("fixture audit, end to end", () => {
  it("captures two verified regions and reports the seeded defects with provenance", async () => {
    const model = makeFakeModel();
    const env = setup(model);
    const created = await env.runner.create(OWNER, fixtureBody());
    assert.equal(created.status, "queued", "create returns immediately; the browser work happens in the worker");
    const job = await finish(env, created);

    assert.equal(job.status, "completed");
    assert.equal(job.evidenceOrigin, "synthetic_fixture");
    assert.deepEqual(job.regions.map((r) => [r.country, r.status, r.assurance]), [["GH", "captured", "verified"], ["US", "captured", "verified"]]);
    for (const c of job.captures) {
      assert.equal(c.origin, "synthetic_fixture");
      assert.equal(c.route.transport, "fixture_proxy");
      assert.match(c.route.geoip.source, /synthetic/);
      assert.equal(c.route.egressObservations.length, 2, "egress is observed before and after capture");
      assert.equal(c.page.mainDocumentStatus, 200);
      assert.equal(c.browser.locale, "en-US");
      assert.equal(c.browser.timezoneId, "UTC");
      assert.ok(c.screenshots.length >= 1);
      const bytes = await env.artifacts.get(job.id, c.screenshots[0]!.artifactId);
      assert.equal(bytes?.subarray(1, 4).toString(), "PNG");
    }
    const kinds = job.analysis.findings.map((f) => `${f.kind}:${f.regions.join("")}`).sort();
    assert.deepEqual(kinds, ["currency_mismatch:US", "element_obscured:GH"]);
    assert.equal(job.analysis.status, "completed");
    assert.deepEqual(job.analysis.evidenceOrigins, ["synthetic_fixture"]);
    assert.ok(job.analysis.limitations.some((l) => /synthetic/i.test(l)), "analysis states that evidence is synthetic");
    assert.ok(job.limitations.some((l) => /Synthetic fixture/.test(l)));
    assert.equal(job.plan?.source, "model");
    assert.deepEqual(job.analysis.usage.calls.map((c) => c.stage), ["plan", "analyze"]);
    assert.equal(job.analysis.usage.costEstimate?.label, "estimate");
    // The fake model's payload told it the evidence was synthetic.
    const payload = JSON.stringify(model.requests.at(-1)!.body);
    assert.match(payload, /synthetic_fixture/);
  });

  it("reruns after the fix and shows resolved findings only for verified, analyzed regions", async () => {
    const env = setup(makeFakeModel());
    const first = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    assert.equal(first.analysis.findings.length, 2);

    harness.setScenario("demo-v2");
    const rerun = await finish(env, await env.runner.rerun(OWNER, first.id, {}));
    assert.equal(rerun.previousAuditId, first.id);
    assert.equal(rerun.status, "completed");
    assert.equal(rerun.analysis.findings.length, 0);
    assert.equal(rerun.stages.find((s) => s.name === "plan")?.status, "skipped", "the same plan (checks) is reused so results are comparable");
    assert.deepEqual(rerun.plan, first.plan);
    const by = (s: string) => rerun.comparison!.items.filter((i) => i.status === s).length;
    assert.equal(by("resolved"), 2);
    assert.equal(by("persisting") + by("new") + by("incomparable"), 0);
  });

  it("does not interpret a region whose exit country does not match, and never falls back", async () => {
    const model = makeFakeModel();
    const env = setup(model);
    harness.setFault("US", "wrong_country");
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));

    const us = job.regions.find((r) => r.country === "US")!;
    assert.equal(us.status, "mismatch");
    assert.equal(us.failure?.code, "region_mismatch");
    const cap = job.captures.find((c) => c.requestedCountry === "US")!;
    assert.equal(cap.route.assurance, "mismatch");
    assert.equal(cap.page.loadState, "not_attempted", "the target page was never visited through the wrong exit");
    assert.equal(cap.screenshots.length, 0);
    assert.equal(job.status, "partial", "a mismatch is never a clean result");
    assert.deepEqual(model.analyzedEvidenceIds(), [job.captures.find((c) => c.requestedCountry === "GH")!.evidenceId], "the model only saw the verified region");
    assert.ok(job.analysis.findings.every((f) => !f.regions.includes("US")));
    assert.ok(job.limitations.some((l) => /^US: not interpreted/.test(l)));
  });

  it("treats an unplaceable exit as unverified: captured for inspection but not interpreted", async () => {
    const model = makeFakeModel();
    const env = setup(model);
    harness.setFault("GH", "unknown_ip");
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    const gh = job.regions.find((r) => r.country === "GH")!;
    assert.equal(gh.status, "unverified");
    const cap = job.captures.find((c) => c.requestedCountry === "GH")!;
    assert.equal(cap.route.geoip.country, null);
    assert.ok(cap.screenshots.length >= 1, "evidence is kept so the user can inspect it");
    assert.equal(job.status, "partial");
    assert.ok(!model.analyzedEvidenceIds().includes(cap.evidenceId));
  });

  it("re-checks egress after capture and catches a route change mid-run", async () => {
    const env = setup(makeFakeModel());
    harness.setFault("GH", "rotate_after_first");
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    const cap = job.captures[0]!;
    assert.equal(cap.route.egressObservations.length, 2);
    assert.notEqual(cap.route.egressObservations[0]!.ip, cap.route.egressObservations[1]!.ip);
    assert.equal(cap.route.assurance, "mismatch");
    assert.match(cap.route.assuranceReason, /changed during capture/);
    assert.equal(job.regions[0]!.status, "mismatch");
    assert.notEqual(job.status, "completed");
  });

  it("fails a region whose proxy refuses the session instead of going direct", async () => {
    const env = setup(makeFakeModel());
    harness.setFault("US", "deny_auth");
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    const us = job.regions.find((r) => r.country === "US")!;
    assert.equal(us.status, "failed");
    assert.equal(us.failure?.code, "egress_probe_failed");
    const cap = job.captures.find((c) => c.requestedCountry === "US")!;
    assert.equal(cap.page.loadState, "not_attempted");
    assert.equal(cap.route.observedEgressIp, null);
    assert.equal(job.status, "partial");
    assert.equal(job.regions.find((r) => r.country === "GH")!.status, "captured", "one failing region does not discard the other");
  });

  it("keeps all evidence when the model fails, then retries only the analysis", async () => {
    const model = makeFakeModel({ failAnalysisCalls: 1 });
    const env = setup(model, { AUDITOR_MODEL_MAX_RETRIES: "0" });
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    assert.equal(job.analysis.status, "failed");
    assert.equal(job.analysis.failure?.code, "http_error");
    assert.equal(job.analysis.failure?.retryable, true);
    assert.equal(job.status, "partial");
    assert.equal(job.captures.length, 2, "captures survive a model failure");
    assert.equal(job.regions.every((r) => r.status === "captured"), true);

    const captureStageDone = job.stages.find((s) => s.name === "capture")?.completedAt;
    const retried = await env.runner.retryAnalysis(OWNER, job.id);
    assert.equal(retried.status, "running");
    const done = await finish(env, retried);
    assert.equal(done.analysis.status, "completed");
    assert.equal(done.analysis.attempts, 2);
    assert.equal(done.status, "completed");
    assert.equal(done.stages.find((s) => s.name === "capture")?.completedAt, captureStageDone, "capture was not repeated");
    assert.equal(done.analysis.usage.calls.filter((c) => c.stage === "plan").length, 1, "plan usage is kept across retries");
    await assert.rejects(env.runner.retryAnalysis(OWNER, job.id), (e: unknown) => e instanceof HttpError && e.code === "analysis_complete");
  });

  it("shows 'AI analysis not run' when no model is configured, and still completes the capture", async () => {
    const env = setup(null);
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    assert.equal(job.analysis.status, "not_run");
    assert.equal(job.analysis.failure?.code, "missing_key");
    assert.equal(job.analysis.findings.length, 0);
    assert.equal(job.plan?.source, "default");
    assert.equal(job.status, "completed");
    assert.ok(job.limitations.includes("AI analysis not run."));
    assert.equal(job.captures.length, 2);
  });

  it("drops model findings that cite evidence that does not exist", async () => {
    const model = makeFakeModel({
      extraFindings: [{
        expectationId: "e1", kind: "other", classification: "observed_defect", severity: "critical", regions: ["GH"], summary: "Invented problem",
        observed: "x", expected: "y", evidenceIds: ["ev-deadbeef-GH"], location: null, reproduction: [], nextAction: "n", uncertainty: "u",
      }],
    });
    const env = setup(model);
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    assert.ok(!job.analysis.findings.some((f) => f.summary === "Invented problem"));
    assert.equal(job.analysis.validation.droppedFindings.length, 1);
  });

  it("never stores proxy credentials in the job document or the export", async () => {
    const env = setup(makeFakeModel());
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody()));
    const password = harness.credentialFor("GH")!.password;
    const stored = JSON.stringify(await env.store.get(job.id));
    assert.doesNotMatch(stored, new RegExp(password));
    assert.doesNotMatch(stored, /password/i);
    assert.doesNotMatch(stored, /test-key-do-not-use/);
  });
});

describe("lifecycle and control", () => {
  it("cancels a running audit, ends it as cancelled and releases the worker", async () => {
    const env = setup(makeFakeModel());
    const job = await env.runner.create(OWNER, fixtureBody());
    await new Promise((r) => setTimeout(r, 150)); // let the browser start
    const cancelled = await env.runner.cancel(OWNER, job.id);
    assert.equal(cancelled.status, "cancelled");
    await env.runner.idle();
    const stored = (await env.store.get(job.id))!;
    assert.equal(stored.status, "cancelled");
    assert.ok(stored.cancelRequestedAt);
    assert.ok(stored.regions.every((r) => r.status === "cancelled" || r.status === "captured" || r.status === "unverified" || r.status === "mismatch" || r.status === "failed"));
    assert.equal(stored.regions.some((r) => r.status === "running" || r.status === "pending"), false, "no region is left running");
    assert.notEqual(stored.analysis.status, "running");
    // A fresh audit still works afterwards: nothing was left holding a browser slot.
    const next = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    assert.equal(next.status, "completed");
  });

  it("cancels a queued audit before it ever starts", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_MAX_CONCURRENT_JOBS: "1" });
    const first = await env.runner.create(OWNER, fixtureBody(["GH"]));
    const second = await env.runner.create(OWNER, fixtureBody(["GH"]));
    const cancelled = await env.runner.cancel(OWNER, second.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.regions[0]!.failure?.code, "cancelled");
    assert.equal(cancelled.startedAt, null);
    const done = await finish(env, first);
    assert.equal(done.status, "completed");
  });

  it("marks jobs left running by a dead worker as interrupted, keeping their evidence", async () => {
    const env = setup(makeFakeModel());
    const done = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    // Simulate a crash mid-analysis: the persisted doc says running.
    done.status = "running";
    done.analysis.status = "running";
    done.regions[0]!.status = "running";
    await env.store.save(done);
    const fresh = new AuditRunner({ config: env.config, store: env.store, artifacts: env.artifacts, meta: new MetaClient(env.config.model), fixture: harness });
    assert.equal(await fresh.recoverAbandoned(), 1);
    const recovered = (await env.store.get(done.id))!;
    assert.notEqual(recovered.status, "running");
    assert.equal(recovered.failure?.code, "worker_restarted");
    assert.equal(recovered.captures.length, 1);
  });

  it("enforces ownership on every operation", async () => {
    const env = setup(makeFakeModel());
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    assert.equal(await env.store.getOwned(job.id, OTHER), null);
    for (const op of [
      () => env.runner.cancel(OTHER, job.id),
      () => env.runner.rerun(OTHER, job.id, {}),
      () => env.runner.replay(OTHER, job.id),
      () => env.runner.retryAnalysis(OTHER, job.id),
    ]) {
      await assert.rejects(op(), (e: unknown) => e instanceof HttpError && e.status === 404);
    }
  });

  it("limits concurrent active audits per owner", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_MAX_ACTIVE_JOBS_PER_OWNER: "1" });
    await env.runner.create(OWNER, fixtureBody(["GH"]));
    await assert.rejects(env.runner.create(OWNER, fixtureBody(["GH"])), (e: unknown) => e instanceof HttpError && e.code === "too_many_active_audits");
    await env.runner.create(OTHER, fixtureBody(["GH"])); // another owner is unaffected
    await env.runner.idle();
  });
});

describe("request validation", () => {
  it("refuses live audits when the service is not configured and names the missing variables", async () => {
    const env = setup(makeFakeModel());
    await assert.rejects(
      env.runner.create(OWNER, { request: { targetUrl: "https://shop.example.com/", regions: ["GH"], expectations: "Check that signup works", mode: "live" } }),
      (e: unknown) => e instanceof HttpError && e.code === "live_unavailable" && /AUDITOR_PROXY_ENDPOINT/.test(e.message) && /AUDITOR_ALLOWED_TARGET_ORIGINS/.test(e.message),
    );
  });

  it("rejects unauthorized and private live targets even when live is configured", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_PROXY_ENDPOINT: "proxy.test:8090", AUDITOR_ALLOWED_TARGET_ORIGINS: "https://shop.example.com" });
    const live = (targetUrl: string) => env.runner.create(OWNER, { request: { targetUrl, regions: ["GH"], expectations: "Check that signup works", mode: "live" } });
    await assert.rejects(live("https://other.example.org/"), (e: unknown) => e instanceof HttpError && e.code === "origin_not_authorized");
    await assert.rejects(live("https://169.254.169.254/latest/meta-data/"), (e: unknown) => e instanceof HttpError && e.code === "blocked_ip");
    await assert.rejects(live("http://shop.example.com/"), (e: unknown) => e instanceof HttpError && e.code === "scheme_not_allowed");
    await assert.rejects(live("https://localhost/"), (e: unknown) => e instanceof HttpError && e.code === "blocked_host");
  });

  it("fixture audits may only target the fixture site and known fixture regions", async () => {
    const env = setup(makeFakeModel());
    await assert.rejects(env.runner.create(OWNER, { request: { ...fixtureBody().request, targetUrl: "http://127.0.0.1:9/" } }), (e: unknown) => e instanceof HttpError && e.code === "target_not_fixture");
    await assert.rejects(env.runner.create(OWNER, fixtureBody(["NG"])), (e: unknown) => e instanceof HttpError && e.code === "region_not_in_fixture");
  });

  it("marks a live region unavailable when no session was provided, instead of substituting another route", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_PROXY_ENDPOINT: "proxy.test:8090", AUDITOR_ALLOWED_TARGET_ORIGINS: "https://example.com" });
    const job = await finish(
      env,
      await env.runner.create(OWNER, {
        request: { targetUrl: "https://example.com/", regions: ["GH"], expectations: "Check that signup works", mode: "live" },
        unavailable: { GH: { code: "no_listing_for_region", message: "No active listing serves GH." } },
      }),
    );
    assert.equal(job.regions[0]!.status, "unavailable");
    assert.equal(job.regions[0]!.failure?.code, "no_listing_for_region");
    assert.equal(job.captures.length, 0);
    assert.equal(job.status, "failed", "no verified evidence means the audit failed, not that the site is healthy");
    assert.equal(job.analysis.findings.length, 0);
  });
});

describe("replay", () => {
  it("keeps synthetic evidence synthetic and keeps the original capture time", async () => {
    const env = setup(makeFakeModel());
    const source = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    const replay = await finish(env, await env.runner.replay(OWNER, source.id));
    assert.equal(replay.mode, "replay");
    assert.equal(replay.evidenceOrigin, "synthetic_fixture");
    assert.equal(replay.replayOfAuditId, source.id);
    assert.equal(replay.captures[0]!.capturedAt, source.captures[0]!.capturedAt);
    assert.equal(replay.stages.find((s) => s.name === "capture")?.status, "skipped");
    assert.equal(replay.analysis.status, "completed");
    assert.ok(replay.analysis.startedAt! >= source.analysis.completedAt!, "analysis timestamp is new");
    assert.ok(await env.artifacts.get(replay.id, replay.captures[0]!.screenshots[0]!.artifactId), "screenshots are available to the replay");
  });

  it("labels a replay of live evidence as recorded_replay with the original timestamps", async () => {
    const env = setup(makeFakeModel());
    const source = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    // Treat the stored capture as if it had been a live capture.
    source.evidenceOrigin = "live_capture";
    source.mode = "live";
    source.captures = source.captures.map((c) => ({ ...c, origin: "live_capture" as const }));
    await env.store.save(source);
    const replay = await finish(env, await env.runner.replay(OWNER, source.id));
    assert.equal(replay.evidenceOrigin, "recorded_replay");
    assert.equal(replay.captures[0]!.origin, "recorded_replay");
    assert.equal(replay.captures[0]!.capturedAt, source.captures[0]!.capturedAt);
    assert.deepEqual(replay.analysis.evidenceOrigins, ["recorded_replay"]);
    await assert.rejects(env.runner.rerun(OWNER, replay.id, {}), (e: unknown) => e instanceof HttpError && e.code === "rerun_not_supported");
  });
});

describe("network policy, end to end", () => {
  const body = (path: string) => ({ request: { ...fixtureBody(["GH"]).request, targetUrl: `${harness.targetOrigin}${path}` } });

  it("blocks sub-resources from unapproved origins and reports them as policy blocks, not site defects", async () => {
    const env = setup(makeFakeModel());
    const job = await finish(env, await env.runner.create(OWNER, body("/__offsite")));
    const cap = job.captures[0]!;
    assert.equal(cap.page.loadState === "load" || cap.page.loadState === "domcontentloaded", true);
    assert.ok(cap.blockedRequests.some((b) => /127.0.0.1:47999/.test(b.url) && /not allowed|not approved/.test(b.reason)));
    assert.equal(cap.failedRequests.some((r) => /127.0.0.1:47999/.test(r.url)), false, "a policy block is not recorded as the site failing");
  });

  it("detects a redirect to an unapproved origin, stops the navigation and captures nothing from it", async () => {
    const env = setup(makeFakeModel());
    const job = await finish(env, await env.runner.create(OWNER, body("/__redirect?to=http%3A%2F%2F127.0.0.1%3A47999%2Fsecret")));
    const cap = job.captures[0]!;
    // Chromium follows the redirect before any worker-side code can stop it, so this is detection, not prevention.
    assert.ok(cap.policyViolations.some((v) => /127.0.0.1:47999/.test(v.url) && /does not approve/.test(v.reason)));
    assert.equal(cap.page.loadState, "error");
    assert.match(cap.page.navigationError ?? "", /redirected to a destination that is not approved/);
    assert.equal(cap.screenshots.length, 0, "nothing from the unapproved origin was captured");
    assert.equal(cap.page.visibleText, "");
    assert.equal(cap.page.mainDocumentStatus, null, "the unapproved hop's status is not reported as the site's");
    assert.equal(cap.checks.length, 0);
  });

  it("stops a redirect loop at the configured limit and reports it", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_MAX_REDIRECTS: "3" });
    const job = await finish(env, await env.runner.create(OWNER, body("/__loop?n=20")));
    const cap = job.captures[0]!;
    assert.ok(cap.policyViolations.some((v) => /more than 3 redirects/.test(v.reason)));
    assert.equal(cap.page.loadState, "error");
    assert.equal(cap.screenshots.length, 0);
  });
});

describe("retention", () => {
  it("prunes finished audits and their screenshots after the retention period, never an unfinished one", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_RETENTION_DAYS: "30" });
    const done = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    const shot = done.captures[0]!.screenshots[0]!.artifactId;
    assert.ok(await env.artifacts.get(done.id, shot));

    // Nothing is removed while the audit is inside the retention window.
    assert.equal(await env.runner.prune(), 0);
    assert.ok(await env.store.get(done.id));

    // Age it past the window, and add an equally old audit that is still running.
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await env.store.save({ ...done, createdAt: old });
    const stuck = { ...done, id: "aud_00000000dead", status: "running" as const, createdAt: old, revision: 0 };
    await env.store.create(stuck);

    assert.equal(await env.runner.prune(), 1);
    assert.equal(await env.store.get(done.id), null);
    assert.equal(await env.artifacts.get(done.id, shot), null, "the screenshots went with it");
    assert.ok(await env.store.get(stuck.id), "an unfinished audit is never pruned");
  });

  it("keeps everything when retention is disabled", async () => {
    const env = setup(makeFakeModel(), { AUDITOR_RETENTION_DAYS: "0" });
    const done = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    await env.store.save({ ...done, createdAt: "2020-01-01T00:00:00.000Z" });
    assert.equal(await env.runner.prune(), 0);
    assert.ok(await env.store.get(done.id));
  });
});

describe("model-call budget", () => {
  it("never makes more model calls than the per-job budget, including retries and re-analysis", async () => {
    const model = makeFakeModel({ failAnalysisCalls: 99 });
    const env = setup(model, { AUDITOR_MAX_MODEL_CALLS_PER_JOB: "2", AUDITOR_MODEL_MAX_RETRIES: "5" });
    const job = await finish(env, await env.runner.create(OWNER, fixtureBody(["GH"])));
    assert.equal(job.analysis.status, "failed");
    assert.equal(model.requests.filter((r) => r.stage === "analyze").length, 1, "one analysis call fits in a budget of 2 after planning used 1");
    const retried = await finish(env, await env.runner.retryAnalysis(OWNER, job.id));
    assert.equal(retried.analysis.failure?.code, "call_budget_exhausted");
    assert.equal(model.requests.filter((r) => r.stage === "analyze").length, 1, "the exhausted budget stopped the retry before any HTTP call");
    assert.equal(retried.captures.length, 1, "evidence is untouched");
  });
});
