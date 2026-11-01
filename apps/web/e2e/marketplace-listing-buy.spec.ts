import { expect, test } from "@playwright/test";
import {
  mockListingDetail,
  stubMarketplaceListingDetail,
  verifiedMapListingId,
} from "./fixtures/marketplace-map";
import {
  e2eOrderId,
  enableE2EMockBuy,
  mockProxyCredentials,
  stubPurchaseApis,
} from "./fixtures/marketplace-purchase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:4011";

test.describe("marketplace listing detail buy", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test("opens buy modal from listing detail page", async ({ page }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceListingDetail(page);

    await page.goto(`${BASE_URL}/marketplace/${verifiedMapListingId}`, {
      waitUntil: "domcontentloaded",
    });

    const expectedTitle =
      mockListingDetail().catalog_product?.title || mockListingDetail().title;
    await expect(
      page.getByRole("heading", { name: expectedTitle as string }),
    ).toBeVisible({
      timeout: 15000,
    });

    await page.getByRole("button", { name: /buy bandwidth/i }).click();

    const modal = page.getByTestId("buy-listing-modal");
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(
      modal.getByRole("heading", { name: /review purchase/i }),
    ).toBeVisible();
    await expect(modal.getByTestId("buy-estimated-total")).toHaveText(
      "$0.0025",
    );
  });

  test("completes mocked purchase from listing detail", async ({ page }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceListingDetail(page);
    await stubPurchaseApis(page);

    await page.goto(`${BASE_URL}/marketplace/${verifiedMapListingId}`, {
      waitUntil: "domcontentloaded",
    });

    await page.getByRole("button", { name: /buy bandwidth/i }).click();
    await expect(page.getByTestId("buy-listing-modal")).toBeVisible({
      timeout: 15000,
    });

    await page.getByTestId("buy-listing-start-connection").click();

    await expect(page).toHaveURL(
      new RegExp("/app/connections/" + e2eOrderId + "$"),
      { timeout: 30_000 },
    );
    await expect(page.getByTestId("extension-connect-card")).toBeVisible();
    await expect(
      page.getByText(mockProxyCredentials.endpoint, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(mockProxyCredentials.username, { exact: true }),
    ).toBeVisible();
  });
  test("does not invent a purchase minimum when listing terms are missing", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceListingDetail(page);
    await page.route(
      (url) => url.pathname.endsWith("/v1/listings/" + verifiedMapListingId),
      (route) =>
        route.fulfill({
          json: {
            listing: mockListingDetail({ min_purchase_gb: null }),
            is_saved: false,
          },
        }),
    );
    await page.goto(BASE_URL + "/marketplace/" + verifiedMapListingId, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Buy bandwidth", exact: true })
      .click();
    const modal = page.getByTestId("buy-listing-modal");
    await expect(
      modal
        .getByRole("alert")
        .filter({ hasText: "Purchase terms are unavailable" }),
    ).toBeVisible();
    await expect(
      modal.getByTestId("buy-listing-start-connection"),
    ).toBeDisabled();
    await expect(modal.getByText("Min: — GB", { exact: true })).toBeVisible();
    await expect(modal.getByTestId("buy-estimated-total")).toHaveText("—");
  });
  test("honors a published zero minimum while preventing a zero-bandwidth order", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceListingDetail(page);
    await page.route(
      (url) => url.pathname.endsWith("/v1/listings/" + verifiedMapListingId),
      (route) =>
        route.fulfill({
          json: {
            listing: mockListingDetail({ min_purchase_gb: 0 }),
            is_saved: false,
          },
        }),
    );
    await page.goto(BASE_URL + "/marketplace/" + verifiedMapListingId, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("No minimum", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Buy bandwidth", exact: true })
      .click();
    const modal = page.getByTestId("buy-listing-modal");
    await expect(
      modal.getByText("Min: No minimum", { exact: true }),
    ).toBeVisible();
    const quota = modal.getByRole("slider", { name: "Bandwidth quota" });
    await expect(quota).toHaveValue("1");
    await quota.press("Home");
    await expect(quota).toHaveValue("0");
    await expect(
      modal.getByTestId("buy-listing-start-connection"),
    ).toBeDisabled();
    await quota.press("ArrowRight");
    await expect(
      modal.getByTestId("buy-listing-start-connection"),
    ).toBeEnabled();
  });
});
