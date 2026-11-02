// HTTP contract tests: signed requests, ownership of reports/screenshots/exports,
// and safe rendering of model-generated text in the HTML export.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MetaClient } from "../src/ai/meta.ts";
import { createApp } from "../src/app.ts";
import { AUTH_HEADERS, signRequest } from "../src/auth.ts";
import { startFixtureHarness, type FixtureHarness } from "../src/fixtures/harness.ts";
import { AuditRunner } from "../src/runner.ts";
import { FileArtifactStore, FileJobStore } from "../src/store/fileStore.ts";
import { makeFakeModel } from "./fakeModel.ts";
import { testConfig } from "./helpers.ts";

const OWNER = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER = "22222222-bbbb-4bbb-8bbb-222222222222";

let harness: FixtureHarness;
let dir: string;
let base: string;
let close: () => Promise<void>;
let config: ReturnType<typeof testConfig>;
let runner: AuditRunner;

before(async () => {
  harness = await startFixtureHarness({ scenario: "demo-v1" });
  dir = await mkdtemp(path.join(tmpdir(), "auditor-api-"));
  config = testConfig({ AUDITOR_FIXTURE_ENABLED: "1", AUDITOR_NAV_TIMEOUT_MS: "10000" });
  const model = makeFakeModel({
    // A model-written finding containing markup must never be rendered as markup.
    extraFindings: [{
      expectationId: "e1", kind: "other", classification: "hypothesis", severity: "low", regions: ["GH"], summary: "<img src=x onerror=alert(1)> check",
      observed: "<script>alert('x')</script>", expected: "n/a", evidenceIds: [], location: null, reproduction: [], nextAction: "none", uncertainty: "u",
    }],
  });
  const store = new FileJobStore(dir);
  const artifacts = new FileArtifactStore(dir);
  runner = new AuditRunner({ config, store, artifacts, meta: new MetaClient(config.model, model.fetch), fixture: harness });
  const server = createApp({ config, runner, store, artifacts, fixture: harness });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});
after(async () => {
  await runner.idle();
  await close();
  await harness.stop();
  await rm(dir, { recursive: true, force: true });
});

async function call(method: string, pathWithQuery: string, owner: string | null, body?: unknown, over: { secret?: string; tamper?: boolean } = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (owner) {
    const ts = Date.now();
    const nonce = randomBytes(12).toString("hex");
    const sig = signRequest(over.secret ?? config.serviceSecret!, { method, pathWithQuery, owner, body: payload, timestamp: ts, nonce });
    Object.assign(headers, { [AUTH_HEADERS.owner]: owner, [AUTH_HEADERS.timestamp]: String(ts), [AUTH_HEADERS.nonce]: nonce, [AUTH_HEADERS.signature]: sig });
  }
  const res = await fetch(`${base}${pathWithQuery}`, { method, headers, body: over.tamper ? `${payload} ` : payload || undefined });
  return res;
}

const createBody = () => ({
  request: { targetUrl: `${harness.targetOrigin}/`, regions: ["GH", "US"], expectations: "Check that signup is usable and the currency is right.", mode: "fixture" },
});

async function createAndWait(owner = OWNER) {
  const res = await call("POST", "/internal/v1/audits", owner, createBody());
  assert.equal(res.status, 202);
  const { audit } = (await res.json()) as { audit: { id: string; status: string } };
  await runner.idle();
  return audit.id;
}

describe("authentication", () => {
  it("serves health without auth but nothing else", async () => {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await call("GET", "/internal/v1/audits", null)).status, 401);
    assert.equal((await fetch(`${base}/anything`)).status, 404);
  });

  it("rejects wrong secrets and tampered bodies", async () => {
    assert.equal((await call("GET", "/internal/v1/audits", OWNER, undefined, { secret: "z".repeat(40) })).status, 401);
    assert.equal((await call("POST", "/internal/v1/audits", OWNER, createBody(), { tamper: true })).status, 401);
  });

  it("rejects oversized bodies before parsing them", async () => {
    const res = await call("POST", "/internal/v1/audits", OWNER, { request: { expectations: "x".repeat(200_000) } });
    assert.equal(res.status, 413);
  });
});

describe("audit API", () => {
  it("creates asynchronously, then serves a persisted report without credentials or owner ids", async () => {
    const id = await createAndWait();
    const res = await call("GET", `/internal/v1/audits/${id}`, OWNER);
    assert.equal(res.status, 200);
    const text = await res.text();
    const { audit } = JSON.parse(text);
    assert.equal(audit.status, "completed");
    assert.equal(audit.ownerId, undefined);
    assert.doesNotMatch(text, new RegExp(OWNER));
    assert.doesNotMatch(text, new RegExp(harness.credentialFor("GH")!.password));
    assert.doesNotMatch(text, /test-key-do-not-use/);
    assert.equal(audit.captures[0].route.sessionRef, "fixture-…", "session references are masked");

    const list = (await (await call("GET", "/internal/v1/audits", OWNER)).json()) as { audits: Array<{ id: string; findingCount: number }> };
    assert.ok(list.audits.some((a) => a.id === id && a.findingCount >= 2));
  });

  it("hides audits, actions, screenshots and exports from other owners", async () => {
    const id = await createAndWait();
    const get = await call("GET", `/internal/v1/audits/${id}`, OTHER);
    assert.equal(get.status, 404);
    for (const action of ["cancel", "rerun", "replay", "retry-analysis"]) {
      assert.equal((await call("POST", `/internal/v1/audits/${id}/${action}`, OTHER, {})).status, 404, action);
    }
    const mine = (await (await call("GET", `/internal/v1/audits/${id}`, OWNER)).json()) as { audit: { captures: Array<{ screenshots: Array<{ artifactId: string }> }> } };
    const artifactId = mine.audit.captures[0]!.screenshots[0]!.artifactId;
    assert.equal((await call("GET", `/internal/v1/audits/${id}/artifacts/${artifactId}`, OTHER)).status, 404);
    assert.equal((await call("GET", `/internal/v1/audits/${id}/export?format=json`, OTHER)).status, 404);
    assert.equal(((await (await call("GET", "/internal/v1/audits", OTHER)).json()) as { audits: unknown[] }).audits.length, 0);
  });

  it("serves a screenshot only through ownership and only if the report references it", async () => {
    const id = await createAndWait();
    const doc = (await (await call("GET", `/internal/v1/audits/${id}`, OWNER)).json()) as { audit: { captures: Array<{ screenshots: Array<{ artifactId: string }> }> } };
    const artifactId = doc.audit.captures[0]!.screenshots[0]!.artifactId;
    const ok = await call("GET", `/internal/v1/audits/${id}/artifacts/${artifactId}`, OWNER);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await ok.arrayBuffer()).subarray(1, 4).toString(), "PNG");
    for (const bad of ["unreferenced.png", "..%2F..%2Fjobs%2Fx.json", "%2e%2e%2f%2e%2e%2fsecret"]) {
      assert.equal((await call("GET", `/internal/v1/audits/${id}/artifacts/${bad}`, OWNER)).status, 404, bad);
    }
  });

  it("exports sanitized JSON that keeps provenance and limitations", async () => {
    const id = await createAndWait();
    const res = await call("GET", `/internal/v1/audits/${id}/export?format=json`, OWNER);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
    const text = await res.text();
    const data = JSON.parse(text);
    assert.equal(data.format, "proxyhubb-regional-audit/1");
    assert.equal(data.audit.evidenceOrigin, "synthetic_fixture");
    assert.ok(data.captures.every((c: { evidenceOrigin: string }) => c.evidenceOrigin === "synthetic_fixture"));
    assert.ok(data.captures[0].route.geoip.source.includes("synthetic"));
    assert.ok(data.limitations.length > 0);
    assert.ok(data.analysis.note.includes("not ground truth"));
    assert.doesNotMatch(text, /ownerId|password|test-key/);
    assert.equal(data.captures[0].route.sessionRef, "fixture-…");
  });

  it("exports an HTML report that is labelled synthetic and escapes model-written markup", async () => {
    const id = await createAndWait();
    const res = await call("GET", `/internal/v1/audits/${id}/export?format=html`, OWNER);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /SYNTHETIC FIXTURE/);
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /data:image\/png;base64,/);
    assert.doesNotMatch(html, /<script/i, "no script element can exist in the export");
    assert.doesNotMatch(html, /<img src=x/i);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal((await call("GET", `/internal/v1/audits/${id}/export?format=pdf`, OWNER)).status, 400);
  });

  it("validates requests and reports clear errors", async () => {
    const bad = await call("POST", "/internal/v1/audits", OWNER, { request: { targetUrl: "not a url", regions: ["gh"], expectations: "short", mode: "fixture" } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "invalid_request");
    const live = await call("POST", "/internal/v1/audits", OWNER, { request: { targetUrl: "https://shop.example.com/", regions: ["GH"], expectations: "Check that signup works", mode: "live" } });
    assert.equal(live.status, 409);
    assert.equal(((await live.json()) as { error: { code: string } }).error.code, "live_unavailable");
    assert.equal((await call("GET", "/internal/v1/audits/not-an-id", OWNER)).status, 404);
  });

  it("reports capabilities honestly and without secrets", async () => {
    const res = await call("GET", "/internal/v1/capabilities", OWNER);
    const text = await res.text();
    const caps = JSON.parse(text);
    assert.equal(caps.modes.live.available, false);
    assert.ok(caps.modes.live.missing.includes("AUDITOR_PROXY_ENDPOINT"));
    assert.equal(caps.modes.fixture.available, true);
    assert.equal(caps.ai.configured, true);
    assert.equal(caps.ai.dataMode, "standard");
    assert.doesNotMatch(text, /test-key-do-not-use|t{40}/);
  });

  it("lets the fixture demo flip the site to the fixed version, and nothing else", async () => {
    const res = await call("POST", "/internal/v1/fixture/scenario", OWNER, { id: "demo-v2" });
    assert.equal(res.status, 200);
    assert.equal(harness.scenarioId(), "demo-v2");
    assert.equal((await call("POST", "/internal/v1/fixture/scenario", OWNER, { id: "nope" })).status, 400);
    harness.setScenario("demo-v1");
  });
});
