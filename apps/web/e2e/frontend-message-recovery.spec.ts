import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";
const base = process.env.TEST_BASE_URL || "http://localhost:4011";
test("an accepted first message survives a failed inbox preview refresh without a second send", async ({ page }) => {
 test.setTimeout(120000);
 await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
 await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Preview source unavailable" } }));
 await seedSignedAuth(page, base, "buyer");
 let accepted = false; let writes = 0;
 const message = "Please confirm your available region.";
 await page.route("**/v1/users/alex", (route) => route.fulfill({ json: { id: "alex", username: "alex", display_name: "Alex" } }));
 await page.route("**/v1/conversations", (route) => {
  if (route.request().method() === "POST") { writes++; expect(route.request().postDataJSON()).toEqual({ recipient_id: "alex", message, client_msg_id: expect.any(String) }); accepted = true; return route.fulfill({ json: { conversation_id: "accepted-conversation" } }); }
  return route.fulfill(accepted ? { status: 503, json: { error: "Preview refresh unavailable" } } : { json: { conversations: [] } });
 });
 await page.route(/\/v1\/conversations\/accepted-conversation\/messages(?:\?.*)?$/, (route) => route.fulfill({ json: { messages: [{ id: "accepted-message", conversation_id: "accepted-conversation", sender_id: "buyer-route-policy-user", content: message, created_at: "2026-11-01T10:00:00Z" }] } }));
 await page.goto(base + "/messages?recipient=alex", { waitUntil: "domcontentloaded" });
 const dialog = page.getByRole("dialog", { name: "New message", exact: true });
 await expect(dialog).toBeVisible({ timeout: 30000 }); expect(writes).toBe(0);
 await dialog.getByRole("textbox", { name: "First message", exact: true }).fill("  " + message + "  ");
 await expect(dialog.getByRole("button", { name: "Start conversation", exact: true })).toBeEnabled({ timeout: 30000 });
 await dialog.getByRole("button", { name: "Start conversation", exact: true }).click();
 await expect(page).toHaveURL(/conversation=accepted-conversation/, { timeout: 30000 });
 await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 30000 }); expect(writes).toBe(1);
});


test("stored light and dark themes hydrate without rebuilding the page", async ({ page }) => {
 test.setTimeout(120000);
 const errors: string[] = [];
 page.on("pageerror", (error) => errors.push(error.message));
 await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }));
 for (const theme of ["light", "dark"]) {
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.goto(base + "/whitepaper", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator("html")).toHaveClass(new RegExp(theme));
 }
 expect(errors).toEqual([]);
});
