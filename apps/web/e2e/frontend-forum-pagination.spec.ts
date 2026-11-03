import { test, expect } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";

// F07: replies beyond the first page are reachable, and the accepted
// answer is visible immediately even when it lives on a later page.
test("thread pages load older replies and pin the accepted answer until it arrives", async ({ page }) => {
  test.setTimeout(120000);
  const threadId = "thread-long";
  const author = { id: "author-1", username: "asker", display_name: "Asker" };
  const makePost = (n: number) => ({
    id: "post-" + n,
    thread_id: threadId,
    author_id: author.id,
    content: n === 25 ? "accepted answer text" : "reply number " + n,
    is_solution: n === 25,
    upvotes: 0,
    downvotes: 0,
    author,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
  });
  const allPosts = Array.from({ length: 25 }, (_, i) => makePost(i + 1));
  const thread = {
    id: threadId,
    slug: "long-thread",
    title: "Long pagination thread",
    content: "How does pagination work here?",
    author_id: author.id,
    author,
    views_count: 3,
    replies_count: 25,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
  };

  await page.routeWebSocket(
    (url) => !url.pathname.includes("/_next/"),
    (socket) => socket.close(),
  );
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }),
  );
  await seedSignedAuth(page, base, "buyer");
  await page.route(new RegExp(`/v1/forum/threads/${threadId}/posts(\\?.*)?$`), (route) =>
    route.fulfill({
      json: { posts: allPosts.slice(20), total: 25, page: 2, limit: 20 },
    }),
  );
  await page.route(new RegExp(`/v1/forum/threads/${threadId}$`), (route) =>
    route.fulfill({
      json: {
        thread,
        posts: allPosts.slice(0, 20),
        total_posts: 25,
        page: 1,
        limit: 20,
        solution_post: allPosts[24],
      },
    }),
  );

  await page.goto(base + "/help/forum/thread/" + threadId, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "25 replies" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("reply number 1", { exact: true })).toBeVisible({ timeout: 30000 });
  // The accepted answer (post 25) is pinned before its page loads.
  const accepted = page.locator('section[aria-label="Accepted solution"]');
  await expect(accepted).toBeVisible({ timeout: 30000 });
  await expect(accepted.getByText("accepted answer text", { exact: true })).toBeVisible();
  await expect(page.getByText("reply number 21", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Load more replies/ }).click();
  await expect(page.getByText("reply number 21", { exact: true })).toBeVisible({ timeout: 30000 });
  // Once the solution's own page arrives, the pin hands over to the list.
  await expect(accepted).toHaveCount(0);
  await expect(page.getByText("accepted answer text", { exact: true })).toHaveCount(1);
});
