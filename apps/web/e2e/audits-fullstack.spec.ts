// Full-stack Regional Auditor run: real Next route handlers, real worker, real Chromium
// captures through the fixture proxy, and the real Meta model if the worker has MODEL_API_KEY.
//
// Needs the worker running in fixture mode with a secret shared with the web server:
//   AUDITOR_E2E_FULLSTACK=1 AUDITOR_URL=http://127.0.0.1:4021 AUDITOR_SERVICE_SECRET=<same> \
//     npx playwright test e2e/audits-fullstack.spec.ts --project=chromium --workers=1
// See docs/hackathon/REGIONAL_AUDITOR.md. Skipped (not passed) when the variable is absent.

import { expect as playwrightExpect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { seedSignedAuth, signJwt } from "./fixtures/signed-auth";

const base = process.env.TEST_BASE_URL || "http://localhost:4011";
const expect = playwrightExpect.configure({ timeout: 30_000 });
const shotDir = process.env.AUDITOR_E2E_SCREENSHOT_DIR;

test.skip(!process.env.AUDITOR_E2E_FULLSTACK, "AUDITOR_E2E_FULLSTACK is not set: the auditor worker is not running for this test");

async function stubControlApi(page: Page) {
  // Only the control API is stubbed; every /api/audits call goes to the real route handlers and worker.
  await page.route("**/v1/**", (route) => route.fulfill({ status: 503, json: { error: "Not available in this test" } }));
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal, .tsqd-parent-container { display: none !important; }";
      document.head.appendChild(s);
    });
  });
}

async function shoot(page: Page, name: string) {
  if (!shotDir) return;
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, name), fullPage: true });
}

async function waitForFinish(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /^(Completed|Partial|Failed|Cancelled)/ }).first()).toBeVisible({ timeout: 240_000 });
}

test.describe("regional audit, full stack (fixture mode)", () => {
  test.setTimeout(600_000);

  test("create, inspect evidence, apply the fix, rerun, compare, export", async ({ page, request }) => {
    await stubControlApi(page);
    await seedSignedAuth(page, base, "both");
    // Start from a known demo-site version so the test does not depend on a previous run.
    const reset = await request.post(`${base}/api/audits/fixture/scenario`, { headers: { authorization: `Bearer ${signJwt("both")}` }, data: { id: "demo-v1" } });
    expect(reset.ok()).toBe(true);

    // ---- create -----------------------------------------------------------------
    await page.goto(`${base}/app/connections?tab=audits`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("radio", { name: /Synthetic fixture/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /^Live/ })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Ghana/ }).check();
    await page.getByRole("checkbox", { name: /United States/ }).check();
    await shoot(page, "01-create.png");
    await page.getByRole("button", { name: "Run audit" }).click();
    await expect(page).toHaveURL(/\/app\/audits\/aud_[0-9a-f]{12}$/);
    const firstUrl = page.url();

    // ---- running, then finished -----------------------------------------------------
    await expect(page.getByRole("list", { name: "Audit stages" })).toBeVisible();
    await shoot(page, "02-running.png");
    await waitForFinish(page);

    // ---- evidence ----------------------------------------------------------------
    await expect(page.getByRole("note").filter({ hasText: "Synthetic fixture: not a real regional capture" })).toBeVisible();
    for (const [name, ip] of [[/Ghana/, "198.51.100.23"], [/United States/, "203.0.113.45"]] as const) {
      const card = page.getByRole("article", { name });
      await expect(card).toContainText("Verified and captured");
      await expect(card).toContainText(ip);
      await expect(card).toContainText("synthetic");
      const img = card.getByRole("img").first();
      await expect(img).toBeVisible();
      expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }

    const noModel = await page.getByText("AI analysis not run.").count();
    let firstRunFindings = 0;
    if (noModel === 0) {
      await expect(page.getByRole("heading", { name: "AI analysis" })).toBeVisible();
      firstRunFindings = await page.getByRole("list", { name: "Findings" }).getByRole("listitem").count();
      // The seeded defects (covered signup in GH, GHS price in US) are in the evidence; the model should report something.
      expect(firstRunFindings).toBeGreaterThan(0);
      await expect(page.getByText(/Provider-reported usage/)).toBeVisible();
    }
    await shoot(page, "03-results-v1.png");

    // ---- ownership: the API refuses unauthenticated access to this audit -----------------
    const auditId = firstUrl.split("/").pop()!;
    expect((await request.get(`${base}/api/audits/${auditId}`)).status()).toBe(401);
    expect((await request.get(`${base}/api/audits/${auditId}/artifacts/ev-00000000-GH-initial.png`)).status()).toBe(401);

    // ---- fix the controlled site, rerun, compare -------------------------------------
    await page.getByRole("button", { name: /Apply the fix/ }).click();
    await expect(page.getByText(/Current version:\s*demo-v2/)).toBeVisible();
    await page.getByRole("button", { name: "Rerun and compare" }).click();
    await expect(page).not.toHaveURL(firstUrl); // wait for the post-click navigation to the new audit
    await expect(page).toHaveURL(/\/app\/audits\/aud_[0-9a-f]{12}$/);
    await waitForFinish(page);
    await shoot(page, "04-rerun-v2.png");

    if (noModel === 0) {
      const panel = page.getByRole("region", { name: "Compared with the previous run" });
      await expect(panel).toBeVisible();
      if (firstRunFindings > 0) await expect(panel).toContainText(/Resolved \(\d+\)/);
    }

    // ---- sanitized export -------------------------------------------------------------
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Data (JSON)" }).click();
    const file = await download;
    const stream = await file.createReadStream();
    const text = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c) => chunks.push(Buffer.from(c)));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.on("error", reject);
    });
    const exported = JSON.parse(text);
    expect(exported.format).toBe("proxyhubb-regional-audit/1");
    expect(exported.audit.evidenceOrigin).toBe("synthetic_fixture");
    expect(exported.limitations.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/password|ownerId|MODEL_API_KEY/i);
  });
});
