import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

// F04/F06: conversation pagination past the first 20, deep links to older
// conversations, chronological cursor history, read watermark, and the
// legacy ?to= recipient alias.
test("inbox reaches the 21st conversation, deep-links it, pages history and marks read up to what was shown", async ({ page }) => {
  test.setTimeout(120000);
  const targetId = "conv-21";
  const otherId = "history-other-user";
  const readBodies: Array<Record<string, unknown>> = [];

  const makeConversation = (n: number) => ({
    id: "conv-" + n,
    participant1: "buyer-route-policy-user",
    participant2: "other-" + n,
    last_message_at: "2026-11-01T10:00:00Z",
    other_participant: {
      id: "other-" + n,
      username: "person" + n,
      display_name: n === 21 ? "Zulu Twentyone" : "Person " + n,
    },
    last_message: {
      id: "lm-" + n,
      conversation_id: "conv-" + n,
      sender_id: "other-" + n,
      content: "preview " + n,
      created_at: "2026-11-01T10:00:00Z",
    },
    unread_count: 0,
  });
  const pageOne = Array.from({ length: 20 }, (_, i) => makeConversation(i + 1));
  const target = { ...makeConversation(21), participant2: otherId, unread_count: 2 };
  target.other_participant = { id: otherId, username: "zulu21", display_name: "Zulu Twentyone" };

  const m1 = { id: "hist-m1", conversation_id: targetId, sender_id: otherId, content: "oldest visible message", created_at: "2026-11-01T09:00:00Z" };
  const m2 = { id: "hist-m2", conversation_id: targetId, sender_id: otherId, content: "middle visible message", created_at: "2026-11-01T10:00:00Z" };
  const m3 = { id: "hist-m3", conversation_id: targetId, sender_id: otherId, content: "newest visible message", created_at: "2026-11-01T11:00:00Z" };

  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }),
  );
  await seedSignedAuth(page, base, "buyer");

  await page.route(/\/v1\/conversations(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const pageParam = Number(url.searchParams.get("page") || "1");
    if (pageParam <= 1) {
      return route.fulfill({ json: { conversations: pageOne, total: 21, page: 1, limit: 20, has_more: true } });
    }
    return route.fulfill({ json: { conversations: [target], total: 21, page: 2, limit: 20, has_more: false } });
  });
  await page.route(new RegExp(`/v1/conversations/${targetId}/messages(\\?.*)?$`), (route) => {
    const url = new URL(route.request().url());
    const before = url.searchParams.get("before");
    if (before === m2.id) {
      return route.fulfill({ json: { messages: [m1], total: 3, page: 1, limit: 50, has_more: false } });
    }
    return route.fulfill({ json: { messages: [m3, m2], total: 3, page: 1, limit: 50, has_more: true } });
  });
  await page.route(new RegExp(`/v1/conversations/${targetId}/read$`), (route) => {
    readBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { message: "Messages marked as read" } });
  });
  await page.route(new RegExp(`/v1/conversations/${targetId}(\\?.*)?$`), (route) =>
    route.fulfill({ json: target }),
  );

  // The 21st conversation is absent until the next page loads.
  await page.goto(base + "/messages", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /Person 1/ }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Zulu Twentyone")).toHaveCount(0);
  await page.getByRole("button", { name: "Load more conversations" }).click();
  await expect(page.getByText("Zulu Twentyone").first()).toBeVisible({ timeout: 30000 });

  // A fresh deep link to it works even though only page 1 loads initially.
  await page.goto(base + "/messages?conversation=" + targetId, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Zulu Twentyone" })).toBeVisible({ timeout: 30000 });

  // History renders chronologically and older messages load on demand.
  await expect(page.getByText("newest visible message", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("oldest visible message", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load older messages" }).click();
  await expect(page.getByText("oldest visible message", { exact: true })).toBeVisible({ timeout: 30000 });
  const rendered = await page.locator(".inbox-message p").allTextContents();
  expect(rendered).toEqual([
    "oldest visible message",
    "middle visible message",
    "newest visible message",
  ]);

  // Opening the thread acknowledged only up to the newest rendered message.
  await expect.poll(() => readBodies.length, { timeout: 30000 }).toBeGreaterThan(0);
  expect(readBodies[0]).toEqual({ up_to_message_id: m3.id });
});

test("the legacy ?to= recipient link still opens the composer without sending", async ({ page }) => {
  test.setTimeout(120000);
  let writes = 0;
  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/conversations")) writes++;
    return route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } });
  });
  await seedSignedAuth(page, base, "buyer");
  await page.route("**/v1/users/alex", (route) =>
    route.fulfill({ json: { id: "alex", username: "alex", display_name: "Alex" } }),
  );
  await page.route(/\/v1\/conversations(\?.*)?$/, (route) =>
    route.fulfill({ json: { conversations: [], total: 0, page: 1, limit: 20, has_more: false } }),
  );

  await page.goto(base + "/messages?to=alex", { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog", { name: "New message", exact: true });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await expect(dialog.getByRole("textbox", { name: "First message", exact: true })).toHaveValue("");
  expect(writes).toBe(0);
});
