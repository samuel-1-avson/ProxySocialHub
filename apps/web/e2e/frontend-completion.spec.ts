import AxeBuilder from "@axe-core/playwright";
import { test, expect as baseExpect, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
test.use({ actionTimeout: 30000 });
const expect = baseExpect.configure({ timeout: 30000 });
const timestamp = "2026-10-31T12:00:00Z";
const category = {
  id: "cat-help",
  name: "Help & support",
  slug: "help",
  description: "Ask the community",
  is_locked: false,
  thread_count: 1,
  created_at: timestamp,
};
const thread = {
  id: "thread-one",
  category_id: category.id,
  author_id: "buyer-route-policy-user",
  title: "Choosing a regional provider",
  content: "What should I check before choosing a provider?",
  replies_count: 1,
  views_count: 5,
  upvotes: 3,
  downvotes: 1,
  is_pinned: false,
  is_locked: false,
  created_at: timestamp,
  updated_at: timestamp,
  category,
  author: {
    id: "buyer-route-policy-user",
    username: "buyer-route-policy",
    display_name: "Test buyer",
  },
};
const reply = {
  id: "reply-one",
  thread_id: thread.id,
  author_id: "provider-one",
  content: "Compare the actual reported capacity and purchase terms.",
  upvotes: 1,
  downvotes: 0,
  is_solution: false,
  created_at: timestamp,
  updated_at: timestamp,
  author: { id: "provider-one", username: "alex", display_name: "Alex" },
};
async function isolate(page: Page, role?: "buyer" | "provider" | "admin") {
  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Fixture source unavailable" },
    }),
  );
  if (role) await seedSignedAuth(page, base, role);
}
async function narrow(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    )
    .toBeLessThanOrEqual(1);
}
async function capture(page: Page, path: string) {
  await page.addStyleTag({
    content: "nextjs-portal,.tsqd-parent-container{display:none!important}",
  });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path, fullPage: false, animations: "disabled" });
}
test.describe("remaining frontend acceptance", () => {
  test.setTimeout(180000);
  test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus) return;
    const results = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    await info.attach("accessibility", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          failure: node.failureSummary,
        })),
      })),
    ).toEqual([]);
  });
  test("discussion editor validates, preserves rejected content, and opens the canonical result", async ({
    page,
  }, info) => {
    await isolate(page, "buyer");
    let accepted = false;
    await page.route("**/v1/forum/categories", (route) =>
      route.fulfill({
        json: {
          categories: [
            category,
            {
              ...category,
              id: "locked",
              slug: "locked",
              name: "Announcements",
              is_locked: true,
            },
          ],
        },
      }),
    );
    await page.route("**/v1/forum/threads", async (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: { threads: [thread], total: 1 } });
      const body = route.request().postDataJSON();
      expect(body.title).toBe(thread.title);
      expect(body.content).toBe(thread.content);
      return route.fulfill(
        accepted
          ? { json: thread }
          : { status: 503, json: { error: "Publishing unavailable" } },
      );
    });
    await page.route("**/v1/forum/threads/thread-one", (route) =>
      route.fulfill({ json: { thread, posts: [reply] } }),
    );
    await page.goto(base + "/help/forum/new", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Start a conversation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Announcements" }),
    ).toHaveCount(0);
    await page.getByLabel("Category", { exact: true }).selectOption("help");
    await page
      .getByLabel("Discussion title", { exact: true })
      .fill("  " + thread.title + "  ");
    await page
      .getByLabel("Message", { exact: true })
      .fill("  " + thread.content + "  ");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(page.locator(".discussion-preview")).toContainText(
      thread.content,
    );
    await page.getByRole("button", { name: /Publish discussion/ }).click();
    await expect(page.locator("main [role=alert]").first()).toBeVisible();
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "  " + thread.content + "  ",
    );
    await narrow(page);
    await capture(page, info.outputPath("forum-editor-mobile.png"));
    accepted = true;
    await page.getByRole("button", { name: /Publish discussion/ }).click();
    await expect(page).toHaveURL(/\/help\/forum\/thread\/thread-one/);
    await expect(
      page.getByRole("heading", { name: thread.title }),
    ).toBeVisible();
  });
  test("discussion replies, votes, reports and keyboard dialogs expose failures", async ({
    page,
  }, info) => {
    await isolate(page, "buyer");
    await page.route("**/v1/forum/threads/thread-one", (route) =>
      route.fulfill({ json: { thread, posts: [reply] } }),
    );
    await page.goto(base + "/help/forum/thread/thread-one", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(reply.content, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Upvote discussion", exact: true })
      .click();
    await expect(page.locator("main [role=alert]").first()).toBeVisible();
    await page
      .getByLabel("Your reply", { exact: true })
      .fill("Keep this reply after failure.");
    await page.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(page.getByLabel("Your reply", { exact: true })).toHaveValue(
      "Keep this reply after failure.",
    );
    await page
      .getByRole("button", { name: "Share discussion", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Share discussion", exact: true }),
    ).toBeFocused();
    await narrow(page);
    await capture(page, info.outputPath("forum-thread-mobile.png"));
  });
  test("inbox failure recovers without pretending there are no conversations", async ({
    page,
  }) => {
    await isolate(page, "buyer");
    let ready = false;
    await page.route(/\/v1\/conversations(?:\?.*)?$/, (route) =>
      route.fulfill(
        ready
          ? { json: { conversations: [] } }
          : { status: 503, json: { error: "Inbox unavailable" } },
      ),
    );
    await page.goto(base + "/messages", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Inbox", exact: true }),
    ).toBeVisible();
    await expect(page.locator("main [role=alert]").first()).toBeVisible();
    await expect(
      page.getByText("Your inbox is ready", { exact: true }),
    ).toHaveCount(0);
    ready = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByText("Your inbox is ready", { exact: true }),
    ).toBeVisible();
  });
  test("message send preserves drafts and conversation switching stays scoped", async ({
    page,
  }, info) => {
    await isolate(page, "buyer");
    const conversations = ["one", "two"].map((id) => ({
      id,
      conversation: {
        id,
        participants: ["buyer-route-policy-user", "provider-" + id],
        created_at: timestamp,
      },
      other_participant: {
        id: "provider-" + id,
        username: "provider-" + id,
        display_name: "Provider " + id,
      },
      other_participant_name: "Provider " + id,
      unread_count: 0,
    }));
    await page.route(/\/v1\/conversations(?:\?.*)?$/, (route) =>
      route.fulfill({ json: { conversations } }),
    );
    await page.route(
      /\/v1\/conversations\/(one|two)\/messages(?:\?.*)?$/,
      (route) => {
        const id = new URL(route.request().url()).pathname.split("/")[3];
        return route.fulfill(
          route.request().method() === "POST"
            ? { status: 503, json: { error: "Send unavailable" } }
            : {
                json: {
                  messages: [
                    {
                      id: "message-" + id,
                      conversation_id: id,
                      sender_id: "provider-" + id,
                      content: "Message for " + id,
                      created_at: timestamp,
                    },
                  ],
                },
              },
        );
      },
    );
    await page.goto(base + "/messages?conversation=one", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByText("Message for one", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Write a message", { exact: true })
      .fill("Preserve my draft.");
    await page
      .getByRole("button", { name: "Send message to Provider one" })
      .click();
    await expect(page.locator("main [role=alert]").first()).toBeVisible();
    await expect(
      page.getByLabel("Write a message", { exact: true }),
    ).toHaveValue("Preserve my draft.");
    await page.goto(base + "/messages?conversation=two", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByText("Message for two", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Message for one", { exact: true }),
    ).toHaveCount(0);
    await narrow(page);
    await capture(page, info.outputPath("messages-mobile.png"));
  });
  test("public profile keeps review failure distinct from no reviews", async ({
    page,
  }, info) => {
    await isolate(page);
    await page.route("**/v1/users/alex", (route) =>
      route.fulfill({
        json: {
          id: "alex",
          username: "alex",
          display_name: "Alex Morgan",
          role: "provider",
          verified: true,
          trust_tier: "verified",
          followers_count: 12,
          following_count: 3,
          reviews_count: 0,
          avg_rating: 0,
          total_bandwidth_sold: 20,
          experience_years: 2,
          created_at: timestamp,
          bio: "Regional provider with transparent capacity and availability.",
        },
      }),
    );
    await page.goto(base + "/profile/alex", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Alex Morgan", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Reviews are unavailable", { exact: true }),
    ).toBeVisible();
    await narrow(page);
    await capture(page, info.outputPath("profile-mobile.png"));
  });
  test("treasury distinguishes missing balances and preserves true zero values", async ({
    page,
  }, info) => {
    await isolate(page);
    await page.route("**/v1/treasury/public", (route) =>
      route.fulfill({
        json: {
          network: "devnet",
          oracle_configured: false,
          operational_healthy: false,
          lifetime_provider_paid_sol: 0,
          recent_batch_payouts: [],
          timestamp,
          treasury: {
            status: "RPC_UNAVAILABLE",
            hot: {
              address: "hot-wallet-address",
              balance_sol: 0,
              balance_unavailable: true,
            },
            cold: { address: "cold-wallet-address", balance_sol: 0 },
            last_checked_at: timestamp,
            liquidity: { queue_depth: 0, last_topup_sol: 0 },
          },
        },
      }),
    );
    const records = page.waitForResponse((response) => response.url().endsWith("/v1/treasury/public") && response.status() === 200, { timeout: 60000 });
    await page.goto(base + "/treasury", { waitUntil: "domcontentloaded" });
    await records;
    await expect(
      page.getByRole("heading", { name: "Platform treasury" }),
    ).toBeVisible();
    await expect(
      page
        .locator(".treasury-wallet")
        .filter({ hasText: "Hot wallet" })
        .getByRole("heading", { name: "Unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".treasury-wallet")
        .filter({ hasText: "Cold wallet" })
        .getByRole("heading", { name: "0 SOL", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View on Solscan" }).first(),
    ).toHaveAttribute("href", /cluster=devnet/);
    await narrow(page);
    await capture(page, info.outputPath("treasury-mobile.png"));
  });
  test("analytics applies custom dates and provides exact accessible measurements", async ({
    page,
  }, info) => {
    await isolate(page);
    let requested = "";
    await page.route("**/v1/explorer/analytics?**", (route) => {
      requested = route.request().url();
      return route.fulfill({
        json: {
          period: "24h",
          metrics_available: true,
          transaction_volume: [
            { timestamp, value: 0 },
            { timestamp: "2026-10-31T13:00:00Z", value: 0.4 },
          ],
          bandwidth_gb: [],
          active_nodes: [],
          active_wallets: [],
        },
      });
    });
    await page.route("**/v1/explorer/metrics?**", (route) =>
      route.fulfill({
        json: {
          total_volume: 0,
          transactions_per_second: 0,
          total_bandwidth_gb: 0,
          active_wallets: 0,
          region_distribution: { Ghana: 2 },
        },
      }),
    );
    await page.goto(base + "/explorer/analytics", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Network analytics", exact: true }),
    ).toBeVisible();
    await page.getByLabel("From date").fill("2026-10-01");
    await page.getByLabel("To date").fill("2026-10-31");
    await page.getByRole("button", { name: "Apply date range" }).click();
    await expect.poll(() => requested).toContain("from=2026-10-01");
    await page.getByText("View exact measurements · SOL").click();
    await expect(
      page.getByRole("cell", { name: "0.4", exact: true }),
    ).toBeVisible();
    await narrow(page);
    await capture(page, info.outputPath("analytics-mobile.png"));
  });
  test("health transport failures do not claim an outage or a healthy event log", async ({
    page,
  }) => {
    await isolate(page);
    await page.goto(base + "/explorer/health", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByText("Current health is unavailable", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Health history is unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Down", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("All systems nominal", { exact: true }),
    ).toHaveCount(0);
    await narrow(page);
  });
  test("wallet lookup validates and public records recover from failures", async ({
    page,
  }) => {
    await isolate(page);
    await page.goto(base + "/explorer/wallets", {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByLabel("Solana wallet address", { exact: true })
      .fill("invalid");
    await page.getByRole("button", { name: "Look up wallet" }).click();
    await expect(page.locator("main [role=alert]").first()).toContainText(
      "valid Solana address",
    );
    for (const path of ["blocks", "contracts", "nodes", "transactions"]) {
      await page.goto(base + "/explorer/" + path, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("main [role=alert]").first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Try again" }),
      ).toBeVisible();
      await narrow(page);
    }
  });
  test("draft documentation has working contents, consistent themes, and a narrow reading layout", async ({
    page,
  }, info) => {
    await isolate(page);
    await page.goto(base + "/whitepaper", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Architecture draft", exact: true }),
    ).toBeVisible();
    const broken = await page
      .getByRole("navigation", { name: "Architecture draft contents" })
      .locator("a")
      .evaluateAll((links) =>
        links
          .filter(
            (link) =>
              !document.getElementById(link.getAttribute("href")!.slice(1)),
          )
          .map((link) => link.textContent),
      );
    expect(broken).toEqual([]);
    await narrow(page, 360);
    await capture(page, info.outputPath("architecture-mobile.png"));
  });
});
