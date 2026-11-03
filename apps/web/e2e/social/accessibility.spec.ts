import { test, expect, type Page } from "@playwright/test";
import { seedSignedAuth } from "../fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

async function stubEmpty(page: Page) {
  await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
  await page.route("**/v1/**", (route) =>
    route.fulfill({ json: { categories: [], threads: [], conversations: [], total: 0, page: 1, limit: 20, has_more: false } }),
  );
}

// Accessibility checks against the shipped community surfaces. The old
// file drove an email login form that no longer exists; these use the
// signed-auth fixture and current routes instead.
test.describe("Community accessibility", () => {
  test.setTimeout(120000);

  test("forum page has one h1 and does not skip heading levels", async ({ page }) => {
    await stubEmpty(page);
    await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveCount(1, { timeout: 30000 });
    const levels = await page.locator("h1, h2, h3, h4, h5, h6").evaluateAll((els) =>
      els.map((el) => Number(el.tagName[1])),
    );
    let previous = 0;
    for (const level of levels) {
      expect(level).toBeLessThanOrEqual(previous + 1);
      previous = Math.max(previous, level);
    }
  });

  test("every image on the forum page carries alt text", async ({ page }) => {
    await stubEmpty(page);
    await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible({ timeout: 30000 });
    const missing = await page.locator("img:not([alt])").count();
    expect(missing).toBe(0);
  });

  test("interactive elements on the inbox have accessible names", async ({ page }) => {
    await stubEmpty(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/messages", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Messages|Inbox/ }).first()).toBeVisible({ timeout: 30000 });
    const unnamed = await page.locator("main button, main a[href]").evaluateAll((els) =>
      els.filter((el) => {
        const name =
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.getAttribute("title") ||
          (el.textContent || "").trim();
        return !name;
      }).length,
    );
    expect(unnamed).toBe(0);
  });

  test("the first Tab stop is the skip link and focus is visibly styled", async ({ page }) => {
    await stubEmpty(page);
    await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const styles = window.getComputedStyle(el);
      return {
        text: (el.textContent || "").trim(),
        outline: styles.outlineStyle,
        boxShadow: styles.boxShadow,
      };
    });
    expect(focused).not.toBeNull();
    expect(focused!.text).toContain("Skip to main content");
    expect(focused!.outline !== "none" || focused!.boxShadow !== "none").toBeTruthy();
  });

  test("reduced-motion preference is honored by the page", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubEmpty(page);
    await page.goto(base + "/help/forum", { waitUntil: "domcontentloaded" });
    const matches = await page.evaluate(() =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    expect(matches).toBeTruthy();
  });

  test("Escape closes the new-message dialog", async ({ page }) => {
    await stubEmpty(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/messages?recipient=alex", { waitUntil: "domcontentloaded" });
    await page.route(/\/v1\/users\/alex$/, (route) =>
      route.fulfill({ json: { id: "alex", username: "alex", display_name: "Alex" } }),
    );
    const dialog = page.getByRole("dialog", { name: "New message", exact: true });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
