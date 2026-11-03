import { expect, test } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:4011";

// The embedded Explorer was retired: every /explorer/* URL now redirects
// to the standalone explorer. These tests pin that contract (the old
// suite drove the removed embedded UI and could only fail).
test.describe("explorer redirects", () => {
  test.setTimeout(120_000);

  for (const [from, to] of [
    ["/explorer", "https://explorer.proxyhubb.com/"],
    ["/explorer/map", "https://explorer.proxyhubb.com/nodes?view=map"],
    ["/explorer/search", "https://explorer.proxyhubb.com/search"],
  ] as const) {
    test(`${from} redirects to the standalone explorer`, async ({ page }) => {
      await page.route("**://explorer.proxyhubb.com/**", (route) =>
        route.fulfill({ status: 200, contentType: "text/html", body: "<main>standalone explorer</main>" }),
      );
      await page.goto(`${BASE_URL}${from}`, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(to, { timeout: 30_000 });
    });
  }
});
