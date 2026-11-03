import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

// F08: one canonical community navigation. The workspace sidebar links to
// canonical destinations (Discussions at /help/forum, Messages, People,
// Network status, Governance), the retired activity feed is not promoted,
// and the active state follows canonical forum paths.
test("community navigation is canonical and active state follows /help/forum", async ({ page }) => {
  test.setTimeout(120000);
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }),
  );
  await seedSignedAuth(page, base, "buyer");
  await page.route(/\/v1\/forum\/categories(\?.*)?$/, (route) =>
    route.fulfill({ json: { categories: [] } }),
  );
  await page.route(/\/v1\/forum\/recent(\?.*)?$/, (route) =>
    route.fulfill({ json: { threads: [], total: 0, page: 1, limit: 20, has_more: false } }),
  );

  await page.goto(base + "/app", { waitUntil: "domcontentloaded" });
  const communityNav = page.getByRole("navigation", { name: "Community and network" });
  await expect(communityNav).toBeVisible({ timeout: 30000 });

  const expected: Array<[string, string]> = [
    ["Discussions", "/help/forum"],
    ["Messages", "/messages"],
    ["People", "/community/friends"],
    ["Network status", "/network"],
    ["Governance", "/governance"],
  ];
  for (const [label, href] of expected) {
    await expect(
      communityNav.getByRole("link", { name: label }),
    ).toHaveAttribute("href", href);
  }
  await expect(communityNav.getByRole("link", { name: /feed/i })).toHaveCount(0);
  const hrefs = await communityNav.getByRole("link").evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  expect(hrefs.some((href) => href.includes("/community/feed"))).toBe(false);
  expect(hrefs.some((href) => href.startsWith("/community/forum"))).toBe(false);

  await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
  await expect(
    communityNav.getByRole("link", { name: "Discussions" }),
  ).toHaveAttribute("aria-current", "page", { timeout: 30000 });
});
