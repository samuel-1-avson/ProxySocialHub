import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => {
  await page.route("**/v1/notifications/unread-count", (route) => route.fulfill({ json: { count: 0 } }));
  await page.route("**/v1/ws/ticket", (route) => route.fulfill({ status: 401, json: { error: "Realtime not part of this test" } }));
});
const reply = {
  mode: "ai", content: "Your recent order is **active**. Open the order to review its connection details.",
  steps: [{ label: "Read your recent orders (1)", ok: true }],
  sources: [{ title: "Review your orders", href: "/marketplace/orders" }],
};
const scope = (page: Page) => page.getByRole("region", { name: "Hubbie personal assistant" });
async function open(page: Page) {
  await page.goto("/app/assistant");
  await expect(scope(page)).toBeVisible({ timeout: 30_000 });
}
async function mockAI(page: Page) {
  await seedSignedAuth(page, base, "buyer");
  await page.route("**/api/assistant", async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (route.request().method() === "GET") return route.fulfill({ json: { mode: "ai", provider: "meta" } });
    expect(route.request().postDataJSON().messages.at(-1).role).toBe("user");
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "step", step: reply.steps[0] }, { type: "reply", reply },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
}

test("Hubbie is inside an account: guests redirect and cannot use either API method", async ({ page, request }) => {
  await page.route("**/v1/auth/refresh", (route) => route.fulfill({ status: 401, json: { error: "Not signed in" } }));
  await page.goto("/app/assistant");
  await expect(page).toHaveURL(/\/login\?/);
  await page.goto("/help");
  await expect(page.getByRole("button", { name: "Open ProxyHubb assistant" })).toHaveCount(0);
  expect((await request.get("/api/assistant")).status()).toBe(401);
  expect((await request.post("/api/assistant", { data: { messages: [{ role: "user", content: "Read orders" }] } })).status()).toBe(401);
});

test("personal workspace shows account scope, streamed tool results, and reviewed links", async ({ page }) => {
  await mockAI(page);
  await open(page);
  await expect(scope(page).getByText("Meta AI · Platform tools")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Hubbie account scope" })).toContainText("buyer-route-policy");
  await scope(page).getByRole("button", { name: "Check my orders" }).click();
  await expect(scope(page).getByText("Your recent order is", { exact: false })).toBeVisible();
  await expect(scope(page).getByText("Read your recent orders (1)", { exact: true })).toBeVisible();
  await expect(scope(page).getByRole("link", { name: "Review your orders" })).toHaveAttribute("href", "/marketplace/orders");
  await expect(page.getByRole("navigation", { name: "Workspace utilities" }).getByRole("link", { name: "Hubbie", exact: true })).toHaveAttribute("aria-current", "page");
});

test("authenticated guide mode remains honest when AI is disabled", async ({ page }) => {
  await seedSignedAuth(page, base, "buyer");
  await page.route("**/api/assistant", (route) => route.fulfill({ json: route.request().method() === "GET" ? { mode: "guides" } : { ...reply, mode: "guides", content: "Start with your provider application.", steps: [{ label: "Searched ProxyHubb help guides", ok: true }] } }));
  await open(page);
  await scope(page).getByRole("button", { name: "Become a provider" }).click();
  await expect(scope(page).getByText("Hubbie · Help guides", { exact: true })).toBeVisible();
  await expect(scope(page).getByText("Guide answers do not check live data.", { exact: false })).toBeVisible();
});

test("failed requests can be retried without duplicating the user message", async ({ page }) => {
  await seedSignedAuth(page, base, "buyer");
  let requests = 0;
  await page.route("**/api/assistant", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { mode: "ai" } });
    requests++;
    return requests === 1 ? route.fulfill({ status: 503, json: { error: "Meta is temporarily unavailable." } }) : route.fulfill({ json: reply });
  });
  await open(page);
  await scope(page).getByRole("textbox", { name: "Your question" }).fill("Check my orders");
  await scope(page).getByRole("textbox").press("Enter");
  await expect(scope(page).getByRole("alert")).toContainText("temporarily unavailable");
  await scope(page).getByRole("button", { name: "Try again" }).click();
  await expect(scope(page).getByText("Your recent order is", { exact: false })).toBeVisible();
  await expect(scope(page).getByRole("article", { name: "You", exact: true })).toHaveCount(1);
  expect(requests).toBe(2);
});

test("stop aborts a response and new conversation removes account chat", async ({ page }) => {
  await seedSignedAuth(page, base, "buyer");
  let release: (() => void) | undefined;
  await page.route("**/api/assistant", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { mode: "ai" } });
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: reply }).catch(() => {});
  });
  await open(page);
  await scope(page).getByRole("textbox").fill("Check my orders");
  await scope(page).getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => !!release).toBe(true);
  await scope(page).getByRole("button", { name: "Stop response" }).click();
  await expect(scope(page).getByRole("button", { name: "Send message" })).toBeVisible();
  release?.();
  await scope(page).getByRole("button", { name: "Start a new conversation" }).click();
  await expect(scope(page).getByText("Hi, I’m Hubbie.", { exact: false })).toBeVisible();
  await expect(scope(page).getByRole("article")).toHaveCount(0);
});

test("model output cannot add trackers or unsafe links", async ({ page }) => {
  await mockAI(page);
  await page.route("**/api/assistant", async (route) => route.fulfill({ json: route.request().method() === "GET" ? { mode: "ai" } : {
    ...reply, content: "[Unsafe](https://tracker.invalid/steal) ![Tracker](https://tracker.invalid/pixel.png)", sources: [{ title: "Unsafe source", href: "javascript:alert(1)" }],
  } }));
  await open(page);
  await scope(page).getByRole("button", { name: "Check my orders" }).click();
  await expect(scope(page).getByText("Unsafe", { exact: true })).toBeVisible();
  await expect(scope(page).locator('a[href*="tracker.invalid"], a[href^="javascript:"], img')).toHaveCount(0);
});

test("mobile layout is accessible and fits the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAI(page);
  await open(page);
  const box = await scope(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  const scan = await new AxeBuilder({ page }).include('section[aria-label="Hubbie personal assistant"]').analyze();
  expect(scan.violations).toEqual([]);
  await scope(page).getByRole("textbox").fill("Help with connecting");
  await scope(page).getByRole("button", { name: "Send message" }).click();
  await expect(scope(page).getByText("Your recent order is", { exact: false })).toBeVisible();
});

test("chat is not restored into a different signed-in account", async ({ page }) => {
  await mockAI(page);
  await open(page);
  await scope(page).getByRole("button", { name: "Check my orders" }).click();
  await expect(scope(page).getByRole("article")).toHaveCount(2);
  await seedSignedAuth(page, base, "provider");
  await page.reload();
  await expect(scope(page)).toBeVisible();
  await expect(scope(page).getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Hubbie account scope" })).toContainText("provider-route-policy");
});
