import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

// F03: deleted messages render as tombstones (thread + preview) even if a
// payload still carries the original text, and edited messages show their
// edited marker after the messaging adapter round-trip.
test("deleted messages show as tombstones and edited messages keep their marker", async ({ page }) => {
  test.setTimeout(120000);
  const deletedText = "Secret deleted words 98765";
  const conversationId = "lifecycle-conversation";
  const otherId = "lifecycle-other-user";

  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }),
  );
  await seedSignedAuth(page, base, "buyer");

  const deletedMessage = {
    id: "lifecycle-deleted",
    conversation_id: conversationId,
    sender_id: otherId,
    content: deletedText,
    is_deleted: true,
    created_at: "2026-11-01T10:05:00Z",
  };
  const editedMessage = {
    id: "lifecycle-edited",
    conversation_id: conversationId,
    sender_id: otherId,
    content: "Edited hello",
    edited_at: "2026-11-01T10:02:00Z",
    reply_to_id: "lifecycle-deleted",
    created_at: "2026-11-01T10:00:00Z",
  };

  await page.route("**/v1/conversations", (route) =>
    route.fulfill({
      json: {
        conversations: [
          {
            id: conversationId,
            participant1: "buyer-route-policy-user",
            participant2: otherId,
            last_message_at: deletedMessage.created_at,
            other_participant: {
              id: otherId,
              username: "lifecycle-other",
              display_name: "Lifecycle Other",
            },
            last_message: deletedMessage,
            unread_count: 0,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    }),
  );
  await page.route(
    new RegExp(`/v1/conversations/${conversationId}/messages(?:\\?.*)?$`),
    (route) =>
      route.fulfill({
        json: { messages: [deletedMessage, editedMessage], total: 2, page: 1, limit: 50 },
      }),
  );

  await page.goto(base + "/messages", { waitUntil: "domcontentloaded" });

  // Preview shows the tombstone, never the original text.
  const conversationButton = page.getByRole("button", { name: /Lifecycle Other/ });
  await expect(conversationButton).toBeVisible({ timeout: 30000 });
  await expect(conversationButton).toContainText("This message was deleted.");
  await expect(page.getByText(deletedText, { exact: true })).toHaveCount(0);

  await conversationButton.click();

  // Thread shows the tombstone for the deleted message and keeps the
  // edited marker on the surviving message.
  await expect(page.getByText("This message was deleted.").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Edited hello", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/Edited/).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(deletedText, { exact: true })).toHaveCount(0);
});
