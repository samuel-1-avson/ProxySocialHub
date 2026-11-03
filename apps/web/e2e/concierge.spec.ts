// Session assistant on /dashboard/proxy. The draft route and the control API are mocked at the
// network layer, so these tests are deterministic and need no model. The draft fixtures are built
// with the real checker, so what the card shows is what the server would send.
//
// CONCIERGE_LIVE=1 adds one test that lets the draft request reach the real route on the dev server
// (needs MODEL_API_KEY, and API_URL pointing at a control API whose listings are public).

import AxeBuilder from "@axe-core/playwright";
import { expect as playwrightExpect, test, type Page, type Route } from "@playwright/test";
import { checkDraft } from "../src/lib/concierge-plan";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const expect = playwrightExpect.configure({ timeout: 30_000 });
const MB = 1024 * 1024;

const MARKET = [
  { country: "GH", pricePerGB: 0.89 },
  { country: "GH", pricePerGB: 0.97 },
  { country: "GH", pricePerGB: 1.04 },
  { country: "US", pricePerGB: 2.5 },
];

const DRAFT = {
  session_type: "sticky",
  country: "GH",
  rotation: null,
  rotation_interval_seconds: null,
  max_mb: null,
  time_limit_minutes: null,
  max_price_per_gb: 1,
  budget_usd: 3,
  preferred_tier: null,
  allowed_domains: ["shop.example.com"],
  blocked_domains: [],
  purpose_flag: "ok",
  assumptions: ["Rotation off, because Playwright needs one stable exit."],
  cannot_do: [],
};

const INTENT_ID = "11111111-2222-4333-8444-555555555555";

function draftReply(draft: Record<string, unknown> = DRAFT) {
  return { plan: checkDraft(draft, MARKET), draft, market: MARKET, model: { id: "muse-spark-1.3", dataMode: "standard" } };
}

function intentReply(body: Record<string, unknown>) {
  return {
    token: "e2e-session-intent-token",
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    lifecycle_state: "authorized",
    intent: {
      intent_id: INTENT_ID,
      user_id: "buyer-route-policy-user",
      session_type: body.type,
      trust_tier: "verified",
      bandwidth_limit: body.bandwidth_limit,
      target_geo: body.target_geo,
      allowed_domains: body.allowed_domains ?? [],
      blocked_domains: body.blocked_domains ?? [],
      rotation_type: body.rotation_type,
      time_limit_minutes: body.time_limit_minutes,
      requests_per_minute: 60,
      max_concurrency: 2,
      max_price_per_gb: body.max_price_per_gb,
    },
  };
}

/** Mocks the control API; returns the bodies sent to POST /v1/sessions/intent. */
async function stubControlApi(page: Page): Promise<Record<string, unknown>[]> {
  const created: Record<string, unknown>[] = [];
  let lastIntent: ReturnType<typeof intentReply> | null = null;
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/sessions" && request.method() === "GET") return route.fulfill({ json: { sessions: [] } });
    if (path === "/v1/analytics/overview") return route.fulfill({ json: {} });
    if (path === "/v1/sessions/intent" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      created.push(body);
      lastIntent = intentReply(body);
      return route.fulfill({ json: lastIntent });
    }
    if (path.startsWith("/v1/sessions/intents/") && lastIntent) {
      return route.fulfill({
        json: {
          lifecycle_state: "authorized",
          expires_at: lastIntent.expires_at,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          intent: lastIntent.intent,
        },
      });
    }
    return route.fulfill({ status: 503, json: { error: "Not available in this test" } });
  });
  return created;
}

async function open(page: Page, draftHandler?: (route: Route) => Promise<void>) {
  const created = await stubControlApi(page);
  const drafts: unknown[] = [];
  if (draftHandler) {
    await page.route("**/api/concierge/draft", async (route) => {
      drafts.push(route.request().postDataJSON());
      await draftHandler(route);
    });
  }
  await seedSignedAuth(page, base, "buyer");
  await page.goto(`${base}/dashboard/proxy`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Describe the session you need" })).toBeVisible();
  return { created, drafts };
}

const card = (page: Page) => page.locator("#session-assistant");

test.describe("session assistant", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("drafts a plan, shows the checks and guesses, and creates exactly the approved intent", async ({ page }, info) => {
    const { created, drafts } = await open(page, (route) => route.fulfill({ json: draftReply() }));
    const section = card(page);

    const draftButton = section.getByRole("button", { name: "Draft session" });
    await expect(draftButton).toBeDisabled();
    await section.getByLabel("What do you need?").fill("Sticky Ghana exit for Playwright tests of shop.example.com, under $1/GB, stop at $3.");
    await draftButton.click();

    await expect(section.getByText("Ready to create")).toBeVisible();
    await expect(section.getByText("Sticky (one stable exit)")).toBeVisible();
    await expect(section.getByText("3.00 GB")).toBeVisible();
    await expect(section.getByText("$1.00 per GB")).toBeVisible();
    await expect(section.getByText("shop.example.com", { exact: true })).toBeVisible();
    await expect(section.locator(".concierge-cost strong")).toHaveText("$3.00");
    await expect(section.getByText("2 active listings match.")).toBeVisible();
    await expect(section.getByRole("heading", { name: "The assistant guessed" })).toBeVisible();
    await expect(section.getByText("Rotation off, because Playwright needs one stable exit.")).toBeVisible();
    await expect(section.getByText(/standard mode, your request is not used for training/)).toBeVisible();
    expect(drafts).toEqual([{ request: "Sticky Ghana exit for Playwright tests of shop.example.com, under $1/GB, stop at $3." }]);

    const accessibility = await new AxeBuilder({ page }).include("#session-assistant").analyze();
    expect(accessibility.violations.map((v) => v.id)).toEqual([]);
    await section.screenshot({ path: info.outputPath("concierge-plan.png") });

    await section.getByRole("button", { name: "Create session" }).click();
    await expect(page.getByText("Intent Authorized")).toBeVisible();
    expect(created).toEqual([
      {
        type: "sticky",
        bandwidth_limit: 3072 * MB,
        time_limit_minutes: 20,
        rotation_type: "none",
        target_geo: "GH",
        max_price_per_gb: 1,
        allowed_domains: ["shop.example.com"],
      },
    ]);
  });

  test("a blocked plan cannot be created until an edit fixes it, and edits are re-checked", async ({ page }) => {
    const { created } = await open(page, (route) => route.fulfill({ json: draftReply({ ...DRAFT, country: "NG", budget_usd: null, max_price_per_gb: null }) }));
    const section = card(page);
    await section.getByLabel("What do you need?").fill("Nigeria exit please");
    await section.getByRole("button", { name: "Draft session" }).click();

    await expect(section.getByText("Needs a change before it can be created")).toBeVisible();
    await expect(section.getByText(/No active listings in NG right now/)).toBeVisible();
    const createButton = section.getByRole("button", { name: "Create session" });
    await expect(createButton).toBeDisabled();

    await section.getByText("Change values").click();
    await section.getByLabel("Country (two letters, empty for any)").fill("GH");
    await expect(section.getByText("Ready to create")).toBeVisible();
    await expect(section.getByText("$1.04 per GB")).toBeVisible();
    await createButton.click();
    await expect(page.getByText("Intent Authorized")).toBeVisible();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ target_geo: "GH", max_price_per_gb: 1.04 });
  });

  test("an abusive request is refused and nothing can be created", async ({ page }) => {
    await open(page, (route) => route.fulfill({ json: draftReply({ ...DRAFT, purpose_flag: "abusive" }) }));
    const section = card(page);
    await section.getByLabel("What do you need?").fill("rotate exits for credential stuffing");
    await section.getByRole("button", { name: "Draft session" }).click();
    await expect(section.getByText(/Nothing will be created/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Create session" })).toBeDisabled();
  });

  test("when the assistant is unavailable it says so, and Quick Start still works", async ({ page }) => {
    await open(page, (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "model_unavailable", message: "The model did not answer within 30s. Fill in the session form yourself." } },
      }),
    );
    const section = card(page);
    await section.getByLabel("What do you need?").fill("sticky Ghana");
    await section.getByRole("button", { name: "Draft session" }).click();
    await expect(section.getByRole("alert")).toContainText("Fill in the session form yourself");
    await expect(page.getByRole("button", { name: /Rotating Stream/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Sticky Core/ })).toBeEnabled();
  });

  test("has no horizontal scroll at phone width", async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, (route) => route.fulfill({ json: draftReply() }));
    const section = card(page);
    await section.getByLabel("What do you need?").fill("Sticky Ghana exit");
    await section.getByRole("button", { name: "Draft session" }).click();
    await expect(section.getByText("Ready to create")).toBeVisible();
    await section.getByText("Change values").click();
    const box = await section.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await section.screenshot({ path: info.outputPath("concierge-phone.png") });
  });
});

test.describe("session assistant against the real route", () => {
  test.skip(process.env.CONCIERGE_LIVE !== "1", "set CONCIERGE_LIVE=1 to call the real route and model");
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the real route drafts a checked plan from real listings", async ({ page }, info) => {
    await open(page);
    const section = card(page);
    await section.getByLabel("What do you need?").fill("Sticky exit in Ghana for Playwright tests of shop.example.com (my own store). Under $1.10 per GB, stop at $2.");
    await section.getByRole("button", { name: "Draft session" }).click();
    await expect(section.getByText(/Ready to create|Needs a change before it can be created/)).toBeVisible({ timeout: 60_000 });
    await section.screenshot({ path: info.outputPath("concierge-live.png") });
  });
});
