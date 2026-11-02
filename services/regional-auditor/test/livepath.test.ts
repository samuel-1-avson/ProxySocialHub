// The LIVE transport, end to end, against a local simulation of the gateway:
// Chromium -> HTTP CONNECT (407 challenge, Basic credentials) -> TLS with a real certificate -> page.
// This is not a ProxyHubb session and proves nothing about real regional exits; it proves that the
// code path the live mode uses behaves correctly against a gateway that speaks the real protocol.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MetaClient } from "../src/ai/meta.ts";
import { StaticGeoIpProvider } from "../src/geo.ts";
import { AuditRunner } from "../src/runner.ts";
import { FileArtifactStore, FileJobStore } from "../src/store/fileStore.ts";
import { makeFakeModel } from "./fakeModel.ts";
import { testConfig } from "./helpers.ts";
import { ECHO_HOST, SHOP_HOST, opensslAvailable, startLiveSim, type LiveSim } from "./liveSim.ts";

const OWNER = "owner-live-0001";
const TOKENS = { GH: "tok-gh-0000000000000001", US: "tok-us-0000000000000002" };
const IPS = { GH: "198.51.100.23", US: "203.0.113.45" };

const run = opensslAvailable();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "auditor-live-"));
});
after(async () => rm(dir, { recursive: true, force: true }));

async function setup(sim: LiveSim, extra: Record<string, string> = {}, model = makeFakeModel()) {
  const config = testConfig({
    AUDITOR_PROXY_ENDPOINT: sim.gatewayEndpoint,
    AUDITOR_ALLOWED_TARGET_ORIGINS: `https://${SHOP_HOST}`,
    AUDITOR_EGRESS_ECHO_URL: `https://${ECHO_HOST}/__egress`,
    AUDITOR_GEOIP_PROVIDER: "none",
    AUDITOR_NAV_TIMEOUT_MS: "10000",
    AUDITOR_TEST_CHROME_ARGS: JSON.stringify([`--ignore-certificate-errors-spki-list=${sim.spki}`]),
    ...extra,
  });
  const store = new FileJobStore(path.join(dir, `s-${Math.random().toString(16).slice(2)}`));
  const artifacts = new FileArtifactStore(path.join(dir, `a-${Math.random().toString(16).slice(2)}`));
  const geoip = new StaticGeoIpProvider({ [IPS.GH]: "GH", [IPS.US]: "US", "192.0.2.99": "NG" }, "test-static-table (synthetic)");
  const runner = new AuditRunner({ config, store, artifacts, meta: new MetaClient(config.model, model.fetch), fixture: null, liveGeoip: geoip });
  return { runner, store, model };
}

const creds = (tokens: Record<string, string> = TOKENS) => ({
  GH: { sessionRef: "intent-gh-00000001", username: "session-intent", password: tokens.GH! },
  US: { sessionRef: "intent-us-00000002", username: "session-intent", password: tokens.US! },
});
const body = (credentials: ReturnType<typeof creds>, path = "/") => ({
  request: { targetUrl: `https://${SHOP_HOST}${path}`, regions: ["GH", "US"], expectations: "Check that signup is usable and the currency is right.", mode: "live" },
  credentials,
});

describe("live transport against a simulated authenticating gateway", { skip: run ? undefined : "openssl is not available to create a test certificate" }, () => {
  let sim: LiveSim;
  before(async () => {
    sim = await startLiveSim({ regions: { GH: { token: TOKENS.GH, ip: IPS.GH }, US: { token: TOKENS.US, ip: IPS.US } } });
  });
  after(async () => sim.stop());

  it("captures both regions over CONNECT + TLS after the 407 challenge, with verified exits", async () => {
    sim.target.setScenario("demo-v1");
    sim.log.length = 0;
    const { runner, store } = await setup(sim);
    const created = await runner.create(OWNER, body(creds()));
    await runner.idle();
    const job = (await store.get(created.id))!;

    assert.equal(job.status, "completed");
    assert.equal(job.evidenceOrigin, "live_capture");
    for (const cap of job.captures) {
      assert.equal(cap.route.transport, "proxyhubb_gateway");
      assert.equal(cap.route.assurance, "verified");
      assert.equal(cap.page.mainDocumentStatus, 200);
      assert.equal(cap.page.finalUrl, `https://${SHOP_HOST}/`);
      assert.equal(cap.route.egressObservations.length, 2);
      assert.equal(cap.route.declaredCountry.value, null, "no declared country was supplied, and none is invented");
      assert.match(cap.route.declaredCountry.source, /not provided/);
      assert.ok(cap.screenshots.length >= 1);
    }
    assert.equal(job.captures.find((c) => c.requestedCountry === "GH")!.route.observedEgressIp, IPS.GH);
    assert.equal(job.captures.find((c) => c.requestedCountry === "US")!.route.observedEgressIp, IPS.US);
    assert.deepEqual(job.analysis.findings.map((f) => `${f.kind}:${f.regions.join("")}`).sort(), ["currency_mismatch:US", "element_obscured:GH"]);

    // Chromium really did see the challenge and answered it: a CONNECT without credentials was refused with
    // 407 before the same host was reached with them, and every successful tunnel was authenticated.
    const refused = sim.log.filter((e) => e.status === 407);
    assert.ok(refused.length >= 1, "the gateway challenged at least once");
    assert.ok(refused.every((e) => !e.authenticated), "only requests without credentials were challenged");
    const tunnels = sim.log.filter((e) => e.status === 200);
    assert.ok(tunnels.length >= 4 && tunnels.every((e) => e.authenticated));
    assert.ok(tunnels.some((e) => e.host === ECHO_HOST) && tunnels.some((e) => e.host === SHOP_HOST));
    // Only approved hosts were ever contacted through the gateway.
    assert.ok(sim.log.every((e) => e.host === ECHO_HOST || e.host === SHOP_HOST));

    // Credentials were held in memory only.
    const stored = JSON.stringify(await store.get(job.id));
    assert.doesNotMatch(stored, new RegExp(TOKENS.GH));
    assert.doesNotMatch(stored, new RegExp(TOKENS.US));
  });

  it("refuses to load the site through an exit in the wrong country (no page request is ever made through it)", async () => {
    sim.log.length = 0;
    const bad = { ...TOKENS };
    const wrong = await startLiveSim({ regions: { GH: { token: TOKENS.GH, ip: IPS.GH }, US: { token: TOKENS.US, ip: "192.0.2.99" } } });
    try {
      const { runner, store } = await setup(wrong);
      const created = await runner.create(OWNER, body(creds(bad)));
      await runner.idle();
      const job = (await store.get(created.id))!;
      const us = job.regions.find((r) => r.country === "US")!;
      assert.equal(us.status, "mismatch");
      assert.equal(job.captures.find((c) => c.requestedCountry === "US")!.page.loadState, "not_attempted");
      assert.equal(job.status, "partial");
      // At the wire level: the wrong-country exit only ever served the echo service, never the site.
      const hostsViaUs = wrong.log.filter((e) => e.region === "US" && e.status === 200).map((e) => e.host);
      assert.ok(hostsViaUs.length >= 1 && hostsViaUs.every((h) => h === ECHO_HOST), `US exit contacted: ${hostsViaUs.join(",")}`);
      assert.ok(wrong.log.some((e) => e.region === "GH" && e.host === SHOP_HOST && e.status === 200), "the correct region still loaded the site");
    } finally {
      await wrong.stop();
    }
  });

  it("fails a region whose credentials the gateway rejects, instead of falling back to a direct connection", async () => {
    sim.log.length = 0;
    const { runner, store } = await setup(sim);
    const created = await runner.create(OWNER, body(creds({ GH: TOKENS.GH, US: "tok-wrong-00000000000000009" })));
    await runner.idle();
    const job = (await store.get(created.id))!;
    const us = job.regions.find((r) => r.country === "US")!;
    assert.equal(us.status, "failed");
    assert.equal(us.failure?.code, "egress_probe_failed");
    assert.equal(job.captures.find((c) => c.requestedCountry === "US")!.page.loadState, "not_attempted");
    // Nothing reached the site on behalf of the rejected region (a direct fallback would not appear here at all,
    // so also confirm the page was never read).
    assert.equal(job.captures.find((c) => c.requestedCountry === "US")!.page.visibleText, "");
    assert.equal(job.regions.find((r) => r.country === "GH")!.status, "captured");
  });

  it("marks a region unavailable when no session was provided, without contacting the gateway for it", async () => {
    sim.log.length = 0;
    const { runner, store } = await setup(sim);
    const only = creds();
    const created = await runner.create(OWNER, {
      request: body(only).request,
      credentials: { GH: only.GH },
      unavailable: { US: { code: "session_limit", message: "Your concurrent session limit was reached." } },
    });
    await runner.idle();
    const job = (await store.get(created.id))!;
    const us = job.regions.find((r) => r.country === "US")!;
    assert.equal(us.status, "unavailable");
    assert.equal(us.failure?.code, "session_limit");
    assert.equal(job.captures.some((c) => c.requestedCountry === "US"), false);
    assert.ok(sim.log.every((e) => e.region !== "US"));
  });

  describe("credentials from the user's own marketplace orders", () => {
    const ORDERS = { GH: "6f1c2d3e-0000-4000-8000-00000000a001", US: "6f1c2d3e-0000-4000-8000-00000000a002" };
    const orderCreds = () => ({
      GH: { sessionRef: ORDERS.GH, source: "marketplace_order", username: "order-user-gh", password: TOKENS.GH, declaredCountry: "GH", declaredCountrySource: "ProxyHubb marketplace listing (seller-declared)" },
      US: { sessionRef: ORDERS.US, source: "marketplace_order", username: "order-user-us", password: TOKENS.US, declaredCountry: "US", declaredCountrySource: "ProxyHubb marketplace listing (seller-declared)" },
    });
    const plan = { source: "marketplace_order", orders: ORDERS };

    it("records where the route came from, still verifies the exit itself, and keeps the order ids (not the credentials) for a rerun", async () => {
      sim.target.setScenario("demo-v1");
      const { runner, store } = await setup(sim);
      const created = await runner.create(OWNER, { ...body(creds()), credentials: orderCreds(), sessionPlan: plan });
      await runner.idle();
      const job = (await store.get(created.id))!;

      assert.equal(job.status, "completed");
      assert.deepEqual(job.sessionPlan, plan);
      for (const cap of job.captures) {
        assert.equal(cap.route.sessionSource, "marketplace_order");
        assert.equal(cap.route.assurance, "verified", "an order is not trusted to be in-country: the exit is observed like any other");
        assert.equal(cap.route.declaredCountry.value, cap.requestedCountry);
        assert.match(cap.route.declaredCountry.source, /marketplace listing/);
        assert.equal(cap.route.sessionRef, ORDERS[cap.requestedCountry as "GH" | "US"]);
      }
      const stored = JSON.stringify(job);
      assert.doesNotMatch(stored, new RegExp(TOKENS.GH));
      assert.doesNotMatch(stored, /order-user-gh/);

      // The web server decides what to send on a rerun; the worker records exactly what it is given.
      const again = await runner.rerun(OWNER, job.id, { credentials: orderCreds(), sessionPlan: plan });
      await runner.idle();
      assert.deepEqual((await store.get(again.id))!.sessionPlan, plan);
      const switched = await runner.rerun(OWNER, again.id, { credentials: creds() });
      await runner.idle();
      assert.equal((await store.get(switched.id))!.sessionPlan, null, "a rerun with opened sessions does not claim to use orders");
    });

    it("still refuses to load the site through an order whose exit is in the wrong country", async () => {
      const wrong = await startLiveSim({ regions: { GH: { token: TOKENS.GH, ip: IPS.GH }, US: { token: TOKENS.US, ip: "192.0.2.99" } } });
      try {
        const { runner, store } = await setup(wrong);
        const created = await runner.create(OWNER, { ...body(creds()), credentials: orderCreds(), sessionPlan: plan });
        await runner.idle();
        const job = (await store.get(created.id))!;
        assert.equal(job.regions.find((r) => r.country === "US")!.status, "mismatch");
        assert.equal(job.captures.find((c) => c.requestedCountry === "US")!.page.loadState, "not_attempted");
        assert.equal(wrong.log.some((e) => e.region === "US" && e.host === SHOP_HOST && e.status === 200), false);
      } finally {
        await wrong.stop();
      }
    });

    it("rejects an order plan that names a region the audit does not cover or is not live", async () => {
      const { runner } = await setup(sim);
      await assert.rejects(
        runner.create(OWNER, { ...body(creds()), sessionPlan: { source: "marketplace_order", orders: { DE: "6f1c2d3e-0000-4000-8000-00000000a003" } } }),
        (e: any) => e.code === "invalid_session_plan",
      );
      await assert.rejects(runner.create(OWNER, { ...body(creds()), sessionPlan: { source: "marketplace_order", orders: { GH: "not-a-uuid" } } }));
    });
  });

  it("makes no model call and keeps a clear record when no region has a session", async () => {
    sim.log.length = 0;
    const { runner, store, model } = await setup(sim);
    const none = { code: "session_escrow_required", message: "This deployment requires an escrow-funded session before traffic can flow." };
    const created = await runner.create(OWNER, { request: body(creds()).request, unavailable: { GH: none, US: none } });
    await runner.idle();
    const job = (await store.get(created.id))!;
    assert.equal(model.requests.length, 0, "no plan or analysis call was made");
    assert.equal(job.planUsage.length, 0);
    assert.equal(job.status, "failed");
    assert.equal(job.stages.find((s) => s.name === "plan")!.status, "skipped");
    assert.ok(job.plan, "a default plan is kept so the audit can still be rerun");
    assert.deepEqual(job.regions.map((r) => r.failure?.code), ["session_escrow_required", "session_escrow_required"]);
    assert.equal(sim.log.length, 0, "the gateway was never contacted");
  });

  it("detects a redirect to an unapproved HTTPS host; a gateway allow-list stops it before it connects", async () => {
    const restricted = await startLiveSim({
      regions: { GH: { token: TOKENS.GH, ip: IPS.GH }, US: { token: TOKENS.US, ip: IPS.US } },
      allowedHosts: [SHOP_HOST, ECHO_HOST],
    });
    try {
      const { runner, store } = await setup(restricted);
      const target = `/__redirect?to=${encodeURIComponent("https://evil.example.test/steal")}`;
      const created = await runner.create(OWNER, body(creds(), target));
      await runner.idle();
      const job = (await store.get(created.id))!;
      for (const cap of job.captures) {
        // The worker cannot prevent the redirect; it detects it, stops, and keeps nothing from it.
        assert.ok(cap.policyViolations.some((v) => /evil\.example\.test/.test(v.url)), `${cap.requestedCountry}: violation recorded`);
        assert.equal(cap.page.loadState, "error");
        assert.equal(cap.screenshots.length, 0);
        assert.equal(cap.page.visibleText, "");
      }
      // The gateway allow-list is the preventive control: the request for the unapproved host was refused there.
      assert.ok(restricted.log.some((e) => e.host === "evil.example.test" && e.status === 403), "the gateway refused the unapproved host");
      assert.equal(restricted.log.some((e) => e.host === "evil.example.test" && e.status === 200), false);
    } finally {
      await restricted.stop();
    }
  });
});
