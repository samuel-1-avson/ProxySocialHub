import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedSignedAuth } from "./fixtures/signed-auth";
import { stubMarketplaceListingDetail, verifiedMapListingId } from "./fixtures/marketplace-map";
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
async function prepare(page: Page, role: "buyer" | "both" = "buyer") {
 await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
 await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }));
 await seedSignedAuth(page, base, role);
 await page.setViewportSize({ width: 390, height: 844 });
 await page.addInitScript(() => localStorage.setItem("theme", "light"));
}
test("a listing inquiry preserves a rejected draft, confirms acceptance, and returns keyboard focus", async ({ page }) => {
 test.setTimeout(180000); await prepare(page); await stubMarketplaceListingDetail(page);
 let accept = false; let writes = 0;
 await page.route("**/v1/listings/" + verifiedMapListingId + "/inquire", (route) => {
  writes++; expect(route.request().postDataJSON()).toEqual({ message: "Can this offer support a month of usage?", intent: "testing", expected_gb: 50 });
  return route.fulfill(accept ? { json: { accepted: true } } : { status: 503, json: { error: "Inquiry was not accepted" } });
 });
 await page.goto(base + "/marketplace/" + verifiedMapListingId, { waitUntil: "domcontentloaded" });
 const trigger = page.getByRole("button", { name: "Message provider", exact: true });
 await trigger.click({ timeout: 30000 });
 const dialog = page.getByRole("dialog", { name: "Message E2E Seller", exact: true });
 await dialog.getByRole("combobox", { name: "Intended use" }).selectOption("testing");
 await dialog.getByRole("combobox", { name: "Expected monthly usage" }).selectOption("50");
 const draft = dialog.getByRole("textbox", { name: "Your message", exact: true });
 await draft.fill("Can this offer support a month of usage?");
 await dialog.getByRole("button", { name: "Send inquiry", exact: true }).click();
 await expect(dialog.getByRole("alert")).toHaveText("Inquiry was not accepted");
 await expect(draft).toHaveValue("Can this offer support a month of usage?"); expect(writes).toBe(1);
 expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
 accept = true; await dialog.getByRole("button", { name: "Send inquiry", exact: true }).click();
 const result = page.getByRole("dialog", { name: "Inquiry sent", exact: true });
 await expect(result).toBeVisible(); expect(writes).toBe(2);
 await result.getByRole("button", { name: "Done", exact: true }).click(); await expect(trigger).toBeFocused();
});
test("friend suggestions show a recoverable status failure before offering a request", async ({ page }) => {
 test.setTimeout(180000); await prepare(page);
 await page.route("**/v1/discover/people?limit=*", (route) => route.fulfill({ json: { suggestions: [{ id: "alex", username: "alex", display_name: "Alex", reason: "similar_skills", score: 1 }] } }));
 let statusAvailable = false; let accept = false; let writes = 0;
 await page.route("**/v1/friends/status/alex", (route) => route.fulfill(statusAvailable ? { json: { status: "none" } } : { status: 503, json: { error: "Status unavailable" } }));
 await page.route("**/v1/friends/request/alex", (route) => { writes++; return route.fulfill(accept ? { json: { id: "friend-request-alex" } } : { status: 503, json: { error: "Friend request was not accepted" } }); });
 await page.goto(base + "/community/friends", { waitUntil: "domcontentloaded" });
 const retry = page.getByRole("button", { name: "Retry status", exact: true }); await expect(retry).toBeVisible({ timeout: 30000 });
 await expect(page.getByRole("button", { name: "Add friend · Alex", exact: true })).toHaveCount(0); expect(writes).toBe(0);
 statusAvailable = true; await retry.click(); const add = page.getByRole("button", { name: "Add friend · Alex", exact: true }); await add.click();
 await expect(page.getByText("Friend request was not accepted", { exact: true })).toBeVisible(); await expect(add).toBeEnabled(); expect(writes).toBe(1);
 accept = true; await add.click(); await expect(add).toHaveCount(0); expect(writes).toBe(2);
});


test("a failed circle source is not presented as an empty pool collection", async ({ page }) => {
 test.setTimeout(120000); await prepare(page, "both");
 await page.goto(base + "/dashboard/provider/circle", { waitUntil: "domcontentloaded" });
 await expect(page.getByRole("heading", { name: "Circle pools", exact: true })).toBeVisible({ timeout: 30000 });
 await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
 await expect(page.getByText("No Active Circles Detected", { exact: true })).toHaveCount(0);
});


test("the public header fits 320px and keeps sign-in reachable from its keyboard menu", async ({ page }, info) => {
 test.setTimeout(120000);
 await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }));
 await page.setViewportSize({ width: 320, height: 844 });
 await page.addInitScript(() => localStorage.setItem("theme", "light"));
 await page.goto(base + "/whitepaper", { waitUntil: "domcontentloaded" });
 await expect(page.getByRole("button", { name: "Switch to dark theme", exact: true })).toBeEnabled({ timeout: 30000 });
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
 await expect(page.getByRole("link", { name: "ProxyHubb home", exact: true }).first()).toBeVisible();
 const menu = page.getByRole("button", { name: "Open navigation menu", exact: true });
 await menu.focus(); await page.keyboard.press("Enter");
 const nav = page.getByRole("navigation", { name: "Mobile primary", exact: true });
 await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
 await page.screenshot({ path: info.outputPath("public-navigation-320.png"), animations: "disabled" });
 await nav.getByRole("link", { name: "Sign in", exact: true }).click();
 await expect(page).toHaveURL(/\/login/); await expect(page.getByRole("heading", { name: /sign in/i }).last()).toBeVisible();
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
