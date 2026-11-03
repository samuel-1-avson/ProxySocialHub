import { test, expect, type Page } from "@playwright/test";
import { seedSignedAuth } from "../fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const me = "buyer-route-policy-user";

const friendRow = {
  id: "rel-1",
  user_id: me,
  friend_id: "friend-ada",
  status: "accepted",
  created_at: "2026-11-01T09:00:00Z",
  friend: { id: "friend-ada", username: "ada", display_name: "Ada Friend" },
};
const incomingRow = {
  id: "req-1",
  sender_id: "asker-ron",
  receiver_id: me,
  status: "pending",
  created_at: "2026-11-01T09:30:00Z",
  sender: { id: "asker-ron", username: "ron", display_name: "Ron Asker" },
};

async function stubFriends(
  page: Page,
  state: { friends: unknown[]; incoming: unknown[]; outgoing?: unknown[] },
) {
  const calls = { accept: 0, remove: 0 };
  await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Not available in this test" } }),
  );
  await page.route(/\/v1\/friends$/, (route) =>
    route.fulfill({ json: { friends: state.friends } }),
  );
  await page.route(/\/v1\/friends\/[^/]+$/, (route) => {
    if (route.request().method() === "DELETE") {
      calls.remove += 1;
      return route.fulfill({ json: { message: "Friend removed" } });
    }
    return route.fulfill({ status: 503, json: { error: "Not available in this test" } });
  });
  await page.route(/\/v1\/friends\/requests(\?.*)?$/, (route) => {
    const type = new URL(route.request().url()).searchParams.get("type");
    const rows = type === "outgoing" ? (state.outgoing ?? []) : state.incoming;
    return route.fulfill({ json: { [type ?? "incoming"]: rows, requests: rows } });
  });
  await page.route(/\/v1\/friends\/request\/[^/]+\/accept$/, (route) => {
    calls.accept += 1;
    return route.fulfill({ json: { message: "Friend request accepted" } });
  });
  await page.route(/\/v1\/discover\/people(\?.*)?$/, (route) =>
    route.fulfill({ json: { suggestions: [], total: 0, page: 1, limit: 5, total_pages: 1 } }),
  );
  return calls;
}

test.describe("Friends page", () => {
  test.setTimeout(120000);

  test("shows requests and friends with canonical message links", async ({ page }) => {
    await stubFriends(page, { friends: [friendRow], incoming: [incomingRow] });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/community/friends", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Friends network" })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Incoming · 1")).toBeVisible();
    await expect(page.getByText("Ron Asker")).toBeVisible();
    await expect(page.getByText("Ada Friend")).toBeVisible();
    const messageLink = page.getByRole("link", { name: "Message Ada Friend" });
    await expect(messageLink).toBeVisible();
    await expect(messageLink).toHaveAttribute("href", "/messages?recipient=friend-ada");
  });

  test("accepting an incoming request sends the accept and refreshes", async ({ page }) => {
    const state = { friends: [] as unknown[], incoming: [incomingRow] as unknown[] };
    await stubFriends(page, state);
    await page.route(/\/v1\/friends\/request\/[^/]+\/accept$/, (route) => {
      state.incoming = [];
      return route.fulfill({ json: { message: "Friend request accepted" } });
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/community/friends", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /Accept/ }).first().click();
    await expect(page.getByText("Incoming · 0")).toBeVisible({ timeout: 30000 });
  });

  test("removing a friend asks for confirmation before deleting", async ({ page }) => {
    const calls = await stubFriends(page, { friends: [friendRow], incoming: [] });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/community/friends", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Remove Ada Friend" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByRole("button", { name: "Remove connection" }).click();
    await expect.poll(() => calls.remove).toBeGreaterThan(0);
  });

  test("signed out visitors get a sign-in prompt, not data", async ({ page }) => {
    await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
    await page.goto(base + "/community/friends", { waitUntil: "domcontentloaded" });
    // Protected routes bounce signed-out visitors to the wallet sign-in.
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("Profile actions", () => {
  test.setTimeout(120000);

  test("another member's profile offers Follow and a canonical Message link", async ({ page }) => {
    await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
    await page.route("**/v1/**", (route) =>
      route.fulfill({ status: 503, json: { error: "Not available in this test" } }),
    );
    await page.route(/\/v1\/users\/testuser(\?.*)?$|\/v1\/profiles\/testuser(\?.*)?$|\/v1\/users\/profile\/testuser(\?.*)?$/, (route) =>
      route.fulfill({
        json: { id: "testuser-id", username: "testuser", display_name: "Test User", followers_count: 0, following_count: 0 },
      }),
    );
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/profile/testuser", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Follow", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("link", { name: "Message", exact: true })).toHaveAttribute(
      "href",
      "/messages?recipient=testuser-id",
    );
  });
});
