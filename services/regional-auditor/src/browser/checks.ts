// Closed vocabulary of bounded, read-only checks executed in the page.
// A check never types, submits, clicks buttons, or navigates outside the
// approved origins. Anything unexpected is reported as a CheckResult with
// status "error", never thrown, so one failing check cannot lose the rest.

import type { Page } from "playwright-core";
import { CONTROL_ROLES, type CheckResult, type ControlRole, type InspectionCheck, type InspectionPlan } from "../contracts.ts";
import { evaluateRequest, type RequestPolicyContext } from "../targetPolicy.ts";
import { sanitizeLine, sanitizeVisibleText } from "../redact.ts";
import { truncate } from "../util.ts";

const CURRENCY_CODES = [
  "USD", "EUR", "GBP", "GHS", "NGN", "KES", "ZAR", "CAD", "AUD", "JPY", "INR", "CNY", "BRL", "MXN", "XOF", "XAF", "EGP", "TZS", "UGX", "CHF", "SEK", "NOK", "DKK", "PLN", "TRY", "AED", "SAR",
];
const CURRENCY_SYMBOLS = ["GH₵", "₵", "₦", "KSh", "R$", "US$", "$", "€", "£", "¥", "₹", "₺", "zł", "kr"];

export function readCurrencies(text: string): { codes: string[]; symbols: string[] } {
  const codes = CURRENCY_CODES.filter((c) => new RegExp(`(?<![A-Za-z])${c}(?![A-Za-z])`).test(text));
  const symbols = CURRENCY_SYMBOLS.filter((s) => text.includes(s));
  return { codes: codes.slice(0, 12), symbols: symbols.slice(0, 12) };
}

export interface CheckDeps {
  page: Page;
  plan: InspectionPlan;
  originalUrl: string;
  policy: RequestPolicyContext;
  maxChecks: number;
  checkTimeoutMs: number;
  maxVisibleTextChars: number;
  knownSecrets: string[];
  /** Persist a screenshot taken during a check (scroll_capture). */
  takeScreenshot: (label: "scrolled") => Promise<void>;
  signal?: AbortSignal;
}

type CheckData = CheckResult["data"];

function result(check: InspectionCheck, status: CheckResult["status"], detail: string, data: CheckData, started: number): CheckResult {
  return { checkId: check.id, action: check.action, status, detail: truncate(detail, 600), data, elapsedMs: Date.now() - started };
}

export async function runChecks(deps: CheckDeps): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let follows = 0;
  for (const check of deps.plan.checks.slice(0, deps.maxChecks)) {
    if (deps.signal?.aborted) {
      results.push(result(check, "skipped", "Skipped because the audit was cancelled.", {}, Date.now()));
      continue;
    }
    const started = Date.now();
    try {
      const out = await Promise.race([
        runOne(check, deps, () => follows++),
        new Promise<CheckResult>((resolve) =>
          setTimeout(() => resolve(result(check, "error", `Check timed out after ${deps.checkTimeoutMs}ms.`, {}, started)), deps.checkTimeoutMs),
        ),
      ]);
      results.push(out);
    } catch (error) {
      results.push(result(check, "error", sanitizeLine(error instanceof Error ? error.message : "check failed", 240, deps.knownSecrets), {}, started));
    }
  }
  return results;
}

async function runOne(check: InspectionCheck, deps: CheckDeps, countFollow: () => number): Promise<CheckResult> {
  const started = Date.now();
  const { page } = deps;

  switch (check.action) {
    case "find_text": {
      const needle = (check.text ?? "").trim();
      const body = await page.evaluate(() => document.body?.innerText ?? "");
      const haystack = body.toLowerCase();
      const needleLower = needle.toLowerCase();
      let count = 0;
      for (let at = haystack.indexOf(needleLower); at !== -1 && count < 50; at = haystack.indexOf(needleLower, at + needleLower.length)) count += 1;
      return result(
        check,
        count > 0 ? "ok" : "not_found",
        count > 0 ? `Found the text ${count} time(s) in the visible page text.` : "The text does not appear in the visible page text.",
        { searched: truncate(sanitizeLine(needle, 120, deps.knownSecrets), 120), found: count > 0, occurrences: count },
        started,
      );
    }

    case "find_control": {
      const name = (check.name ?? "").trim();
      // The planner has not seen the page, so it may not know the role: null means "any supported role".
      const rolesToTry: readonly ControlRole[] = check.role ? [check.role] : CONTROL_ROLES;
      let role: ControlRole = rolesToTry[0] ?? "button";
      let locator = page.getByRole(role, { name, exact: false });
      let count = 0;
      for (const candidate of rolesToTry) {
        const found = page.getByRole(candidate, { name, exact: false });
        const n = await found.count();
        if (n > 0) {
          role = candidate;
          locator = found;
          count = n;
          break;
        }
      }
      if (count === 0) {
        const searched = check.role ?? "control";
        return result(
          check,
          "not_found",
          `No ${searched} with an accessible name containing "${truncate(name, 60)}" exists in the page's accessibility tree.${check.role ? " The role was chosen before the page was seen." : ""}`,
          { role: check.role, name: truncate(name, 80), matches: 0 },
          started,
        );
      }
      const target = locator.first();
      const visible = await target.isVisible();
      const enabled = role === "link" ? true : await target.isEnabled().catch(() => true);
      if (!visible) {
        return result(
          check,
          "ok",
          `A ${role} named like "${truncate(name, 60)}" exists but is not visible.`,
          { role, name: truncate(name, 80), matches: count, visible: false, enabled, obscured: null },
          started,
        );
      }
      await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      const probe = await target.evaluate((el: Element) => {
        const rect = el.getBoundingClientRect();
        const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
        const describe = (n: Element | null) =>
          n
            ? `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${typeof n.className === "string" && n.className ? `.${n.className.split(/\s+/).slice(0, 2).join(".")}` : ""}`
            : "";
        const text = covered && top ? (top.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
        const style = window.getComputedStyle(el as HTMLElement);
        return {
          covered,
          coveredBy: covered ? describe(top) : "",
          coveringText: text,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
        };
      });
      const obscured = probe.covered;
      return result(
        check,
        "ok",
        obscured
          ? `The ${role} is visible but another element (${probe.coveredBy}) is on top of it at its center point, so a user could not click it.`
          : `The ${role} is visible, ${enabled ? "enabled" : "disabled"} and receives clicks at its center point.`,
        {
          role,
          name: truncate(name, 80),
          matches: count,
          visible: true,
          enabled,
          obscured,
          coveredBy: obscured ? sanitizeLine(probe.coveredBy, 80) : null,
          coveringText: obscured ? sanitizeLine(probe.coveringText, 60, deps.knownSecrets) : null,
          widthPx: probe.width,
          heightPx: probe.height,
        },
        started,
      );
    }

    case "read_currency": {
      const body = await page.evaluate(() => document.body?.innerText ?? "");
      const { codes, symbols } = readCurrencies(body);
      return result(
        check,
        "ok",
        codes.length + symbols.length > 0 ? "Currency markers found in the visible page text." : "No currency symbol or code appears in the visible page text.",
        { codes, symbols },
        started,
      );
    }

    case "follow_link": {
      if (countFollow() >= 2) return result(check, "skipped", "At most two links are followed per region.", {}, started);
      const linkText = (check.text ?? "").trim();
      const link = page.getByRole("link", { name: linkText, exact: false }).first();
      if ((await page.getByRole("link", { name: linkText, exact: false }).count()) === 0) {
        return result(check, "not_found", `No link named like "${truncate(linkText, 60)}" exists.`, { link: truncate(linkText, 80) }, started);
      }
      const href = await link.getAttribute("href");
      if (!href) return result(check, "not_found", "The link has no href.", { link: truncate(linkText, 80) }, started);
      const resolved = new URL(href, page.url()).toString();
      const decision = evaluateRequest(resolved, "GET", deps.policy);
      if (!decision.ok) {
        return result(check, "skipped", `Not followed: ${decision.message}.`, { link: truncate(linkText, 80), allowed: false }, started);
      }
      const response = await page.goto(resolved, { waitUntil: "domcontentloaded", timeout: deps.checkTimeoutMs });
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const data: CheckData = {
        link: truncate(linkText, 80),
        finalPath: new URL(page.url()).pathname.slice(0, 120),
        status: response?.status() ?? null,
        title: truncate(await page.title(), 120),
        excerpt: sanitizeVisibleText(text, 280, deps.knownSecrets),
      };
      // Return to the original page so later checks see the same state.
      await page.goto(deps.originalUrl, { waitUntil: "domcontentloaded", timeout: deps.checkTimeoutMs }).catch(() => undefined);
      return result(check, "ok", `Followed the link; the destination answered with status ${response?.status() ?? "unknown"}.`, data, started);
    }

    case "scroll_capture": {
      const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 24);
      if (!scrollable) {
        return result(check, "ok", "The page fits in one viewport, so no second screenshot was taken.", { scrollable: false }, started);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(400);
      await deps.takeScreenshot("scrolled");
      return result(check, "ok", "Captured the page after scrolling to the bottom.", {}, started);
    }
  }
}
