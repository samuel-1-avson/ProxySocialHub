// Deployable edge version of the controlled demo website ("Acme Cloud") for LIVE audit demos.
//
// It is NOT deployed by anything in this repository. You deploy it yourself to a Cloudflare account
// (see README.md) and then list its origin in AUDITOR_ALLOWED_TARGET_ORIGINS.
//
// The visitor's country comes from Cloudflare (request.cf.country / CF-IPCountry), so the seeded
// defects appear for REAL visitors from Ghana or the United States, which is what a regional exit is.
// Which defects exist is decided only by the SCENARIO variable:
//   demo-v1  signup button covered by a cookie banner in GH; the US sees the Ghana price
//   demo-v2  the fixed site
// "Fixing the website" in the demo is therefore: change SCENARIO to demo-v2 and redeploy.
//
// The site is stateless, GET-only, collects nothing, and states on every page that it is a
// synthetic demo. It is rendered by the same code as the local fixture harness (demoSite.ts).

import { pricingScript, renderPage } from "../src/fixtures/demoSite.ts";
import { scenarioById } from "../src/fixtures/scenarios.ts";

interface Env {
  SCENARIO?: string;
}

/** A public demo exposes only the two documented versions, never the evaluation scenarios. */
const PUBLIC_SCENARIOS = new Set(["demo-v1", "demo-v2"]);

const BASE_HEADERS = {
  // Region-specific content must never be served from a shared cache to a different region.
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
} as const;

export function visitorRegion(request: Request): string {
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const raw = (cf?.country ?? request.headers.get("cf-ipcountry") ?? "").toUpperCase();
  // XX = unknown, T1 = Tor: neither is a country, so they must not pick up a country's behaviour.
  return /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : "XX";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const reply = (status: number, type: string, body: string | null, extra: Record<string, string> = {}) =>
      new Response(request.method === "HEAD" ? null : body, { status, headers: { "content-type": type, ...BASE_HEADERS, ...extra } });

    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply(405, "text/plain; charset=utf-8", "Method not allowed", { allow: "GET, HEAD" });
    }

    const scenarioId = env.SCENARIO ?? "";
    const scenario = PUBLIC_SCENARIOS.has(scenarioId) ? scenarioById(scenarioId) : undefined;
    if (!scenario) {
      // Fail loudly: a typo must not silently serve the healthy (or the defective) version.
      return reply(500, "text/plain; charset=utf-8", `SCENARIO must be one of: ${[...PUBLIC_SCENARIOS].join(", ")}`);
    }

    const region = visitorRegion(request);
    const defects = scenario.regions[region] ?? [];

    switch (url.pathname) {
      case "/":
        return reply(200, "text/html; charset=utf-8", renderPage(region, defects, scenario));
      case "/assets/pricing.js":
        return reply(200, "application/javascript; charset=utf-8", pricingScript(region, defects));
      case "/pricing":
      case "/about": {
        const title = url.pathname === "/pricing" ? "Pricing" : "About";
        return reply(200, "text/html; charset=utf-8", `<!doctype html><meta charset="utf-8"><title>${title} - Acme Cloud</title><h1>${title}</h1><p>Synthetic demo page.</p><a href="/">Home</a>`);
      }
      case "/robots.txt":
        return reply(200, "text/plain; charset=utf-8", "User-agent: *\nDisallow: /\n");
      case "/healthz":
        return reply(200, "application/json", JSON.stringify({ ok: true, scenario: scenario.id }));
      default:
        return reply(404, "text/html; charset=utf-8", "<!doctype html><title>Not found</title><h1>404</h1>");
    }
  },
};
