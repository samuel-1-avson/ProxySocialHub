/* Full-document checks for public UI in both themes, with controlled API failures. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import axe from "@axe-core/playwright";
const AxeBuilder = axe.default || axe;
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:4027";
const auditDate = new Date().toISOString().slice(0, 10);
const output = path.resolve(webRoot, "../../docs/audit/data/frontend_global_accessibility_" + auditDate + ".json");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const theme of ["dark", "light"]) {
      for (const route of ["/", "/marketplace", "/explorer"]) {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        try {
          await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
          const page = await context.newPage();
          await page.route("**/v1/**", (request) => request.fulfill({ status: 503, json: { error: "Fixture source unavailable" } }));
          await page.routeWebSocket((url) => !url.pathname.includes("/_next/"), (socket) => socket.close());
          await page.goto(base + route, { waitUntil: "domcontentloaded" });
          // Allow the bounded read retries to settle so error content is included.
          await page.waitForTimeout(8000);
          const scan = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
          const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          results.push({ route, theme, horizontal_overflow: horizontalOverflow, viewport: { width: 390, height: 844 }, passing_rules: scan.passes.length,
            violations: scan.violations.map((item) => ({ id: item.id, impact: item.impact,
              nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary, html: node.html })) })) });
          console.log(route, theme, "violations:", scan.violations.length);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
  const buildFile = path.join(webRoot, ".next/BUILD_ID");
  fs.writeFileSync(output, JSON.stringify({ date: auditDate, build_id: fs.existsSync(buildFile) ? fs.readFileSync(buildFile, "utf8").trim() : null,
    source: "controlled API unavailable responses; full document; Axe WCAG 2/2.1 A/AA and best-practice", results }, null, 2) + "\n");
  if (results.some((result) => result.violations.length || result.horizontal_overflow > 1)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
