import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
import { mockListingDetail } from "./fixtures/marketplace-map";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const widths = [320, 390, 768, 1024, 1440, 1920];

async function resize(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function isolate(page: Page) {
  await page.routeWebSocket(url => !url.pathname.includes("/_next/"), socket => socket.close());
  await page.route("**/v1/**", route => route.fulfill({ status: 503, json: { error: "Unavailable in this test" } }));
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
}

async function fitsPage(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.addStyleTag({ content: "nextjs-portal, .tsqd-parent-container { display: none !important; }" });
  await page.screenshot({ path: info.outputPath(name + ".png"), fullPage: true, animations: "disabled" });
}

test.describe("workspace UI layout regressions", () => {
  test.setTimeout(150_000);
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("marketplace keeps private locations, latency details, and filter controls readable", async ({ page }, info) => {
    await isolate(page);
    const listings = [
      mockListingDetail({ id: "private-offer", title: "HQ 4000", country: "Hidden until session", city: "", seller: undefined, catalog_product: undefined, avg_latency_ms: 0, price_per_gb: 0.99, available_bandwidth_gb: 30 }),
      mockListingDetail({ id: "measured-offer", title: "Residential capacity with a longer descriptive title", catalog_product: undefined }),
      mockListingDetail({ id: "third-offer", catalog_product: undefined, country: "GH", city: "Accra" }),
    ];
    await page.route(/\/v1\/listings\?/, route => route.fulfill({ json: { listings, total: 3, page: 1 } }));
    await page.route("**/v1/listings/facets**", route => route.fulfill({ json: { countries: [{ value: "GH", count: 1 }] } }));
    await page.goto(base + "/marketplace", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("listing-private-offer");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.locator(".offer-region")).toHaveText("");
    await expect(card.locator(".offer-region svg")).toBeVisible();
    for (const width of widths) {
      await resize(page, width);
      await fitsPage(page);
      const value = await card.getByText("Not measured", { exact: true }).boundingBox();
      const hint = await card.getByText("No measurement", { exact: true }).boundingBox();
      expect(hint!.y).toBeGreaterThanOrEqual(value!.y + value!.height);
      const bounds = await card.boundingBox();
      const action = await card.getByRole("button", { name: "View details" }).boundingBox();
      expect(action!.x + action!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      const other = page.getByTestId("listing-measured-offer");
      const otherBounds = await other.boundingBox();
      if (Math.abs(bounds!.y - otherBounds!.y) < 1) {
        const specs = await card.locator(".offer-specs").boundingBox();
        const otherSpecs = await other.locator(".offer-specs").boundingBox();
        expect(Math.abs(specs!.y - otherSpecs!.y)).toBeLessThanOrEqual(1);
      }
      if (width === 390 || width === 1440) await capture(page, info, "marketplace-" + width);
    }
    await resize(page, 390, 844);
    await page.getByRole("button", { name: "More filters" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByTestId("marketplace-filter-max-price").fill("1.25");
    await page.getByRole("dialog").getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/max_price=1.25/);
  });

  test("forum feed, topics and search fit every screen", async ({ page }, info) => {
    await isolate(page);
    const names = ["Governance", "General Discussion", "Technical Support", "Feature Requests", "Provider Showcase", "Buying & Selling"];
    const categories = names.map((name, index) => ({ id: String(index), name, slug: "topic-" + index, thread_count: index, description: "Get help and share advice with the community." }));
    const threads = [
      { id: "long", title: "", content: "A long post that wraps across the card. ".repeat(12), created_at: "2026-11-01T10:00:00Z", upvotes: 1200, replies_count: 14, views_count: 25300, category: categories[3], author: { id: "a", username: "averyveryverylongusername_here", display_name: "A person with a rather long display name" } },
      { id: "short", title: "Short title", content: "gm 👋 #providers https://example.com/a/very/long/path/that/should/wrap/somewhere", created_at: "2026-11-04T10:00:00Z", upvotes: 0, replies_count: 0, views_count: 3, category: categories[1] },
    ];
    await page.route("**/v1/forum/categories", route => route.fulfill({ json: { categories } }));
    await page.route("**/v1/forum/recent**", route => route.fulfill({ json: { threads, total: 2 } }));
    await page.route("**/v1/forum/search**", route => route.fulfill({ json: { threads: [] } }));
    await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".feed-topics a")).toHaveCount(6, { timeout: 60_000 });
    await expect(page.locator(".post-card")).toHaveCount(2);
    await expect(page.getByRole("navigation", { name: "Community and network" }).getByRole("link", { name: "Discussions", exact: true })).toHaveAttribute("aria-current", "page");
    for (const width of widths) {
      await resize(page, width);
      await fitsPage(page);
      if (width === 390 || width === 1440) await capture(page, info, "forum-" + width);
    }
    await resize(page, 320, 740);
    const search = page.getByLabel("Search posts", { exact: true });
    await search.fill("SOCKS5");
    await search.press("Enter");
    await expect(page.getByRole("heading", { name: "No matching posts" })).toBeVisible();
    await page.getByRole("button", { name: "Clear forum search" }).click();
    await expect(page.locator(".post-card")).toHaveCount(2);
  });

  test("account and authenticator dialogs stay within short and narrow viewports", async ({ page }, info) => {
    await isolate(page);
    await seedSignedAuth(page, base, "both");
    await page.route("**/v1/2fa/backup-codes", route => route.fulfill({ status: 400, json: { error: "Not enabled" } }));
    await page.route("**/v1/2fa/setup", route => route.fulfill({ json: { secret: "JBSWY3DPEHPK3PXP".repeat(4), otpauth_url: "otpauth://totp/ProxyHubb:test?secret=JBSWY3DPEHPK3PXP&issuer=ProxyHubb" } }));
    await page.goto(base + "/app/settings?tab=security", { waitUntil: "domcontentloaded" });
    const setupButton = page.getByRole("button", { name: "Set up authenticator", exact: true });
    await expect(setupButton).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("navigation", { name: "Workspace utilities" }).getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    let dialog = page.getByRole("dialog");
    for (const width of [1440, 390, 320]) {
      await resize(page, width, width === 320 ? 480 : 900);
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(15);
      expect(box!.y).toBeGreaterThanOrEqual(15);
      expect(box!.y + box!.height).toBeLessThanOrEqual((width === 320 ? 480 : 900) - 15);
      await dialog.getByRole("button", { name: "Sign out", exact: true }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport();
      if (width === 390) await capture(page, info, "account-390");
    }
    await dialog.locator("summary").click();
    await expect(dialog.getByRole("navigation", { name: "Workspace tools", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await setupButton.click();
    dialog = page.getByRole("dialog");
    for (const width of [1440, 390, 320]) {
      const height = width === 320 ? 480 : 900;
      await resize(page, width, height);
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(15);
      expect(box!.y).toBeGreaterThanOrEqual(15);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height - 15);
      expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      if (width !== 320) await capture(page, info, "authenticator-" + width);
    }
    await dialog.locator("summary").click();
    await expect(dialog.locator(".authenticator-manual code")).toBeVisible();
    await fitsPage(page);
    await dialog.getByLabel("Authenticator code", { exact: true }).fill("123456");
    await expect(dialog.getByRole("button", { name: "Verify & enable", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(setupButton).toBeFocused();
  });
});
