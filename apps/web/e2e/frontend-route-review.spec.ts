import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedSignedAuth } from "./fixtures/signed-auth";
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
async function prepare(page: Page, role?: "both" | "admin") {
  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Source unavailable in route review" },
    }),
  );
  if (role) await seedSignedAuth(page, base, role);
}
async function review(page: Page, path: string) {
  await page.goto(base + path, { waitUntil: "domcontentloaded" });
  // Cold dev-server compiles of large routes can take a while locally;
  // the content assertions below are unchanged.
  await expect(page.locator("main")).toHaveCount(1, { timeout: 90000 });
  await expect(page.locator("main").getByRole("heading").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("heading", { name: "Something went wrong", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "SYSTEM ERROR", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
}
test.describe("route-family release review", () => {
  test.setTimeout(600000);
  test("public reading and authentication routes fit a 360px light viewport", async ({
    page,
  }, info) => {
    await prepare(page);
    await page.setViewportSize({ width: 360, height: 844 });
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    const routes = [
      "/",
      "/login",
      "/register",
      "/help",
      "/help/contact",
      "/help/guidelines",
      "/privacy",
      "/privacy/extension",
      "/terms",
      "/help/community/archive/feed",
      "/help/community/archive/beta",
      "/whitepaper",
      "/explorer/about/protocol",
    ];
    for (const path of routes) {
      if (path === "/help/community/archive/feed") await seedSignedAuth(page, base, "buyer");
      await test.step(path, () => review(page, path));
      if (path === "/") {
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "Skip to main content", exact: true })).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.locator("main")).toBeFocused();
      }
    }
    await info.attach("routes-reviewed", {
      body: JSON.stringify(routes),
      contentType: "application/json",
    });
  });
  test("operator and account utilities recover in a 390px viewport", async ({
    page,
  }, info) => {
    await prepare(page, "both");
    await page.setViewportSize({ width: 390, height: 844 });
    const routes = [
      "/dashboard/agents",
      "/dashboard/analytics",
      "/dashboard/monitoring",
      "/dashboard/provider/analytics",
      "/dashboard/provider/circle",
      "/dashboard/provider/cli",
      "/dashboard/provider/health",
      "/dashboard/provider/pair",
      "/dashboard/provider/relationships",
      "/dashboard/provider/services",
      "/dashboard/proxy",
      "/dashboard/trustless",
      "/dashboard/settings/account",
      "/dashboard/settings/api-keys",
      "/community/friends",
      "/app/settings?tab=referrals",
      "/marketplace/manage/products",
    ];
    for (const path of routes) await test.step(path, () => review(page, path));
    await info.attach("routes-reviewed", {
      body: JSON.stringify(routes),
      contentType: "application/json",
    });
  });
  test("public record details and disabled feeds have usable narrow recovery", async ({
    page,
  }, info) => {
    await prepare(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // The /explorer/* record pages moved to the standalone explorer (see
    // explorer.spec.ts); only local public records are reviewed here.
    const routes = ["/providers/unavailable-provider"];
    for (const path of routes) await test.step(path, () => review(page, path));
    await info.attach("routes-reviewed", {
      body: JSON.stringify(routes),
      contentType: "application/json",
    });
  });
  test("light-theme treasury and wallet lookup meet automated WCAG checks", async ({
    page,
  }, info) => {
    await prepare(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.addInitScript(() => localStorage.setItem("theme", "light"));
    for (const path of ["/treasury", "/explorer/wallets", "/whitepaper"]) {
      await review(page, path);
      const result = await new AxeBuilder({ page })
        .include("main")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      await info.attach(path.replaceAll("/", "-") + "-accessibility", {
        body: JSON.stringify(result.violations, null, 2),
        contentType: "application/json",
      });
      expect(result.violations).toEqual([]);
    }
  });
});
