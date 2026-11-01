import { expect as playwrightExpect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const expect = playwrightExpect.configure({ timeout: 30_000 });
async function stubWorkspace(page: Page) {
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const responses: Record<string, unknown> = {
      "/v1/orders": { orders: [] },
      "/v1/usage/me": { total_gb: 0, total_cost_sol: 0 },
      "/v1/analytics/usage/daily": {
        data: [
          { date: "2026-10-29", gb_used: 0 },
          { date: "2026-10-30", gb_used: 1.25 },
          { date: "2026-10-31" },
        ],
      },
      "/v1/provider/nodes": { nodes: [] },
      "/v1/provider/readiness": {
        status: "incomplete",
        summary: { ready_for_marketplace: false },
        checks: [],
        next: { message: "Set up a node to verify its first heartbeat." },
      },
      "/v1/provider/earnings/summary": {
        last_30_days_sol: 0,
        pending_sol: 0,
        paid_sol: 0,
      },
    };
    if (path in responses) await route.fulfill({ json: responses[path] });
    else
      await route.fulfill({
        status: 503,
        json: { error: "Not available in this test" },
      });
  });
}
test.describe("buyer and seller workspaces", () => {
  test.setTimeout(150_000);
  test("switches between four focused destinations using existing account capability", async ({
    page,
  }, testInfo) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "both");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    const nav = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Marketplace",
      "Connections",
      "Activity",
    ]);
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("0 GB", { exact: true })).toBeVisible();
    await page.addStyleTag({
      content:
        "nextjs-portal, .tsqd-parent-container { display: none !important; }",
    });
    await page
      .getByRole("combobox", { name: "Color theme" })
      .selectOption("dark");
    await page.screenshot({
      path: testInfo.outputPath("buyer-workspace-dark.png"),
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Color theme" })
      .selectOption("light");
    await page.screenshot({
      path: testInfo.outputPath("buyer-workspace.png"),
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption("seller");
    await expect(page).toHaveURL(`${base}/provider`);
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Nodes",
      "Listings",
      "Earnings",
    ]);
    await expect(
      page.getByRole("heading", { name: "Provider overview" }),
    ).toBeVisible();
    await page.addStyleTag({
      content:
        "nextjs-portal, .tsqd-parent-container { display: none !important; }",
    });
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.screenshot({
      path: testInfo.outputPath("seller-workspace.png"),
      fullPage: true,
    });
  });
  test("persists explicit light and dark themes and supports a 320px workspace", async ({
    page,
  }) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("combobox", { name: "Color theme" })
      .selectOption("dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("combobox", { name: "Color theme" }),
    ).toHaveValue("dark");
    await page.setViewportSize({ width: 320, height: 740 });
    const mobile = page.getByRole("navigation", { name: "Mobile primary" });
    await expect(mobile.getByRole("link")).toHaveText([
      "Overview",
      "Marketplace",
      "Connections",
      "Activity",
    ]);
    await expect(mobile).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Account menu" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("link", { name: "Wallet & balances" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Workspace", exact: true }),
    ).toHaveValue("buyer");
    await page.keyboard.press("Escape");
    await page
      .getByRole("combobox", { name: "Color theme" })
      .selectOption("light");
    await expect(page.locator("html")).toHaveClass(/light/);
    await page
      .getByRole("combobox", { name: "Color theme" })
      .selectOption("system");
    await expect(
      page.getByRole("combobox", { name: "Color theme" }),
    ).toHaveValue("system");
  });
  test("keeps seller access protected and offers onboarding to buyers", async ({
    page,
  }) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    await expect(
      page
        .getByRole("combobox", { name: "Workspace", exact: true })
        .locator('option[value="seller"]'),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("combobox", { name: "Workspace", exact: true })
        .locator('option[value="apply"]'),
    ).toHaveCount(1);
    await page.context().clearCookies({ name: "proxyhubb_e2e_auth" });
    await page.goto(`${base}/provider`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/403\?policy=provider/);
  });
  test("requires sign in on new private workspace routes", async ({ page }) => {
    await page.goto(`${base}/app/connections`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/\/login\?next=/);
  });
  test("distinguishes zero usage from missing measurements on a narrow screen", async ({
    page,
  }, info) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "buyer");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${base}/app/activity?tab=usage`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("listitem", { name: /: 0 GB$/ })).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: /: 1.25 GB$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem", { name: /: Unavailable$/ }),
    ).toBeVisible();
    await page.getByText("View exact measurements", { exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Unavailable", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("usage-mobile.png"),
      fullPage: true,
    });
  });
});
