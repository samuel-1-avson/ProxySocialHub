import { expect, test } from "@playwright/test";
import {
  mockBrowseListingsResponse,
  stubMarketplaceBrowse,
} from "./fixtures/marketplace-browse";
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
      page.getByRole("heading", { name: "Buy with SOL" }),
    ).toBeVisible({ timeout: 30_000 });
  }
  test("reviews an offer before requesting escrow funding", async ({
    page,
  }) => {
    await enableE2EMockBuy(page, BASE_URL);
    await stubMarketplaceBrowse(page);
    await openCheckout(page);
    await expect(page.getByTestId("buy-listing-start-connection")).toHaveText(
      /Pay with SOL/,
    );
    await expect(page.getByText("Held safely until you use it")).toBeVisible();
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
    await page.getByTestId("marketplace-order-credentials").getByText("Use in another app or device").click();
    await expect(page.getByTestId("marketplace-order-credentials")).toContainText(mockProxyCredentials.endpoint.split(":")[0]);
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
    await page.goBack();
    await expect(page).toHaveURL(`${BASE_URL}/marketplace`);
    await expect(page.getByTestId("marketplace-filter-country")).toHaveValue(
      "",
    );
  });
  test("limits comparisons to three offers and lets buyers remove a selection", async ({
    page,
  }, info) => {
    await stubMarketplaceBrowse(page);
    const listing = mockBrowseListingsResponse().listings[0];
    await page.route(
      (url) => url.pathname.endsWith("/v1/listings"),
      (route) =>
        route.fulfill({
          json: {
            listings: [1, 2, 3, 4].map((index) => ({
              ...listing,
              id: "compare-" + index,
              title: "Provider offer " + index,
            })),
            total: 4,
            page: 1,
          },
        }),
    );
    await page.goto(`${BASE_URL}/marketplace`, {
      waitUntil: "domcontentloaded",
    });
    for (let index = 0; index < 3; index++)
      await page
        .getByRole("button", { name: "Add to comparison", exact: true })
        .first()
        .click();
    await expect(
      page
        .getByTestId("listing-compare-1")
        .getByText("Provider offer 1", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add to comparison", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Selected for comparison", exact: true })
      .first()
      .click();
    await expect(
      page
        .getByRole("button", { name: "Add to comparison", exact: true })
        .first(),
    ).toBeEnabled();
    await page.addStyleTag({
      content:
        "nextjs-portal, .tsqd-parent-container { display: none !important; }",
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath("marketplace-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("marketplace-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Compare offers", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("row")).toHaveCount(3);
  });
});
