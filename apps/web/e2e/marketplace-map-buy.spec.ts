import { expect, test } from "@playwright/test";
import {
  stubMarketplaceListingDetail,
  verifiedMapListingId,
  verifiedMapPoint,
} from "./fixtures/marketplace-map";
import {
  enableE2EMockBuy,
  mockProxyCredentials,
  openOrderCredentials,
  stubPurchaseApis,
} from "./fixtures/marketplace-purchase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:4011";

test.describe("marketplace map buy-from-map", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test("opens buy modal from map pin detail", async ({ page }) => {
    await stubMarketplaceListingDetail(page);

    await page.goto(
      `${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`,
      {
        waitUntil: "domcontentloaded",
      },
    );

    await expect(
      page.getByRole("heading", { name: verifiedMapPoint.title, level: 2 }),
    ).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("button", { name: /buy bandwidth/i }).click();

    const modal = page.getByTestId("buy-listing-modal");
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(
      modal.getByRole("heading", { name: /buy with sol/i }),
    ).toBeVisible();
    // The title is both the dialog description and the listing card heading.
    await expect(
      modal.getByRole("heading", { name: verifiedMapPoint.title }),
    ).toBeVisible();
  });

  test("requires actual listing terms before opening checkout and supports retry", async ({
    page,
  }) => {
    await stubMarketplaceListingDetail(page);
    let unavailable = true;
    await page.route(
      (url) =>
        url.pathname === "/v1/listings/" + verifiedMapListingId ||
        url.pathname === "/api/v1/listings/" + verifiedMapListingId,
      async (route) => {
        if (!unavailable) return route.fallback();
        await route.fulfill({
          status: 503,
          json: { error: "Listing terms are unavailable" },
        });
      },
    );
    await page.goto(
      BASE_URL + "/marketplace/map?listing=" + verifiedMapListingId,
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("heading", { name: verifiedMapPoint.title, level: 2 }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("marketplace-map-buy-btn").click();
    const error = page
      .getByRole("alert")
      .filter({ hasText: "Current offer terms are unavailable" });
    await expect(error).toBeVisible();
    await expect(page.getByTestId("buy-listing-modal")).toHaveCount(0);
    unavailable = false;
    await page.getByTestId("marketplace-map-buy-btn").click();
    await expect(page.getByTestId("buy-listing-modal")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("completes mocked purchase from map and shows proxy credentials", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceListingDetail(page);
    await stubPurchaseApis(page);

    await page.goto(
      `${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`,
      {
        waitUntil: "domcontentloaded",
      },
    );

    await expect(
      page.getByRole("heading", { name: verifiedMapPoint.title, level: 2 }),
    ).toBeVisible({
      timeout: 30000,
    });

    await page.getByRole("button", { name: /buy bandwidth/i }).click();
    await expect(page.getByTestId("buy-listing-modal")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("buy-listing-start-connection").click();

    await expect(page.getByTestId("buy-listing-modal-success")).toBeVisible({
      timeout: 20000,
    });
    const credentials = page.getByTestId("marketplace-order-credentials");
    await openOrderCredentials(credentials);
    await expect(credentials.getByText(mockProxyCredentials.endpoint.split(":")[0], { exact: true })).toBeVisible();
    await expect(
      credentials.getByText(mockProxyCredentials.username, { exact: true }).first(),
    ).toBeVisible();
  });
});
