import { expect, test } from "@playwright/test";
import { stubMarketplaceBrowse } from "./fixtures/marketplace-browse";
import {
  e2eOrderId,
  enableE2EMockBuy,
  mockProxyCredentials,
  stubPurchaseApis,
} from "./fixtures/marketplace-purchase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:4011";

test.describe("focused marketplace purchase", () => {
  test.setTimeout(150_000);
  async function openCheckout(page: import("@playwright/test").Page) {
    await page.goto(`${BASE_URL}/marketplace`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "View details" }).first().click();
    await page.getByRole("button", { name: "Buy bandwidth" }).click();
    await expect(
      page.getByRole("heading", { name: "Review purchase" }),
    ).toBeVisible();
  }
  test("reviews an offer before requesting escrow funding", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceBrowse(page);
    await openCheckout(page);
    await expect(page.getByTestId("buy-listing-start-connection")).toHaveText(
      /Fund escrow/,
    );
    await expect(page.getByText("Bandwidth held in escrow")).toBeVisible();
  });
  test("completes mocked escrow flow and opens the real order credentials screen", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceBrowse(page);
    await stubPurchaseApis(page);
    await page.route(`**/v1/orders/${e2eOrderId}/confirm-escrow`, (r) =>
      r.fulfill({ json: { order: { id: e2eOrderId, status: "active" } } }),
    );
    await openCheckout(page);
    await page.getByTestId("buy-listing-start-connection").click();
    await expect(page).toHaveURL(
      new RegExp(`/app/connections/${e2eOrderId}$`),
      { timeout: 30_000 },
    );
    await expect(
      page.getByTestId("marketplace-order-credentials"),
    ).toContainText(mockProxyCredentials.endpoint);
  });
  test("retries an existing order after a failed payment confirmation without creating another", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceBrowse(page);
    await stubPurchaseApis(page);
    let created = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/v1\/orders$/.test(new URL(request.url()).pathname)
      )
        created++;
    });
    await page.route(`**/v1/orders/${e2eOrderId}/confirm-escrow`, (r) =>
      r.fulfill({
        status: 503,
        json: { error: "Temporary confirmation outage" },
      }),
    );
    await openCheckout(page);
    await page.getByTestId("buy-listing-start-connection").click();
    await expect(
      page.getByRole("link", { name: "Review existing order" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("buy-listing-start-connection").click();
    await expect(page).toHaveURL(
      new RegExp(`/app/connections/${e2eOrderId}$`),
      { timeout: 30_000 },
    );
    expect(created).toBe(1);
  });
  test("requests catalog products and keeps the useful product badge", async ({
    page,
  }) => {
    await stubMarketplaceBrowse(page);
    const request = page.waitForRequest(
      (r) =>
        /\/v1\/listings$/.test(new URL(r.url()).pathname) &&
        new URL(r.url()).searchParams.get("include") === "product",
    );
    await page.goto(`${BASE_URL}/marketplace`, {
      waitUntil: "domcontentloaded",
    });
    await request;
    await expect(
      page.getByTestId("catalog-product-badge").first(),
    ).toHaveAttribute("title", "Premium Austin Pool");
    await expect(page.getByTestId("marketplace-featured-strip")).toHaveCount(0);
  });
  test("applies a country filter to the inventory request and URL", async ({
    page,
  }) => {
    await stubMarketplaceBrowse(page);
    await page.goto(`${BASE_URL}/marketplace`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId("marketplace-filter-country").fill("US");
    const request = page.waitForRequest(
      (r) =>
        /\/v1\/listings$/.test(new URL(r.url()).pathname) &&
        new URL(r.url()).searchParams.get("country") === "US",
    );
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await request;
    await expect(page).toHaveURL(/country=US/);
  });
});
