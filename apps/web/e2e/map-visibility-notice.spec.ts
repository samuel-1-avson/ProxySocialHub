import { expect, test, type Page } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
import { mockMapResponse, stubListingAuxApis, verifiedMapListingId, verifiedMapPoint } from "./fixtures/marketplace-map";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

const ownListing = {
  id: verifiedMapListingId,
  seller_id: "provider-route-policy-user",
  title: verifiedMapPoint.title,
  description: "",
  proxy_type: "residential",
  protocol: "http",
  country: "US",
  price_per_gb: 0.0025,
  min_purchase_gb: 1,
  available_bandwidth_gb: 50,
  max_concurrency: 10,
  status: "active",
  created_at: "2026-11-04T04:47:46Z",
  updated_at: "2026-11-04T04:47:46Z",
};

/**
 * A seller whose privacy setting keeps them off the public map: the map API
 * leaves their listing out until map_visible is turned on.
 */
async function stubSeller(page: Page, { listings = [ownListing] } = {}) {
  const calls = { privacyGets: 0, privacyPuts: [] as unknown[], mapGets: 0 };
  let privacy = { map_visible: false, map_precision: "country" };
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Not used in this fixture" } }),
  );
  await seedSignedAuth(page, base, "provider");
  await page.route("**/v1/marketplace/map**", (route) => {
    calls.mapGets++;
    const body = privacy.map_visible
      ? mockMapResponse()
      : { points: [], total: 0, listing_count: 0, node_count: 0 };
    return route.fulfill({ json: { ...body, generated_at: new Date().toISOString() } });
  });
  await page.route("**/v1/listings/facets**", (route) =>
    route.fulfill({ json: { countries: [], proxy_types: [], isps: null, price_buckets: [] } }),
  );
  await page.route("**/v1/listings/my**", (route) =>
    route.fulfill({ json: { listings, total: listings.length, page: 1, limit: 20 } }),
  );
  await page.route("**/v1/profile/privacy", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      calls.privacyPuts.push(body);
      privacy = { ...privacy, ...body };
    } else {
      calls.privacyGets++;
    }
    return route.fulfill({ json: privacy });
  });
  await stubListingAuxApis(page, verifiedMapListingId);
  return calls;
}

test.describe("map visibility notice", () => {
  test.setTimeout(180_000);

  test("tells a hidden seller why the map is empty and puts the offer on the map with one click", async ({ page }, info) => {
    const calls = await stubSeller(page);
    await page.goto(`${base}/marketplace/map`, { waitUntil: "domcontentloaded" });

    const notice = page.getByTestId("map-visibility-notice");
    await expect(notice.getByRole("heading", { name: "Your listings are not on the map" })).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText("country area");
    await expect(notice.getByRole("link", { name: "Privacy settings" })).toHaveAttribute("href", "/app/settings?tab=privacy");
    await expect(page.getByTestId("map-empty-note")).toContainText("Providers choose whether their offers appear here");
    await page.screenshot({ path: info.outputPath("map-hidden-seller.png"), fullPage: true });

    const mapGetsBefore = calls.mapGets;
    await notice.getByRole("button", { name: "Show my listings on the map" }).click();

    await expect(page.getByRole("status").filter({ hasText: "now appear on the public map at country area precision" })).toBeVisible();
    // Only the one setting changes; the rest of the privacy record is untouched.
    expect(calls.privacyPuts).toEqual([{ map_visible: true }]);
    await expect(page.getByRole("heading", { name: "In view (1)" })).toBeVisible();
    await expect(page.getByTestId("map-empty-note")).toHaveCount(0);
    expect(calls.mapGets).toBeGreaterThan(mapGetsBefore);
    await page.screenshot({ path: info.outputPath("map-seller-visible.png"), fullPage: true });
  });

  test("stays quiet for a signed-in user with no listings", async ({ page }) => {
    const calls = await stubSeller(page, { listings: [] });
    await page.goto(`${base}/marketplace/map`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("map-empty-note")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("map-visibility-notice")).toHaveCount(0);
    expect(calls.privacyGets).toBe(0);
  });

  test("shows on the seller's listings page", async ({ page }) => {
    await stubSeller(page);
    await page.goto(`${base}/provider/listings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Your listings are not on the map" })).toBeVisible({ timeout: 60_000 });
  });
});
