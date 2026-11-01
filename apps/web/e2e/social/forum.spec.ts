import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "../fixtures/signed-auth";
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
test.describe("canonical forum navigation", () => {
 test.setTimeout(120000);
 test("legacy collection links retain their filter and page", async ({ page }) => {
  await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
  await page.route("**/v1/**", (route) => route.fulfill({ json: { categories: [], threads: [], total: 0, page: 2, limit: 20 } }));
  await seedSignedAuth(page, base, "buyer");
  for (const [legacy, key, value] of [["recent", "sort", "recent"], ["popular", "sort", "popular"], ["unanswered", "filter", "unanswered"], ["my-posts", "filter", "mine"]]) {
   await page.goto(base + "/community/forum/" + legacy + "?page=2", { waitUntil: "domcontentloaded" });
   const url = new URL(page.url()); expect(url.pathname).toBe("/help/forum"); expect(url.searchParams.get(key)).toBe(value); expect(url.searchParams.get("page")).toBe("2");
  }
 });
 test("legacy category links preserve the category and pagination", async ({ page }) => {
  await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
  await page.route("**/v1/**", (route) => route.fulfill({ json: { categories: [], category: { id: "networking", slug: "networking", name: "Networking", description: "Network discussion", is_locked: false, thread_count: 0 }, threads: [], total: 0, page: 3, limit: 20 } }));
  await page.goto(base + "/community/forum/category/networking?page=3", { waitUntil: "domcontentloaded" });
  const url = new URL(page.url()); expect(url.pathname).toBe("/help/forum/category/networking"); expect(url.searchParams.get("page")).toBe("3");
  await expect(page.locator("main")).toBeVisible();
 });
});
