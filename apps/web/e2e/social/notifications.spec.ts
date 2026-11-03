import { test, expect, type Page } from "@playwright/test";
import { seedSignedAuth } from "../fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const me = "buyer-route-policy-user";

const sampleNotification = {
  id: "n1",
  user_id: me,
  type: "friend_request",
  title: "New friend request",
  body: "Ron Asker wants to connect",
  is_read: false,
  channels_delivered: ["in_app"],
  created_at: "2026-11-01T10:00:00Z",
};

async function stubNotificationCenter(page: Page) {
  const calls = { readAll: 0 };
  let unread = 1;
  await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Not available in this test" } }),
  );
  await page.route(/\/v1\/notifications\?/, (route) =>
    route.fulfill({
      json: { notifications: unread ? [sampleNotification] : [{ ...sampleNotification, is_read: true }], total: 1, page: 1, limit: 100 },
    }),
  );
  await page.route(/\/v1\/notifications\/unread-count$/, (route) =>
    route.fulfill({ json: { count: unread } }),
  );
  await page.route(/\/v1\/notifications\/read-all$/, (route) => {
    calls.readAll += 1;
    unread = 0;
    return route.fulfill({ json: { message: "All notifications marked as read" } });
  });
  return calls;
}

// The NotificationCenter bell is mounted in WorkspaceHeader.
test.describe("Notification center", () => {
  test.setTimeout(120000);

  test("bell shows the unread count, opens the menu, and Escape closes it", async ({ page }) => {
    await stubNotificationCenter(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/marketplace", { waitUntil: "domcontentloaded" });

    const bell = page.getByRole("button", { name: /Notifications \(1 unread\)/ });
    await expect(bell).toBeVisible({ timeout: 30000 });
    await bell.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByText("Ron Asker wants to connect")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("mark all as read clears the unread badge", async ({ page }) => {
    const calls = await stubNotificationCenter(page);
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/marketplace", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /Notifications/ }).first().click();
    await page.getByRole("button", { name: "Mark all notifications as read" }).click();
    await expect.poll(() => calls.readAll).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Notifications", exact: true }),
    ).toBeVisible({ timeout: 30000 });
  });
});

const fullPreferences = {
  user_id: me,
  social_in_app: true,
  social_email: false,
  social_push: false,
  business_in_app: true,
  business_email: false,
  business_push: false,
  community_in_app: true,
  community_email: false,
  community_push: false,
  system_in_app: true,
  system_email: false,
  system_push: false,
  email_digest_frequency: "immediate",
  digest_day: "monday",
  digest_hour: 9,
  updated_at: "2026-11-01T10:00:00Z",
};

test.describe("Notification settings", () => {
  test.setTimeout(120000);

  test("toggling a live channel and changing digest frequency save via the API", async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
    await page.route("**/v1/**", (route) =>
      route.fulfill({ status: 503, json: { error: "Not available in this test" } }),
    );
    await page.route(/\/v1\/notification-preferences$/, (route) => {
      if (route.request().method() === "PUT" || route.request().method() === "PATCH") {
        puts.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { ...fullPreferences, ...puts[puts.length - 1] } });
      }
      return route.fulfill({ json: fullPreferences });
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/app/settings?tab=preferences", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByLabel("Social activity in app").uncheck();
    await page.getByLabel(/Email digest/).selectOption("daily");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect.poll(() => puts.length).toBeGreaterThan(0);
    expect(puts[puts.length - 1]).toMatchObject({
      social_in_app: false,
      email_digest_frequency: "daily",
    });
    await expect(page.getByText("Preferences saved.")).toBeVisible({ timeout: 30000 });
  });
});
