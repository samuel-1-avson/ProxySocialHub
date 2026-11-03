import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

const MUTUAL_ID = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "33333333-3333-4333-8333-333333333333";

// F10: suggestions explain themselves with honest reasons, and dismissing
// one is persisted server-side so it stays gone on the next load.
test.describe("suggestion reasons and dismissal", () => {
  test("shows mutual-friend and new-member reasons; dismissal persists across reload", async ({ page }) => {
    test.setTimeout(120000);
    const dismissed: string[] = [];
    const suggestions = [
      {
        id: MUTUAL_ID,
        username: "mutualpete",
        display_name: "Mutual Pete",
        avatar_url: null,
        bio: null,
        followers_count: 0,
        is_following: false,
        mutual_count: 3,
        reason: "mutual_friends",
      },
      {
        id: NEW_ID,
        username: "newnina",
        display_name: "New Nina",
        avatar_url: null,
        bio: null,
        followers_count: 0,
        is_following: false,
        mutual_count: 0,
        reason: "new_member",
      },
    ];

    await page.route("**/v1/**", (route) =>
      route.fulfill({ status: 200, json: {} }),
    );
    await page.route(/\/v1\/friends(\/.*)?$/, (route) =>
      route.fulfill({ json: { status: "none", friends: [] } }),
    );
    await page.route(/\/v1\/discover\/people(\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          suggestions: suggestions.filter((s) => !dismissed.includes(s.id)),
          total: suggestions.length - dismissed.length,
          page: 1,
          limit: 5,
          total_pages: 1,
        },
      }),
    );
    await page.route(/\/v1\/discover\/people\/[^/]+\/dismiss$/, (route) => {
      const match = route.request().url().match(/people\/([^/]+)\/dismiss/);
      if (match) dismissed.push(match[1]);
      return route.fulfill({ status: 204, body: "" });
    });

    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/community/friends", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("@Mutual Pete")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("3 mutual friends")).toBeVisible();
    await expect(page.getByText("@New Nina")).toBeVisible();
    await expect(page.getByText("New to ProxyHubb")).toBeVisible();
    await expect(page.getByText("Similar skills")).toHaveCount(0);

    await page
      .getByRole("button", { name: "Dismiss suggestion for New Nina" })
      .click();
    await expect(page.getByText("@New Nina")).toHaveCount(0);
    expect(dismissed).toEqual([NEW_ID]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("@Mutual Pete")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("@New Nina")).toHaveCount(0);
  });
});
