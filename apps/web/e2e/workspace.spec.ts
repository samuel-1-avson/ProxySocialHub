import { expect as playwrightExpect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
import { setHeaderTheme } from "./fixtures/theme";

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
// Below 768px the sidebar is hidden: phones navigate with the bottom tab bar
// and switch workspace from the Account menu.
function primaryNav(page: Page, isMobile: boolean) {
  return page.getByRole("navigation", {
    name: isMobile ? "Mobile primary" : "Primary",
    exact: true,
  });
}
async function workspaceSwitcher(page: Page, isMobile: boolean) {
  if (!isMobile) {
    return page.getByRole("combobox", { name: "Workspace", exact: true }).first();
  }
  const switcher = page.getByRole("combobox", { name: "Workspace", exact: true });
  const menu = page.getByRole("dialog").filter({ has: switcher });
  // A tap that lands before hydration does nothing, so retry until the menu is open.
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await page.getByRole("button", { name: "Account menu", exact: true }).click();
    }
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return menu.getByRole("combobox", { name: "Workspace", exact: true });
}
test.describe("buyer and seller workspaces", () => {
  test.setTimeout(150_000);
  test("switches between four focused destinations using existing account capability", async ({
    page,
    isMobile,
  }, testInfo) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "both");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    const nav = primaryNav(page, isMobile);
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
    await setHeaderTheme(page, "dark");
    await page.screenshot({
      path: testInfo.outputPath("buyer-workspace-dark.png"),
      fullPage: true,
    });
    await setHeaderTheme(page, "light");
    await page.screenshot({
      path: testInfo.outputPath("buyer-workspace.png"),
      fullPage: true,
    });
    await (await workspaceSwitcher(page, isMobile)).selectOption("seller");
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
    // Shared pages keep the workspace the user last chose.
    await page.goto(`${base}/app/wallet`, { waitUntil: "domcontentloaded" });
    const switcher = await workspaceSwitcher(page, isMobile);
    await expect(switcher).toHaveValue("seller");
    await switcher.selectOption("buyer");
    await expect(page).toHaveURL(`${base}/app`);
    await page.goto(`${base}/app/wallet`, { waitUntil: "domcontentloaded" });
    await expect(await workspaceSwitcher(page, isMobile)).toHaveValue("buyer");
  });
  test("shows Become a provider while applying and switches back to Buyer", async ({
    page,
    isMobile,
  }) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    await expect(await workspaceSwitcher(page, isMobile)).toHaveValue("buyer");
    await (await workspaceSwitcher(page, isMobile)).selectOption("apply");
    await expect(page).toHaveURL(`${base}/dashboard/become-provider`);
    await expect(await workspaceSwitcher(page, isMobile)).toHaveValue("apply");
    await (await workspaceSwitcher(page, isMobile)).selectOption("buyer");
    await expect(page).toHaveURL(`${base}/app`);
    await expect(await workspaceSwitcher(page, isMobile)).toHaveValue("buyer");
  });
  test("persists explicit light and dark themes and supports a 320px workspace", async ({
    page,
  }, testInfo) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    const header = page.getByRole("banner");
    await expect(header.getByRole("combobox")).toHaveCount(0);
    await setHeaderTheme(page, "dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      header.getByRole("button", { name: "Switch to light theme" }),
    ).toBeVisible();
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
    await page.screenshot({ path: testInfo.outputPath("workspace-header-mobile.png") });
    await setHeaderTheme(page, "light");
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.getByRole("button", { name: "Account menu" }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("link", { name: "Wallet & balances" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Workspace", exact: true }),
    ).toHaveValue("buyer");
    await dialog
      .getByRole("combobox", { name: "Color theme" })
      .selectOption("system");
    await expect(
      dialog.getByRole("combobox", { name: "Color theme" }),
    ).toHaveValue("system");
    await page.keyboard.press("Escape");
    await expect(header.getByRole("combobox")).toHaveCount(0);
  });
  test("keeps seller access protected and offers onboarding to buyers", async ({
    page,
    isMobile,
  }) => {
    await stubWorkspace(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
    const switcher = await workspaceSwitcher(page, isMobile);
    await expect(switcher.locator('option[value="seller"]')).toHaveCount(0);
    await expect(switcher.locator('option[value="apply"]')).toHaveCount(1);
    // Leave the app first: its client code can start a redirect to /app while
    // the next navigation is under way (seen on WebKit).
    await page.goto("about:blank");
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
