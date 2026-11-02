// Local server for the controlled demo website (fixture harness). DEVELOPMENT ONLY.
//
// The "visitor region" comes from the X-Fixture-Region header that the local fixture proxy
// attaches; the deployable edge worker (demo-site/worker.ts) reads it from the network instead.
// The page itself is rendered by demoSite.ts and states that it is synthetic.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pricingScript, renderPage } from "./demoSite.ts";
import { SCENARIOS, scenarioById, type Scenario } from "./scenarios.ts";

export interface DemoTarget {
  origin: string;
  port: number;
  scenario(): Scenario;
  setScenario(id: string): void;
  close(): Promise<void>;
}

export async function startDemoTarget(options: { port?: number; scenario?: string } = {}): Promise<DemoTarget> {
  let current = scenarioById(options.scenario ?? "demo-v1") ?? SCENARIOS[0]!;

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const region = String(req.headers["x-fixture-region"] ?? "").toUpperCase() || "US";
    const defects = current.regions[region] ?? [];
    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
      res.end(body);
    };

    // Echo endpoint standing in for a public "what is my IP" service (synthetic).
    if (url.pathname === "/__egress") {
      const ip = String(req.headers["x-fixture-egress-ip"] ?? "");
      return send(ip ? 200 : 503, "application/json", JSON.stringify(ip ? { ip } : { error: "no fixture route" }));
    }
    if (url.pathname === "/__fixture/state") {
      return send(200, "application/json", JSON.stringify({ scenario: current.id, title: current.title }));
    }
    // Scenario changes come from the harness itself (same process); the HTTP route is
    // reachable only on loopback and only changes synthetic demo behaviour.
    if (url.pathname === "/__fixture/scenario" && req.method === "POST") {
      const id = url.searchParams.get("id") ?? "";
      const next = scenarioById(id);
      if (!next) return send(404, "application/json", JSON.stringify({ error: "unknown scenario" }));
      current = next;
      return send(200, "application/json", JSON.stringify({ scenario: current.id }));
    }

    // Test hooks for the audit network policy (fixture site only).
    if (url.pathname === "/__redirect") {
      return send(302, "text/plain", "redirecting", { location: url.searchParams.get("to") ?? "/" });
    }
    if (url.pathname === "/__loop") {
      const n = Number(url.searchParams.get("n") ?? "0");
      return send(302, "text/plain", "looping", { location: n > 0 ? `/__loop?n=${n - 1}` : "/" });
    }
    if (url.pathname === "/__offsite") {
      return send(200, "text/html", '<!doctype html><title>Offsite</title><h1>Offsite resources</h1><img alt="" src="http://127.0.0.1:47999/pixel.png"><p>Visible text.</p>');
    }

    if (url.pathname === "/assets/pricing.js") {
      if (defects.includes("asset_404")) return send(404, "text/plain", "Not found");
      return send(200, "application/javascript", pricingScript(region, defects));
    }
    if (url.pathname === "/") {
      if (defects.includes("server_error")) {
        return send(500, "text/html", "<!doctype html><title>Error</title><h1>Internal Server Error</h1><p>Something went wrong on our end.</p>");
      }
      if (defects.includes("bot_challenge")) {
        return send(
          403,
          "text/html",
          "<!doctype html><title>Just a moment…</title><h1>Checking your browser before accessing the site</h1><p>Please verify you are human to continue. This process is automatic.</p>",
        );
      }
      return send(200, "text/html", renderPage(region, defects, current));
    }
    if (url.pathname === "/pricing" || url.pathname === "/about") {
      const title = url.pathname === "/pricing" ? "Pricing" : "About";
      return send(200, "text/html", `<!doctype html><title>${title} - Acme Cloud</title><h1>${title}</h1><p>Fixture page.</p><a href="/">Home</a>`);
    }
    return send(404, "text/html", "<!doctype html><title>Not found</title><h1>404</h1>");
  };

  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    scenario: () => current,
    setScenario(id: string) {
      const next = scenarioById(id);
      if (!next) throw new Error(`unknown fixture scenario: ${id}`);
      current = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
