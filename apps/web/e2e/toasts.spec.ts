import { expect, test, type Page } from "@playwright/test";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

type ToastApi = {
  success: (title: string, message?: string, o?: Record<string, unknown>) => string;
  error: (title: string, message?: string, o?: Record<string, unknown>) => string;
  info: (title: string, message?: string, o?: Record<string, unknown>) => string;
};
async function open(page: Page) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean((window as any).__proxyhubbToast));
}
const toast = (page: Page, fn: (t: ToastApi) => void) =>
  page.evaluate(`(${fn.toString()})(window.__proxyhubbToast)`);

test.describe("toast notifications", () => {
  test.setTimeout(120_000);

  test("shows at most three, queues the rest, and de-duplicates repeats", async ({ page }) => {
    await open(page);
    await toast(page, (t) => {
      t.info("One", "first", { duration: 0 });
      t.info("Two", "second", { duration: 0 });
      t.info("Three", "third", { duration: 0 });
      t.info("Four", "fourth", { duration: 0 });
      t.info("Four", "fourth", { duration: 0 });
    });
    const region = page.getByRole("region", { name: "Notifications" });
    await expect(region.locator(".toast")).toHaveCount(3);
    await expect(region.getByText("One", { exact: true })).toHaveCount(0);
    await expect(region.getByText("1 more waiting")).toBeVisible();
    await expect(region.getByText("Four", { exact: true })).toHaveCount(1);
    // Dismissing one lets the waiting toast in.
    await region.getByRole("button", { name: "Dismiss: Four" }).click();
    await expect(region.getByText("One", { exact: true })).toBeVisible();
  });

  test("errors are announced as alerts, and an action dismisses the toast", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      (window as any).__retried = 0;
      (window as any).__proxyhubbToast.error("Could not save", "Try again.", {
        duration: 0,
        action: { label: "Retry", onClick: () => ((window as any).__retried += 1) },
      });
    });
    const alert = page.getByRole("alert").filter({ hasText: "Could not save" });
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__retried)).toBe(1);
  });

  test("hovering pauses the timer, and it leaves on its own afterwards", async ({ page }) => {
    await open(page);
    await toast(page, (t) => {
      t.success("Saved", "All changes stored.", { duration: 1500 });
    });
    const item = page.locator(".toast", { hasText: "Saved" });
    await expect(item).toBeVisible();
    await item.hover();
    await page.waitForTimeout(2500);
    await expect(item).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(item).toHaveCount(0, { timeout: 5000 });
  });

  test("sits above the tab bar on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await toast(page, (t) => {
      t.success("Copied", "Join command copied.", { duration: 0 });
    });
    const box = await page.locator(".toast-region").boundingBox();
    expect(box).not.toBeNull();
    // The tab bar is about 64px tall; the toast must end above it.
    expect(844 - (box!.y + box!.height)).toBeGreaterThanOrEqual(64);
    expect(box!.x).toBeGreaterThanOrEqual(8);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 - 8);
  });
});
