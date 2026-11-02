// Regional Auditor UI: deterministic states with the audit API mocked at the network layer.
// The full stack (real worker, real browser captures, real model) is exercised by
// audits-fullstack.spec.ts, which needs the worker running.

import AxeBuilder from "@axe-core/playwright";
import { devices, expect as playwrightExpect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const expect = playwrightExpect.configure({ timeout: 30_000 });

// 1x1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const AUD = "aud_0123456789ab";
const PREV = "aud_aaaaaaaaaaaa";

// Loosely shaped API fixtures: nested objects are spread and overridden freely, which `unknown` would not allow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function capture(country: string, over: Json = {}): Json {
  const ev = `ev-01234567-${country}`;
  return {
    evidenceId: ev,
    requestedCountry: country,
    origin: "synthetic_fixture",
    capturedAt: "2026-11-01T10:00:00.000Z",
    route: {
      sessionRef: "fixture-…",
      transport: "fixture_proxy",
      declaredCountry: { value: country, source: "fixture harness (synthetic declaration)", observedAt: "2026-11-01T10:00:00.000Z" },
      observedEgressIp: country === "GH" ? "198.51.100.23" : "203.0.113.45",
      egressObservations: [
        { phase: "before", ip: "198.51.100.23", at: "2026-11-01T10:00:00.000Z", elapsedMs: 12, error: null },
        { phase: "after", ip: "198.51.100.23", at: "2026-11-01T10:00:02.000Z", elapsedMs: 9, error: null },
      ],
      geoip: { country, source: "fixture-static-table (synthetic, not a real lookup)", lookedUpAt: "2026-11-01T10:00:00.000Z", note: null },
      assurance: "verified",
      assuranceReason: `GeoIP estimate (${country}) and the provider-declared country agree with the request.`,
    },
    browser: { profileId: "desktop-chromium-1280x800", viewport: { width: 1280, height: 800 }, locale: "en-US", timezoneId: "UTC", userAgent: "ua", browserVersion: "143.0.7499.4" },
    page: { requestedUrl: "http://127.0.0.1:4031/", finalUrl: "http://127.0.0.1:4031/", redirectChain: [], mainDocumentStatus: 200, title: "Acme Cloud - Team storage", loadState: "load", navigationError: null },
    screenshots: [{ artifactId: `${ev}-initial.png`, label: "initial", width: 1280, height: 800, bytes: 1000, sha256: "a".repeat(64) }],
    failedRequests: [],
    blockedRequests: [],
    consoleErrors: [],
    timings: { navigationWallMs: 31, domContentLoadedMs: 27, loadEventMs: 33, totalCaptureMs: 1900 },
    timingNotes: "n",
    checks: [{ checkId: "c1", action: "find_control", status: "ok", detail: "The button is visible but covered.", data: { obscured: true }, elapsedMs: 5 }],
    limits: { requestCount: 4, approxBytes: 4000, truncated: false },
    ...over,
  };
}

function finding(over: Json = {}): Json {
  return {
    id: "f1",
    expectationId: "e1",
    kind: "element_obscured",
    classification: "observed_defect",
    severity: "high",
    regions: ["GH"],
    summary: "The Sign up button is covered by a cookie banner in Ghana",
    observed: "A banner sits on top of the Sign up button.",
    expected: "Sign up is clickable.",
    evidenceIds: ["ev-01234567-GH"],
    location: { evidenceId: "ev-01234567-GH", screenshot: "initial", description: "bottom of the page", checkId: "c1" },
    reproduction: ["Open the page from Ghana", "Try to click Sign up"],
    nextAction: "Make the banner dismissible or move it.",
    uncertainty: "Directly observed in one viewport; the banner may be dismissible.",
    ...over,
  };
}

function audit(over: Json = {}): Json {
  return {
    schemaVersion: 1,
    id: AUD,
    request: { targetUrl: "http://127.0.0.1:4031/", regions: ["GH", "US"], expectations: "Check that signup is usable and the currency is right.", mode: "fixture", browserProfile: { id: "desktop-chromium-1280x800", viewport: { width: 1280, height: 800 }, locale: "en-US", timezoneId: "UTC" } },
    mode: "fixture",
    evidenceOrigin: "synthetic_fixture",
    previousAuditId: null,
    replayOfAuditId: null,
    status: "completed",
    createdAt: "2026-11-01T10:00:00.000Z",
    startedAt: "2026-11-01T10:00:00.000Z",
    completedAt: "2026-11-01T10:00:20.000Z",
    cancelRequestedAt: null,
    stages: [
      { name: "plan", status: "completed", startedAt: null, completedAt: null, message: null },
      { name: "capture", status: "completed", startedAt: null, completedAt: null, message: null },
      { name: "analysis", status: "completed", startedAt: null, completedAt: null, message: null },
    ],
    plan: { source: "model", note: null, expectations: [{ id: "e1", text: "Signup is usable", checkIds: ["c1"] }], checks: [{ id: "c1", action: "find_control", text: null, role: null, name: "Sign up" }] },
    regions: [
      { country: "GH", status: "captured", startedAt: null, completedAt: null, evidenceId: "ev-01234567-GH", assurance: "verified", failure: null },
      { country: "US", status: "captured", startedAt: null, completedAt: null, evidenceId: "ev-01234567-US", assurance: "verified", failure: null },
    ],
    captures: [capture("GH"), capture("US")],
    analysis: {
      status: "completed",
      failure: null,
      model: { provider: "meta", id: "muse-spark-1.3", dataMode: "standard" },
      startedAt: "2026-11-01T10:00:10.000Z",
      completedAt: "2026-11-01T10:00:20.000Z",
      evidenceOrigins: ["synthetic_fixture"],
      expectationResults: [{ expectationId: "e1", status: "not_met", regions: ["GH"], rationale: "Sign up is covered in GH." }],
      findings: [finding()],
      limitations: ["Both evidences are synthetic fixtures."],
      validation: { droppedFindings: [], adjustedFindings: [] },
      usage: { calls: [{ stage: "plan", model: "muse-spark-1.3", inputTokens: 600, outputTokens: 1400, latencyMs: 6000, outcome: "ok" }, { stage: "analyze", model: "muse-spark-1.3", inputTokens: 6000, outputTokens: 2100, latencyMs: 10000, outcome: "ok" }], totalInputTokens: 6600, totalOutputTokens: 3500, costEstimate: { usd: 0.0231, label: "estimate", priceSource: "test price list" } },
      attempts: 1,
    },
    comparison: null,
    failure: null,
    limitations: ["Synthetic fixture: evidence comes from a local demo site.", "The country shown for an exit is a GeoIP estimate."],
    ...over,
  };
}

const caps = (over: Json = {}): Json => ({
  auditor: {
    modes: {
      live: { available: false, missing: ["AUDITOR_PROXY_ENDPOINT", "AUDITOR_ALLOWED_TARGET_ORIGINS"], allowedTargetOrigins: [] },
      fixture: { available: true, missing: [], targetUrl: "http://127.0.0.1:4031/", regions: ["GH", "US", "DE"], scenario: "demo-v1" },
      replay: { available: true },
    },
    ai: { provider: "meta", configured: true, model: "muse-spark-1.3", dataMode: "standard" },
    limits: { maxRegions: 2, maxChecks: 6, jobTimeoutSeconds: 240 },
    geoip: "ipwhois",
  },
  auditorProblem: null,
  listingRegions: { available: false, regions: [], source: "Active marketplace listings (provider-declared countries)", message: "The marketplace could not be reached, so the live region list is unavailable." },
  ...over,
});

interface Mock {
  audits: Json[];
  detail: Json | ((n: number) => Json);
  polls: number;
  posts: Array<{ url: string; body: unknown }>;
  caps: Json;
  /** The caller's active marketplace orders, or "error" to make listing them fail. */
  orders: Json[] | "error";
  /** How many other (not active) orders the account holds, by status. */
  otherStatuses?: Record<string, number>;
}

async function mockApi(page: Page, m: Mock) {
  await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Not available in this test" } }));
  await page.route("**/api/audits**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === "POST") m.posts.push({ url: p, body: req.postDataJSON() });
    if (p.endsWith("/capabilities")) return route.fulfill({ json: m.caps });
    if (p.endsWith("/audits/orders")) {
      return m.orders === "error"
        ? route.fulfill({ status: 503, json: { error: { code: "control_api_unreachable", message: "The ProxyHubb control API could not be reached to list your orders." } } })
        : route.fulfill({ json: { orders: m.orders, otherStatuses: m.otherStatuses ?? {}, source: "Your active ProxyHubb marketplace orders" } });
    }
    if (p.endsWith("/fixture/scenario")) return route.fulfill({ json: { current: "demo-v1", scenarios: [{ id: "demo-v1", title: "v1" }, { id: "demo-v2", title: "v2" }] } });
    if (p.includes("/artifacts/")) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    if (p.endsWith("/export")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    if (/\/api\/audits\/aud_[0-9a-f]{12}\/(cancel|rerun|replay|retry-analysis)$/.test(p)) {
      const detail = typeof m.detail === "function" ? m.detail(m.polls) : m.detail;
      return route.fulfill({ status: 202, json: { audit: { ...detail, id: p.endsWith("rerun") ? "aud_bbbbbbbbbbbb" : detail.id } } });
    }
    if (/\/api\/audits\/aud_[0-9a-f]{12}$/.test(p)) {
      m.polls += 1;
      return route.fulfill({ json: { audit: typeof m.detail === "function" ? m.detail(m.polls) : m.detail } });
    }
    if (p === "/api/audits" && req.method() === "POST") return route.fulfill({ status: 202, json: { audit: audit({ status: "queued" }) } });
    if (p === "/api/audits") return route.fulfill({ json: { audits: m.audits } });
    return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not found." } } });
  });
}

const summary = (over: Json = {}): Json => ({
  id: AUD, targetUrl: "http://127.0.0.1:4031/", regions: ["GH", "US"], mode: "fixture", evidenceOrigin: "synthetic_fixture", status: "completed",
  createdAt: "2026-11-01T10:00:00.000Z", completedAt: "2026-11-01T10:00:20.000Z", previousAuditId: null, analysisStatus: "completed", findingCount: 1,
  regionStatuses: [{ country: "GH", status: "captured" }, { country: "US", status: "captured" }], ...over,
});

async function setup(page: Page, over: Partial<Mock> = {}): Promise<Mock> {
  const m: Mock = { audits: [summary()], detail: audit(), polls: 0, posts: [], caps: caps(), orders: [], ...over };
  await mockApi(page, m);
  await seedSignedAuth(page, base, "both");
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal, .tsqd-parent-container { display: none !important; }";
      document.head.appendChild(s);
    });
  });
  return m;
}

test.describe("regional audits: create", () => {
  test.setTimeout(150_000);

  test("lists past audits with their evidence mode, and says why live is unavailable", async ({ page }) => {
    await setup(page);
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/app\/connections\?tab=audits/);
    await expect(page.getByRole("heading", { name: "Connections", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Audits", exact: true })).toHaveAttribute("aria-current", "page");
    const row = page.getByRole("row", { name: /127\.0\.0\.1:4031/ });
    await expect(row).toContainText("Synthetic fixture");
    await expect(row).toContainText("Completed");
    const live = page.getByRole("radio", { name: /^Live/ });
    await expect(live).toBeDisabled();
    await expect(page.getByText(/AUDITOR_PROXY_ENDPOINT/)).toBeVisible();
    await expect(page.getByRole("radio", { name: /Synthetic fixture/ })).toBeChecked();
  });

  test("shows only regions that can actually be requested and validates before submitting", async ({ page }) => {
    const m = await setup(page, { audits: [] });
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("No audits yet")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await page.getByRole("textbox", { name: "What should be true?" }).fill("short");
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Choose at least one region" })).toBeVisible();
    expect(m.posts).toHaveLength(0);

    await page.getByRole("checkbox", { name: /Ghana/ }).check();
    await page.getByRole("checkbox", { name: /United States/ }).check();
    await expect(page.getByRole("checkbox", { name: /Germany/ })).toBeDisabled(); // the configured maximum is two
    await page.getByRole("textbox", { name: "What should be true?" }).fill("Check that signup is usable in both regions.");
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page).toHaveURL(/\/app\/audits\/aud_[0-9a-f]{12}$/);
    expect(m.posts[0]!.body).toEqual({ targetUrl: "http://127.0.0.1:4031/", regions: ["GH", "US"], expectations: "Check that signup is usable in both regions.", mode: "fixture" });
  });

  test("is completable from the keyboard", async ({ page }) => {
    const m = await setup(page, { audits: [] });
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    const region = page.getByRole("checkbox", { name: /Ghana/ });
    await region.focus();
    await page.keyboard.press("Space");
    await expect(region).toBeChecked();
    await page.getByRole("textbox", { name: "What should be true?" }).focus();
    await page.getByRole("textbox", { name: "What should be true?" }).fill("Check that signup is usable for customers.");
    await page.getByRole("button", { name: "Run audit" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/audits\/aud_/);
    expect(m.posts).toHaveLength(1);
  });

  test("reports an unreachable auditor instead of pretending audits can run", async ({ page }) => {
    await setup(page, { caps: caps({ auditor: null, auditorProblem: { code: "auditor_unreachable", message: "The Regional Auditor service could not be reached." } }) });
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert").filter({ hasText: "service is unavailable" });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("nothing has been simulated");
    await expect(page.getByRole("button", { name: "Run audit" })).toHaveCount(0);
  });
});

const liveCaps = (): Json =>
  caps({
    auditor: {
      ...caps().auditor,
      modes: {
        live: { available: true, missing: [], allowedTargetOrigins: ["https://shop.example.test"], proxyEndpoint: "proxy.example.test:8090" },
        fixture: { available: false, missing: ["AUDITOR_FIXTURE_ENABLED"], targetUrl: null, regions: [], scenario: null },
        replay: { available: true },
      },
    },
    listingRegions: { available: true, regions: [{ code: "GH", listings: 2 }, { code: "US", listings: 1 }], source: "Active marketplace listings (provider-declared countries)" },
  });
const ORDER_GH = "6f1c2d3e-0000-4000-8000-00000000a001";
const ORDER_GH_2 = "6f1c2d3e-0000-4000-8000-00000000a004";
const ORDER_US = "6f1c2d3e-0000-4000-8000-00000000a002";
const orderOption = (id: string, country: string | null, over: Json = {}): Json => ({
  id, country, title: `${country ?? "Unlabelled"} residential`, city: country === "GH" ? "Accra" : null, isp: "Example ISP", bandwidthGb: 0.5, createdAt: "2026-11-02T08:00:00Z", ...over,
});

/** Stand-in for the control API's order endpoints (list, one order, its credentials). */
async function mockOrders(page: Page, ids: string[]) {
  const order = (id: string): Json => ({
    id, buyer_id: "b", seller_id: "s", listing_id: "l", bandwidth_gb: 0.5, status: "active", created_at: "2026-11-02T08:00:00Z",
    listing: { title: "GH residential" }, escrow_status: "released",
  });
  await page.route("**/v1/orders**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/v1/orders") return route.fulfill({ json: { orders: ids.map(order) } });
    const m = /^\/v1\/orders\/([^/]+)(\/credentials)?$/.exec(p);
    if (!m || !ids.includes(m[1]!)) return route.fulfill({ status: 404, json: { error: "Order not found" } });
    return route.fulfill({ json: m[2] ? { proxy_credentials: { username: "sess-user", password: "hmac-pass-x", endpoint: "proxy.example.test:8090", host: "proxy.example.test", port: 8090 } } : order(m[1]!) });
  });
}

test.describe("regional audits: inside the existing workspace", () => {
  test.setTimeout(150_000);

  test("the old address lands on the Audits tab of Connections, which is a tab and not a destination of its own", async ({ page }) => {
    await setup(page);
    await page.goto(`${base}/app/audits`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/app\/connections\?tab=audits/);
    const tabs = page.getByRole("navigation", { name: "Connection views" });
    await expect(tabs.getByRole("link")).toHaveText(["Access", "Sessions", "Audits"]);
  });

  test("shows no Audits tab where the Regional Auditor is not deployed", async ({ page }) => {
    await setup(page, { caps: caps({ auditor: null, auditorProblem: { code: "auditor_not_configured", message: "The Regional Auditor service is not configured on this server (AUDITOR_SERVICE_SECRET)." } }) });
    await mockOrders(page, [ORDER_GH]);
    const answered = page.waitForResponse((r) => r.url().includes("/api/audits/capabilities"));
    await page.goto(`${base}/app/connections`, { waitUntil: "domcontentloaded" });
    await answered;
    const tabs = page.getByRole("navigation", { name: "Connection views" });
    await expect(tabs.getByRole("link")).toHaveText(["Access", "Sessions"]);
    await expect(page.getByRole("button", { name: /Audit a site/ })).toHaveCount(0);
  });

  test("an active order offers an audit of its own region on its own page, and runs it from a dialog", async ({ page }) => {
    const m = await setup(page, { caps: liveCaps(), orders: [orderOption(ORDER_GH, "GH")] });
    await mockOrders(page, [ORDER_GH]);
    await page.goto(`${base}/marketplace/orders/${ORDER_GH}`, { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("audit-launch-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Check a website from Ghana (GH)");
    await card.getByRole("button", { name: /Audit a site/ }).click();

    const dialog = page.getByRole("dialog", { name: /Audit a site from Ghana \(GH\)/ });
    await expect(dialog).toBeVisible();
    // Region and order are already decided: only the address and the expectations are asked.
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByLabel("Where this audit runs")).toContainText("Ghana (GH)");
    await expect(dialog.getByLabel("Where this audit runs")).toContainText(`order ${ORDER_GH.slice(0, 8)}`);

    await dialog.getByRole("button", { name: "Run audit" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "Enter the HTTPS address" })).toBeVisible();
    expect(m.posts).toHaveLength(0);

    await dialog.getByRole("textbox", { name: "Website address" }).fill("https://shop.example.test/");
    await dialog.getByRole("button", { name: "Run audit" }).click();
    await expect(page).toHaveURL(/\/app\/audits\/aud_[0-9a-f]{12}$/);
    expect(m.posts[0]!.body).toEqual({
      targetUrl: "https://shop.example.test/",
      regions: ["GH"],
      expectations: "Check that the page loads, signup is usable and prices are shown in the expected currency.",
      mode: "live",
      sessionSource: "order",
      orders: { GH: ORDER_GH },
    });
  });

  test("offers nothing on an order that cannot carry an audit, or where live audits are not configured", async ({ page }) => {
    // Live is configured, but this order is not one of the user's active, audit-able orders.
    await setup(page, { caps: liveCaps(), orders: [orderOption(ORDER_US, "US")] });
    await mockOrders(page, [ORDER_GH]);
    const listed = page.waitForResponse((r) => r.url().includes("/api/audits/orders"));
    await page.goto(`${base}/marketplace/orders/${ORDER_GH}`, { waitUntil: "domcontentloaded" });
    await listed;
    await expect(page.getByText("Order receipt")).toBeVisible();
    await expect(page.getByTestId("audit-launch-card")).toHaveCount(0);
  });

  test("an order card in Connections has the same shortcut", async ({ page }) => {
    const m = await setup(page, { caps: liveCaps(), orders: [orderOption(ORDER_GH, "GH")] });
    await mockOrders(page, [ORDER_GH]);
    await page.goto(`${base}/app/connections`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Audit a site/ }).click();
    const dialog = page.getByRole("dialog", { name: /Audit a site from Ghana/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(m.posts).toHaveLength(0);
  });
});

test.describe("regional audits: running over my own orders", () => {
  test.setTimeout(150_000);

  test("offers only regions I hold an active order for, and sends the chosen orders (never a credential)", async ({ page }) => {
    const m = await setup(page, {
      audits: [],
      caps: liveCaps(),
      orders: [orderOption(ORDER_GH, "GH"), orderOption(ORDER_GH_2, "GH", { title: "GH mobile", isp: "MTN Ghana" }), orderOption(ORDER_US, "US"), orderOption("6f1c2d3e-0000-4000-8000-00000000a005", null)],
    });
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Website address" }).fill("https://shop.example.test/");

    // My funded orders are the default, because a new session cannot carry traffic on an escrow-required deployment.
    await expect(page.getByRole("radio", { name: /Use my funded orders/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Ghana.*2 active orders/ })).toBeVisible();

    // Choosing new sessions instead offers the marketplace's regions, not mine.
    await page.getByRole("radio", { name: /Open new sessions/ }).check();
    await expect(page.getByRole("checkbox", { name: /Ghana.*2 active listings/ })).toBeVisible();
    await page.getByRole("radio", { name: /Use my funded orders/ }).check();
    await expect(page.getByRole("checkbox", { name: /Ghana.*2 active orders/ })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /United States.*1 active order\b/ })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(2); // nothing the user holds no order for
    await expect(page.getByText(/1 without a declared country is not offered/)).toBeVisible();

    await page.getByRole("checkbox", { name: /Ghana/ }).check();
    await page.getByRole("checkbox", { name: /United States/ }).check();
    const ghOrder = page.getByLabel(/Order for Ghana/);
    await expect(ghOrder).toHaveValue(ORDER_GH); // first order is preselected
    await ghOrder.selectOption(ORDER_GH_2);
    await expect(page.getByLabel(/Order for United States/)).toHaveValue(ORDER_US);

    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page).toHaveURL(/\/app\/audits\/aud_[0-9a-f]{12}$/);
    expect(m.posts[0]!.body).toEqual({
      targetUrl: "https://shop.example.test/",
      regions: ["GH", "US"],
      expectations: "Check that signup is usable and that the expected currency is displayed for customers in Ghana and the US.",
      mode: "live",
      sessionSource: "order",
      orders: { GH: ORDER_GH_2, US: ORDER_US },
    });
    expect(JSON.stringify(m.posts[0]!.body)).not.toMatch(/password|token|credential/i);
  });

  test("says what to do when I hold no active order, and does not start anything", async ({ page }) => {
    const m = await setup(page, { audits: [], caps: liveCaps(), orders: [], otherStatuses: { pending_payment: 2 } });
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Website address" }).fill("https://shop.example.test/");
    await page.getByRole("radio", { name: /Use my funded orders/ }).check();
    await expect(page.getByText(/no active marketplace order with a declared country/).first()).toBeVisible();
    await expect(page.getByText(/This account has 2 other orders that are not active/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Buy bandwidth in the marketplace/ })).toHaveAttribute("href", "/marketplace");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "no active marketplace order" })).toBeVisible();
    expect(m.posts).toHaveLength(0);
  });

  test("reports when my orders cannot be loaded instead of offering regions it cannot use", async ({ page }) => {
    const m = await setup(page, { audits: [], caps: liveCaps(), orders: "error" });
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Website address" }).fill("https://shop.example.test/");
    await page.getByRole("radio", { name: /Use my funded orders/ }).check();
    await expect(page.getByText("Your orders could not be loaded")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "could not be loaded, so this audit cannot use them" })).toBeVisible();
    expect(m.posts).toHaveLength(0);
  });

  test("an audit that ran over my orders says so, and a rerun is described honestly", async ({ page }) => {
    const gh = capture("GH", { origin: "live_capture" });
    gh.route = { ...gh.route, transport: "proxyhubb_gateway", sessionRef: "6f1c2d3e…", sessionSource: "marketplace_order" };
    await setup(page, {
      detail: audit({
        mode: "live",
        evidenceOrigin: "live_capture",
        request: { ...audit().request, mode: "live", regions: ["GH"] },
        regions: [{ country: "GH", status: "captured", startedAt: null, completedAt: null, evidenceId: "ev-01234567-GH", assurance: "verified", failure: null }],
        captures: [gh],
        sessionPlan: { source: "marketplace_order", orders: { GH: ORDER_GH } },
      }),
    });
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/your marketplace order 6f1c2d3e…/)).toBeVisible();
    await expect(page.getByText("Rerun uses the same orders again and draws on their bandwidth.")).toBeVisible();
  });
});

test.describe("regional audits: results", () => {
  test.setTimeout(150_000);

  test("keeps the evidence mode, route provenance and findings together", async ({ page }) => {
    await setup(page);
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "127.0.0.1:4031", level: 1 })).toBeVisible();
    await expect(page.getByRole("note").filter({ hasText: "Synthetic fixture: not a real regional capture" })).toBeVisible();

    const gh = page.getByRole("article", { name: /Ghana/ });
    await expect(gh).toContainText("198.51.100.23");
    await expect(gh).toContainText("fixture-static-table (synthetic, not a real lookup)");
    await expect(gh).toContainText("An estimate for the IP, not proof of physical location");
    await expect(gh.getByRole("img", { name: /Screenshot: Ghana \(GH\), initial view/ })).toBeVisible();
    await expect(page.getByRole("article", { name: /United States/ })).toContainText("Verified and captured");

    const f = page.locator("ul.audit-findings > li"); // direct findings only, not the nested reproduction steps
    await expect(f).toHaveCount(1);
    await expect(f).toContainText("Observed defect");
    await expect(f).toContainText("Uncertainty:");
    await f.getByRole("link", { name: "ev-01234567-GH" }).click();
    await expect(page).toHaveURL(/#region-GH$/);
    await expect(page.getByText(/Provider-reported usage: 6,600 input and 3,500 output tokens/)).toContainText("estimated cost $0.0231 (estimate from test price list)");
  });

  test("opens a screenshot in a dialog that returns focus when closed with Escape", async ({ page }) => {
    await setup(page);
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    const trigger = page.getByRole("button", { name: /Enlarge screenshot: Ghana/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("never presents a wrong-region or failed region as a result", async ({ page }) => {
    const us = capture("US", {
      page: { requestedUrl: "http://127.0.0.1:4031/", finalUrl: null, redirectChain: [], mainDocumentStatus: null, title: null, loadState: "not_attempted", navigationError: "Capture not attempted: mismatch" },
      screenshots: [],
      checks: [],
      route: { ...capture("US").route, observedEgressIp: "198.51.100.23", assurance: "mismatch", assuranceReason: "The observed egress IP geolocates to GH, not the requested US.", geoip: { country: "GH", source: "ipwho.is (GeoIP estimate)", lookedUpAt: "2026-11-01T10:00:00.000Z", note: null } },
    });
    await setup(page, {
      detail: audit({
        status: "partial",
        regions: [
          { country: "GH", status: "captured", startedAt: null, completedAt: null, evidenceId: "ev-01234567-GH", assurance: "verified", failure: null },
          { country: "US", status: "mismatch", startedAt: null, completedAt: null, evidenceId: "ev-01234567-US", assurance: "mismatch", failure: { code: "region_mismatch", message: "The observed egress IP geolocates to GH, not the requested US." } },
        ],
        captures: [capture("GH"), us],
        limitations: ["US: not interpreted (mismatch). The observed egress IP geolocates to GH, not the requested US."],
      }),
    });
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Partial: some evidence is missing")).toBeVisible();
    const card = page.getByRole("article", { name: /United States/ });
    await expect(card.getByRole("alert")).toContainText("Not interpreted.");
    await expect(card).toContainText("Wrong region: not interpreted");
    await expect(card.getByRole("img")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Findings" }).getByText(/United States|\bUS\b/)).toHaveCount(0);
  });

  test("shows 'AI analysis not run' without implying a clean result", async ({ page }) => {
    await setup(page, {
      detail: audit({
        analysis: { ...audit().analysis, status: "not_run", findings: [], failure: { code: "missing_key", message: "AI analysis not run: MODEL_API_KEY is not configured on the auditor service.", retryable: false, attempts: 0 }, model: null, usage: { calls: [], totalInputTokens: 0, totalOutputTokens: 0, costEstimate: null } },
        limitations: ["AI analysis not run."],
      }),
    });
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    const note = page.getByRole("status").filter({ hasText: "AI analysis not run." });
    await expect(note).toContainText("no findings are implied");
    await expect(page.getByText("No findings were reported")).toHaveCount(0);
  });

  test("keeps evidence when the model fails and offers a retry that does not recapture", async ({ page }) => {
    const m = await setup(page, {
      detail: audit({
        status: "partial",
        analysis: { ...audit().analysis, status: "failed", findings: [], failure: { code: "rate_limited", message: "The model API rate limit was reached.", retryable: true, attempts: 1 } },
      }),
    });
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert").filter({ hasText: "The AI analysis failed" })).toContainText("Your evidence was kept");
    await expect(page.getByRole("img", { name: /Ghana/ })).toBeVisible();
    await page.getByRole("button", { name: "Retry AI analysis" }).click();
    await expect.poll(() => m.posts.some((p) => p.url.endsWith("/retry-analysis"))).toBe(true);
  });

  test("shows progress for a running audit and offers cancel", async ({ page }) => {
    const m = await setup(page, {
      detail: (n) =>
        n < 3
          ? audit({
              status: "running",
              completedAt: null,
              stages: [
                { name: "plan", status: "completed", startedAt: null, completedAt: null, message: null },
                { name: "capture", status: "running", startedAt: null, completedAt: null, message: null },
                { name: "analysis", status: "pending", startedAt: null, completedAt: null, message: null },
              ],
              regions: [
                { country: "GH", status: "running", startedAt: null, completedAt: null, evidenceId: null, assurance: null, failure: null },
                { country: "US", status: "pending", startedAt: null, completedAt: null, evidenceId: null, assurance: null, failure: null },
              ],
              captures: [],
              analysis: { ...audit().analysis, status: "not_run", findings: [] },
            })
          : audit(),
    });
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("status").filter({ hasText: "Running" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Audit stages" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("article", { name: /Ghana/ })).toContainText("Capturing this region");
    await expect(page.getByRole("button", { name: "Cancel audit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rerun and compare" })).toHaveCount(0);
    // It polls and settles without a reload.
    await expect(page.getByRole("status").filter({ hasText: "Completed" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Cancel audit" })).toHaveCount(0);
    expect(m.polls).toBeGreaterThanOrEqual(3);
  });

  test("reruns and shows resolved, persisting, new and incomparable findings", async ({ page }) => {
    const items = [
      { status: "resolved", key: "e1|element_obscured|GH", summary: "Sign up was covered in Ghana", currentFindingId: null, previousFindingId: "f1", regions: ["GH"], note: "Not reported in the current run." },
      { status: "persisting", key: "e2|currency_mismatch|US", summary: "US shows GHS", currentFindingId: "f1", previousFindingId: "f2", regions: ["US"], note: null },
      { status: "new", key: "e1|asset_failed|US", summary: "pricing.js fails", currentFindingId: "f2", previousFindingId: null, regions: ["US"], note: null },
      { status: "incomparable", key: "region|DE", summary: "DE was not verified in the current run.", currentFindingId: null, previousFindingId: null, regions: ["DE"], note: "A region without verified evidence is never counted as fixed." },
    ];
    await setup(page, { detail: audit({ previousAuditId: PREV, comparison: { previousAuditId: PREV, comparedAt: "2026-11-01T11:00:00.000Z", items, caveats: ["Screenshots are compared by findings, not pixel alignment."] } }) });
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    const panel = page.getByRole("region", { name: "Compared with the previous run" });
    for (const label of ["Resolved (1)", "Still present (1)", "New (1)", "Cannot be compared (1)"]) await expect(panel).toContainText(label);
    await expect(panel).toContainText("never counted as fixed");
    await expect(panel.getByRole("link", { name: "Open the previous audit" })).toHaveAttribute("href", `/app/audits/${PREV}`);
  });

  test("exports sanitized data from the page", async ({ page }) => {
    await setup(page);
    await page.goto(`${base}/app/audits/${AUD}`, { waitUntil: "domcontentloaded" });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Data (JSON)" }).click();
    expect((await download).suggestedFilename()).toBe(`regional-audit-${AUD}.json`);
  });

  test("reports a missing or foreign audit as not found, not as an empty report", async ({ page }) => {
    await setup(page);
    await page.route("**/api/audits/aud_ffffffffffff", (route) => route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Audit not found." } } }));
    await page.goto(`${base}/app/audits/aud_ffffffffffff`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert").filter({ hasText: "This audit could not be loaded" })).toContainText("Audit not found.");
  });
});

test.describe("regional audits: accessibility and mobile", () => {
  test.setTimeout(180_000);

  for (const [name, path] of [["create page", "/app/connections?tab=audits"], ["results page", `/app/audits/${AUD}`]] as const) {
    test(`${name} has no detectable WCAG A/AA violations`, async ({ page }) => {
      await setup(page);
      await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const results = await new AxeBuilder({ page }).include("#main-content").withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    });
  }

  test.describe("small phone", () => {
    // A preset minus defaultBrowserType (which Playwright only allows at file level).
    test.use({ viewport: devices["Pixel 5"].viewport, userAgent: devices["Pixel 5"].userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor });
    test("has no horizontal scroll and keeps controls reachable", async ({ page }) => {
      await setup(page);
      for (const path of ["/app/connections?tab=audits", `/app/audits/${AUD}`]) {
        await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle").catch(() => undefined);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      }
      await expect(page.getByRole("article", { name: /Ghana/ })).toBeVisible();
      const box = await page.getByRole("button", { name: "Data (JSON)" }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(40);
    });
  });
});
