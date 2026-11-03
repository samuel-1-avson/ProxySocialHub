import { expect, test, type Page } from "@playwright/test";
import {
  stubMarketplaceListingDetail,
  verifiedMapListingId,
} from "./fixtures/marketplace-map";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
async function isolate(page: Page) {
  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Service unavailable in this test" },
    }),
  );
}
async function capture(page: Page, path: string, fullPage = true) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main [style]")).every(
      (element) =>
        !element.style.opacity || Number(element.style.opacity) >= 0.99,
    ),
  );
  await page.addStyleTag({
    content:
      "nextjs-portal, .tsqd-parent-container { display: none !important; }",
  });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path, fullPage });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test.describe("frontend details and public content", () => {
  test.setTimeout(180_000);
  test("listing evidence stays honest, share failure is visible, and questions can recover", async ({
    page,
  }, info) => {
    await isolate(page);
    await stubMarketplaceListingDetail(page);
    let questionsAvailable = false;
    await page.route(
      "**/v1/listings/" + verifiedMapListingId + "/qa",
      (route) =>
        route.fulfill(
          questionsAvailable
            ? { json: { questions: [], count: 0 } }
            : { status: 503, json: { error: "Questions unavailable" } },
        ),
    );
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("Clipboard denied")),
        },
      }),
    );
    await page.goto(base + "/marketplace/" + verifiedMapListingId, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Premium Austin Pool", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator(".listing-intro").getByText("No reviews yet"),
    ).toBeVisible();
    await expect(page.getByText("No source reported").first()).toBeVisible();
    await expect(
      page.getByText("Measured metrics", { exact: true }),
    ).toHaveCount(0);
    const qa = page.getByRole("region", { name: "Questions and answers" });
    await expect(qa.getByText("Questions could not be loaded.")).toBeVisible({
      timeout: 30_000,
    });
    await expect(qa.getByText(/No questions yet/)).toHaveCount(0);
    questionsAvailable = true;
    await qa.getByRole("button", { name: "Try again" }).click();
    await expect(qa.getByText(/No questions yet/)).toBeVisible();
    await capture(page, info.outputPath("listing-detail-desktop.png"));
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await capture(page, info.outputPath("listing-detail-mobile.png"));
    await page.getByRole("button", { name: "Share listing" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /copy|clipboard/i }),
    ).toBeVisible();
  });

  test("governance filters actual proposals and keeps readiness separate", async ({
    page,
  }, info) => {
    await isolate(page);
    await page.route("**/v1/governance/proposals", (route) =>
      route.fulfill({
        json: {
          proposals: [
            {
              id: "active-proposal",
              title: "Regional capacity incentives",
              description:
                "Review provider capacity incentives for the next network period.",
              type: "parameter_change",
              status: "active",
              start_time: "2026-10-31T10:00:00Z",
              end_time: "2026-11-08T10:00:00Z",
              votes_for: 12,
              votes_against: 3,
            },
            {
              id: "executed-proposal",
              title: "Gateway maintenance window",
              description: "Set the gateway maintenance schedule.",
              type: "signal",
              status: "executed",
              start_time: "2026-10-20T10:00:00Z",
              end_time: "2026-10-28T10:00:00Z",
              votes_for: 8,
              votes_against: 2,
            },
          ],
        },
      }),
    );
    await page.route("**/v1/governance/execution-readiness", (route) =>
      route.fulfill({
        json: {
          governance_execution: {
            ready: false,
            status: "not_configured",
            message: "Execution is not configured in this environment.",
          },
        },
      }),
    );
    await page.goto(base + "/governance", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Governance", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/On-chain governance is not ready/),
    ).toBeVisible();
    await expect(page.locator(".proposal-card")).toHaveCount(2);
    await page.getByLabel("Proposal status").selectOption("active");
    await expect(page.locator(".proposal-card")).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: /Regional capacity incentives/ }),
    ).toBeVisible();
    await page.getByLabel("Search proposals").fill("no match");
    await expect(
      page.getByText("No matching proposals", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Search proposals").fill("");
    await page.getByLabel("Proposal status").selectOption("");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await capture(page, info.outputPath("governance-mobile.png"));
  });

  test("forum shows recent discussions, reports search failure, and retries", async ({
    page,
  }, info) => {
    await isolate(page);
    const category = {
      id: "guides",
      name: "Guides & support",
      slug: "guides",
      description: "Practical setup help for buyers and providers.",
      thread_count: 1,
    };
    const thread = {
      id: "setup-question",
      title: "How do I configure a SOCKS5 connection?",
      content: "I want to connect my browser to my purchased proxy endpoint.",
      category,
      created_at: "2026-10-31T10:00:00Z",
      upvotes: 4,
      downvotes: 0,
      replies_count: 2,
      views_count: 10,
    };
    await page.route("**/v1/forum/categories", (route) =>
      route.fulfill({ json: { categories: [category] } }),
    );
    await page.route("**/v1/forum/recent**", (route) =>
      route.fulfill({ json: { threads: [thread] } }),
    );
    let searchAvailable = false;
    await page.route("**/v1/forum/search**", (route) =>
      route.fulfill(
        searchAvailable
          ? { json: { threads: [thread], total: 1 } }
          : {
              status: 503,
              json: { error: "Search is temporarily unavailable" },
            },
      ),
    );
    await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Latest conversations" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: thread.title })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel("Search discussions", { exact: true }).fill("SOCKS5");
    await page
      .getByRole("search")
      .getByRole("button", { name: "Search", exact: true })
      .click();
    const error = page
      .getByRole("alert")
      .filter({ hasText: "Search could not be completed" });
    await expect(error).toBeVisible({ timeout: 30_000 });
    searchAvailable = true;
    await error.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("link", { name: thread.title })).toBeVisible();
    await page.getByRole("button", { name: "Clear forum search" }).click();
    await capture(page, info.outputPath("forum-desktop.png"));
    await page
      .getByRole("navigation", { name: "Forum sections" })
      .getByRole("link", { name: "Recent", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Recent discussions", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .getByRole("navigation", { name: "Forum sections" })
        .getByRole("link", { name: "Recent", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
  });

  test("appearance controls persist the theme and expose selection", async ({
    page,
  }, info) => {
    await isolate(page);
    await seedSignedAuth(page, base, "buyer");
    await page.route("**/v1/notification-preferences", (route) =>
      route.fulfill({
        json: {
          user_id: "buyer-route-policy-user",
          social_in_app: true,
          social_email: false,
          social_push: false,
          business_in_app: true,
          business_email: true,
          business_push: false,
          community_in_app: true,
          community_email: false,
          community_push: false,
          system_in_app: true,
          system_email: true,
          system_push: false,
          email_digest_frequency: "daily",
          digest_day: "monday",
          digest_hour: 9,
        },
      }),
    );

    await page.goto(base + "/app/settings?tab=preferences", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Appearance", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await page
      .locator(".appearance-choices button")
      .filter({ hasText: "Light" })
      .click();
    await expect(page.locator("html")).toHaveClass(/light/);
    await expect(
      page.locator(".appearance-choices button").filter({ hasText: "Light" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", { name: "Notifications", exact: true }),
    ).toBeVisible();
    await capture(page, info.outputPath("settings-light.png"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
  });

  test("support and policy pages provide titles, contents links, and a mobile reading layout", async ({
    page,
  }, info) => {
    await isolate(page);
    await page.goto(base + "/help", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Help Center | ProxyHubb");
    await expect(
      page.getByRole("navigation", { name: "Page contents" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Page contents" })
      .getByRole("link", { name: /Buying proxy bandwidth/ })
      .click();
    await expect(page).toHaveURL(/#info-section-2$/);
    await expect(
      page.getByRole("heading", { name: "Buying proxy bandwidth" }),
    ).toBeInViewport();
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await capture(page, info.outputPath("help-mobile.png"));
    await page.goto(base + "/privacy", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("Privacy Policy | ProxyHubb");
    await expect(
      page.getByRole("heading", { name: "Privacy Policy", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
  });
  test("Explorer preserves zero measurements and reports unavailable health", async ({
    page,
  }, info) => {
    await isolate(page);
    let available = true;
    await page.route("**/v1/explorer/metrics**", (route) =>
      route.fulfill({
        json: available
          ? {
              active_nodes: 0,
              block_height: 0,
              total_volume: 0,
              total_bandwidth_gb: 0,
              active_wallets: 0,
              transactions_per_second: 0,
            }
          : {},
      }),
    );
    await page.route("**/v1/explorer/transactions**", (route) =>
      route.fulfill({ json: { transactions: [], total: 0 } }),
    );
    await page.route("**/v1/explorer/blocks**", (route) =>
      route.fulfill({ json: { blocks: [], total: 0 } }),
    );
    await page.goto(base + "/explorer", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("group", { name: "Active nodes", exact: true }),
    ).toContainText("0", { timeout: 30_000 });
    await expect(
      page.getByRole("group", { name: "Transaction volume", exact: true }),
    ).toContainText("0.00 SOL");
    await expect(page.getByText("System status: unavailable")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/System status: optimal/i)).toHaveCount(0);
    await capture(page, info.outputPath("explorer-overview.png"));
    available = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("group", { name: "Active nodes", exact: true }),
    ).toContainText("—", { timeout: 30_000 });
    await expect(
      page.getByRole("group", { name: "Transaction volume", exact: true }),
    ).toContainText("—");
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
  });

  test("forum category pagination requests the next page and preserves a useful empty state", async ({
    page,
  }) => {
    await isolate(page);
    await page.route("**/v1/forum/categories/guides", (route) =>
      route.fulfill({
        json: {
          category: {
            id: "guides",
            slug: "guides",
            name: "Provider setup guides",
            description: "Practical node setup help.",
            is_locked: true,
          },
        },
      }),
    );
    await page.route("**/v1/forum/categories/guides/threads**", (route) => {
      const pageNumber = new URL(route.request().url()).searchParams.get(
        "page",
      );
      return route.fulfill({
        json: {
          threads:
            pageNumber === "2"
              ? []
              : [
                  {
                    id: "guide",
                    title: "Registering your first provider node",
                    content: "The first steps for registering your node.",
                    created_at: "2026-10-31T10:00:00Z",
                  },
                ],
          total: 21,
        },
      });
    });
    await page.goto(base + "/help/forum/category/guides", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Provider setup guides", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/This category is read-only/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No discussions in this topic" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Registering your first provider node" }),
    ).toBeVisible();
  });
});
