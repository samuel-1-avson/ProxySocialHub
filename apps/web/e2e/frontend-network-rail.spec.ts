import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
import { mockMapResponse } from "./fixtures/marketplace-map";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const unifiedEnabled = ["1", "true", "yes"].includes(
  (process.env.NEXT_PUBLIC_UNIFIED_NETWORK ?? "").trim().toLowerCase(),
);

// F09: the network rail is honest about freshness and failure. It never
// claims to be live, signed-out and source-failure states are distinct
// from genuine inactivity, and nothing links into the retired feed.
test.describe("honest network rail", () => {
  test.skip(!unifiedEnabled, "Set NEXT_PUBLIC_UNIFIED_NETWORK=1 when starting the dev server");

  async function mockMap(page: import("@playwright/test").Page) {
    await page.route("**/v1/marketplace/map**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockMapResponse()),
      }),
    );
  }

  test("signed out: sign-in prompt for updates, proposals outage is not empty state", async ({ page }) => {
    test.setTimeout(120000);
    await mockMap(page);
    await page.route("**/v1/**", (route) =>
      route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }),
    );

    await page.goto(base + "/network", { waitUntil: "domcontentloaded" });
    const rail = page.getByTestId("network-activity-rail");
    await expect(rail).toBeVisible({ timeout: 60000 });
    await expect(rail.getByText("Recent updates", { exact: true })).toBeVisible();
    await expect(rail.getByText(/Sign in to see activity/)).toBeVisible();
    await expect(rail.getByText(/Proposals could not be loaded/)).toBeVisible();
    await expect(rail.getByText("No active proposals.")).toHaveCount(0);
    await expect(page.getByText("Live feed", { exact: true })).toHaveCount(0);
    await expect(
      rail.locator('a[href*="/community/feed"]'),
    ).toHaveCount(0);
  });

  test("signed in: recent updates with freshness, failure stays distinct from inactivity", async ({ page }) => {
    test.setTimeout(120000);
    await mockMap(page);
    await page.route("**/v1/**", (route) =>
      route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }),
    );
    await seedSignedAuth(page, base, "buyer");
    await page.route(/\/v1\/feed(\?.*)?$/, (route) =>
      route.fulfill({
        json: {
          events: [
            {
              id: "rail-event-1",
              event_type: "new_listing",
              content: "New listing in Frankfurt",
              created_at: "2026-11-01T10:30:00Z",
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        },
      }),
    );
    await page.route(/\/v1\/governance\/proposals(\?.*)?$/, (route) =>
      route.fulfill({ json: { proposals: [] } }),
    );

    await page.goto(base + "/network", { waitUntil: "domcontentloaded" });
    const rail = page.getByTestId("network-activity-rail");
    await expect(rail.getByText("New listing in Frankfurt")).toBeVisible({ timeout: 60000 });
    await expect(rail.getByText(/Updated .*refreshes every minute/)).toBeVisible();
    await expect(rail.getByText("No active proposals.")).toBeVisible();
    await expect(page.getByText("Live feed", { exact: true })).toHaveCount(0);
  });
});
