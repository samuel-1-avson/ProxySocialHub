import { expect, test } from "@playwright/test";
import { seedSignedAuth } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
test.describe("governance interface", () => {
  test.setTimeout(180_000);
  test("proposal loading failures can recover without being called a missing proposal", async ({
    page,
  }, info) => {
    await page.routeWebSocket(
      (url) => !url.pathname.includes("/_next/"),
      (socket) => socket.close(),
    );
    await page.route("**/v1/**", (route) =>
      route.fulfill({ status: 503, json: { error: "Service unavailable" } }),
    );
    let available = false;
    await page.route("**/v1/governance/proposals/ui-review", (route) =>
      route.fulfill(
        available
          ? {
              json: {
                id: "ui-review",
                title: "Regional capacity incentives",
                description:
                  "Review the capacity incentives for regional provider infrastructure.",
                type: "parameter_change",
                status: "active",
                start_time: "2026-10-31T10:00:00Z",
                end_time: "2027-01-01T10:00:00Z",
                votes_for: 12,
                votes_against: 3,
                quorum: 100,
              },
            }
          : { status: 503, json: { error: "Proposal service unavailable" } },
      ),
    );
    await page.route("**/v1/governance/proposals/ui-review/impact", (route) =>
      route.fulfill({
        json: {
          impact: {
            summary: "Regional provider incentives may change.",
            risk_level: "medium",
            lines: [],
            affected_counts: { active_listings: 0 },
          },
        },
      }),
    );
    await page.route(
      "**/v1/governance/proposals/ui-review/treasury-transactions",
      (route) => route.fulfill({ json: { treasury_transactions: [] } }),
    );
    await page.goto(base + "/governance/ui-review", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Proposal unavailable" }),
    ).toBeVisible({ timeout: 30_000 });
    available = true;
    await page
      .getByRole("alert")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Regional capacity incentives",
        exact: true,
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Regional provider incentives may change.", {
        exact: true,
      }),
    ).toBeVisible();
    const votes = page.getByRole("button", { name: "Votes", exact: true });
    await expect(votes).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Discussion", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Discussion", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("heading", { name: "Community discussion", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.addStyleTag({
      content:
        "nextjs-portal, .tsqd-parent-container { display:none!important; }",
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLElement>("main [style]")).every(
        (element) =>
          !element.style.opacity || Number(element.style.opacity) >= 0.99,
      ),
    );
    await page.screenshot({
      path: info.outputPath("proposal-detail-mobile.png"),
      fullPage: true,
    });
  });

  test("proposal fields are labelled and reject an invalid voting duration before submission", async ({
    page,
  }, info) => {
    let submissions = 0;
    await page.route("**/v1/**", (route) => {
      if (
        route.request().method() === "POST" &&
        new URL(route.request().url()).pathname === "/v1/governance/proposals"
      )
        submissions++;
      return route.fulfill({
        status: 503,
        json: { error: "No live proposal submission in this test" },
      });
    });
    await seedSignedAuth(page, base, "buyer");
    await page.goto(base + "/governance/create", {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { name: "Create Proposal", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByLabel("Proposal template", { exact: true }),
    ).toHaveValue("signal");
    await page
      .getByLabel("Proposal Title", { exact: true })
      .fill("Regional network incentives");
    await page
      .getByLabel("Proposal description", { exact: true })
      .fill(
        "Review regional provider capacity and its incentives before the next period.",
      );
    await page.getByLabel("Voting Duration (days)", { exact: true }).fill("15");
    await page
      .getByRole("button", { name: "Publish proposal on-chain", exact: true })
      .click();
    expect(
      await page
        .getByLabel("Voting Duration (days)", { exact: true })
        .evaluate(
          (element: HTMLInputElement) => element.validity.rangeOverflow,
        ),
    ).toBe(true);
    expect(submissions).toBe(0);
    await page.getByLabel("Voting Duration (days)", { exact: true }).fill("7");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.addStyleTag({
      content:
        "nextjs-portal, .tsqd-parent-container { display:none!important; }",
    });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLElement>("main [style]")).every(
        (element) =>
          !element.style.opacity || Number(element.style.opacity) >= 0.99,
      ),
    );
    await page.screenshot({
      path: info.outputPath("proposal-create-mobile.png"),
      fullPage: true,
    });
  });
});
