import { test, expect, type Page } from "@playwright/test";
import { seedSignedAuth } from "../fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const me = "buyer-route-policy-user";
const alex = { id: "alex", username: "alex", display_name: "Alex" };

type Row = Record<string, unknown>;
const message = (id: string, from: string, content: string, minute: number, extra: Row = {}): Row => ({
  id,
  conversation_id: "c1",
  sender_id: from,
  content,
  created_at: `2026-11-01T10:${String(minute).padStart(2, "0")}:00Z`,
  ...extra,
});
const conversation = (id: string, over: Row = {}): Row => ({
  id,
  participant1: me,
  participant2: alex.id,
  last_message_at: "2026-11-01T10:09:00Z",
  other_participant: alex,
  unread_count: 0,
  ...over,
});

async function stub(
  page: Page,
  options: {
    conversations?: Row[][]; // one array per page
    messagePages?: Row[][]; // newest first, as the API sends them
    total?: number;
  },
) {
  await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
  await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Not available in this test" } }));
  const calls = { read: 0, sent: [] as string[], conversationPages: [] as string[] };
  await page.route(/\/v1\/conversations(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const pageNo = url.searchParams.get("page") ?? "1";
    calls.conversationPages.push(pageNo);
    const rows = options.conversations?.[Number(pageNo) - 1] ?? [];
    return route.fulfill({ json: { conversations: rows, total: rows.length, page: Number(pageNo), limit: 20 } });
  });
  await page.route(/\/v1\/conversations\/[^/]+\/messages(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const content = (request.postDataJSON() as { content: string }).content;
      calls.sent.push(content);
      return route.fulfill({ status: 201, json: message("sent-1", me, content, 30) });
    }
    // The API pages history by cursor: no `before` gets the newest page,
    // `before=<oldest id>` continues strictly older than it.
    const url = new URL(request.url());
    const before = url.searchParams.get("before");
    const pages = options.messagePages ?? [];
    if (!before) {
      const rows = pages[0] ?? [];
      return route.fulfill({
        json: { messages: rows, total: options.total ?? rows.length, page: 1, limit: 50, has_more: pages.length > 1 },
      });
    }
    const rows = pages[1] ?? [];
    return route.fulfill({
      json: { messages: rows, total: options.total ?? rows.length, page: 1, limit: 50, has_more: false },
    });
  });
  await page.route(/\/v1\/conversations\/[^/]+\/read$/, (route) => {
    calls.read += 1;
    return route.fulfill({ json: { message: "Messages marked as read" } });
  });
  return calls;
}

test.describe("messages", () => {
  test.setTimeout(150_000);

  test("reads oldest to newest, loads earlier messages above, and clears unread", async ({ page }) => {
    const calls = await stub(page, {
      conversations: [[conversation("c1", { unread_count: 2 })]],
      // The API sends the newest first.
      messagePages: [
        [message("m3", alex.id, "Third message", 3), message("m2", me, "Second message", 2)],
        [message("m1", alex.id, "First message", 1)],
      ],
      total: 3,
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/messages?conversation=c1`, { waitUntil: "domcontentloaded" });

    const log = page.getByRole("log", { name: "Messages with Alex" });
    await expect(log.getByText("Third message")).toBeVisible({ timeout: 30_000 });
    await expect(log.locator("article p")).toHaveText(["Second message", "Third message"]);

    // Opening the thread marks it read, so the badge goes.
    await expect.poll(() => calls.read).toBeGreaterThan(0);

    await log.getByRole("button", { name: "Load older messages" }).click();
    await expect(log.locator("article p")).toHaveText(["First message", "Second message", "Third message"]);
    await expect(log.getByRole("button", { name: "Load older messages" })).toHaveCount(0);
  });

  test("a deleted message keeps its place without its words", async ({ page }) => {
    await stub(page, {
      conversations: [[conversation("c1")]],
      messagePages: [
        [
          message("m2", alex.id, "", 2, { is_deleted: true }),
          message("m1", me, "Hello Alex", 1),
        ],
      ],
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/messages?conversation=c1`, { waitUntil: "domcontentloaded" });
    const log = page.getByRole("log", { name: "Messages with Alex" });
    await expect(log.locator("article p")).toHaveText(["Hello Alex", "This message was deleted."], {
      timeout: 30_000,
    });
  });

  test("opens a conversation that is not on the first page of the list", async ({ page }) => {
    const firstPage = Array.from({ length: 20 }, (_, i) => conversation(`other-${i}`, { other_participant: { id: `u${i}`, username: `user${i}`, display_name: `User ${i}` } }));
    const calls = await stub(page, {
      conversations: [firstPage, [conversation("far-away", { other_participant: { id: "z", username: "zed", display_name: "Zed" } })]],
      messagePages: [[message("m1", "z", "Found you", 1)]],
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/messages?conversation=far-away`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("log", { name: "Messages with Zed" }).getByText("Found you")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("This conversation is unavailable")).toHaveCount(0);
    expect(calls.conversationPages).toContain("2");
  });

  test("sending adds the message at the end and keeps the cursor in the box", async ({ page }) => {
    const calls = await stub(page, {
      conversations: [[conversation("c1")]],
      messagePages: [[message("m1", alex.id, "Are you there?", 1)]],
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/messages?conversation=c1`, { waitUntil: "domcontentloaded" });
    const box = page.getByRole("textbox", { name: "Write a message" });
    await expect(page.getByText("Are you there?")).toBeVisible({ timeout: 30_000 });
    await box.fill("  Yes, one moment  ");
    await box.press("Enter");
    const log = page.getByRole("log", { name: "Messages with Alex" });
    await expect(log.locator("article p")).toHaveText(["Are you there?", "Yes, one moment"]);
    expect(calls.sent).toEqual(["Yes, one moment"]);
    await expect(box).toBeFocused();
    await expect(box).toHaveValue("");
  });

  test("the profile Message button opens the new message form", async ({ page }) => {
    await stub(page, { conversations: [[]] });
    await page.route("**/v1/users/alex", (route) => route.fulfill({ json: alex }));
    await seedSignedAuth(page, base, "buyer");
    await page.goto(`${base}/messages?recipient=alex`, { waitUntil: "domcontentloaded" });
    const dialog = page.getByRole("dialog", { name: "New message", exact: true });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // The recipient is a name, never a raw id.
    await expect(dialog.getByRole("textbox", { name: "Recipient" })).toHaveValue("Alex");
  });
});
