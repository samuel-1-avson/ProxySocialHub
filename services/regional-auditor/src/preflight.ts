// Live-readiness preflight. Answers "what is missing before a real regional audit can run?" with the
// exact variable names, without sending any credential anywhere and without spending model tokens.
// Every check is read-only. It cannot prove a regional exit works (only a signed-in audit can), and it
// says so.

import { promises as fs } from "node:fs";
import net from "node:net";
import { chromium } from "playwright-core";
import type { AuditorConfig } from "./config.ts";
import { IpWhoIsProvider, NoGeoIpProvider, parseEchoIp } from "./geo.ts";
import { assertHostResolvesPublic } from "./targetPolicy.ts";
import { errorMessage } from "./util.ts";

export type CheckStatus = "ok" | "warn" | "fail" | "skip";

export interface PreflightCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

export interface PreflightOptions {
  /** Control API base URL; enables the region-inventory check. */
  apiUrl?: string;
  /** Regions the audit will request (for the inventory check). */
  regions?: string[];
  fetchImpl?: typeof fetch;
  /** Skip launching a browser (tests). */
  skipBrowser?: boolean;
}

const check = (id: string, title: string, status: CheckStatus, detail: string): PreflightCheck => ({ id, title, status, detail });

function parseEndpoint(endpoint: string): { host: string; port: number } | null {
  const [host, portText] = endpoint.replace(/^https?:\/\//, "").split(":");
  const port = Number(portText);
  return host && Number.isInteger(port) && port > 0 && port < 65536 ? { host, port } : null;
}

/** Send one unauthenticated CONNECT and report the status line and Proxy-Authenticate header. */
function probeGatewayChallenge(host: string, port: number, target: string, timeoutMs = 8000): Promise<{ status: number | null; authenticate: string | null; error?: string }> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let data = "";
    const done = (value: { status: number | null; authenticate: string | null; error?: string }) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done({ status: null, authenticate: null, error: `no answer within ${timeoutMs / 1000}s` }), timeoutMs);
    socket.on("connect", () => socket.write(`CONNECT ${target}:443 HTTP/1.1\r\nHost: ${target}:443\r\n\r\n`));
    socket.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.includes("\r\n\r\n")) {
        const status = /^HTTP\/1\.[01] (\d{3})/.exec(data)?.[1];
        const authenticate = /^proxy-authenticate:\s*(.+)$/im.exec(data)?.[1]?.trim() ?? null;
        done({ status: status ? Number(status) : null, authenticate });
      }
    });
    socket.on("error", (e) => done({ status: null, authenticate: null, error: e.message }));
    socket.on("close", () => done({ status: null, authenticate: null, error: "connection closed without an answer" }));
  });
}

export async function runPreflight(config: AuditorConfig, options: PreflightOptions = {}): Promise<PreflightCheck[]> {
  const f = options.fetchImpl ?? fetch;
  const out: PreflightCheck[] = [];

  // 1. Worker identity
  out.push(
    !config.serviceSecret
      ? check("secret", "Shared secret with the web server", "fail", "AUDITOR_SERVICE_SECRET is not set (needs >= 32 random characters, identical in the web server's environment).")
      : config.serviceSecret.length < 32
        ? check("secret", "Shared secret with the web server", "fail", "AUDITOR_SERVICE_SECRET is shorter than 32 characters.")
        : check("secret", "Shared secret with the web server", "ok", "set (value not shown)."),
  );

  // 2. Gateway
  if (!config.proxyEndpoint) {
    out.push(check("gateway", "ProxyHubb gateway", "fail", "AUDITOR_PROXY_ENDPOINT is not set (host:port of the buyer gateway)."));
  } else {
    const ep = parseEndpoint(config.proxyEndpoint);
    if (!ep) {
      out.push(check("gateway", "ProxyHubb gateway", "fail", `AUDITOR_PROXY_ENDPOINT must be host:port (got "${config.proxyEndpoint}").`));
    } else {
      const echoHost = new URL(config.egressEchoUrl).hostname;
      const probe = await probeGatewayChallenge(ep.host, ep.port, echoHost);
      if (probe.status === 407 && /basic/i.test(probe.authenticate ?? "")) {
        out.push(check("gateway", "ProxyHubb gateway", "ok", `${config.proxyEndpoint} answers an unauthenticated CONNECT with 407 and ${probe.authenticate}. That is the challenge Chromium needs to send session credentials. This does not prove a session will work.`));
      } else if (probe.status === 407) {
        out.push(check("gateway", "ProxyHubb gateway", "warn", `${config.proxyEndpoint} answers 407 but with Proxy-Authenticate "${probe.authenticate ?? "(none)"}", not Basic; Chromium may not be able to authenticate.`));
      } else if (probe.status === 200) {
        out.push(check("gateway", "ProxyHubb gateway", "fail", `${config.proxyEndpoint} accepted a CONNECT with no credentials. That is not a ProxyHubb gateway (or it is open); audits would not be tied to a session.`));
      } else {
        out.push(check("gateway", "ProxyHubb gateway", "fail", `${config.proxyEndpoint} did not behave like a CONNECT gateway: ${probe.error ?? `HTTP ${probe.status ?? "?"}`}.`));
      }
    }
  }

  // 3. Authorized targets
  if (config.allowedTargetOrigins.length === 0) {
    out.push(check("targets", "Authorized target origins", "fail", "AUDITOR_ALLOWED_TARGET_ORIGINS is empty; live audits refuse every target."));
  } else {
    for (const origin of config.allowedTargetOrigins) {
      const host = new URL(origin).hostname;
      const dns = await assertHostResolvesPublic(host);
      if (!dns.ok) {
        out.push(check(`target:${origin}`, `Target ${origin}`, "fail", `${dns.message} Live audits refuse it.`));
        continue;
      }
      try {
        const res = await f(origin, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "ProxyHubb-Regional-Auditor-preflight" } });
        const redirect = res.status >= 300 && res.status < 400 ? ` It redirects to ${res.headers.get("location") ?? "?"}: audits only follow origins you list.` : "";
        out.push(check(`target:${origin}`, `Target ${origin}`, res.status < 500 ? "ok" : "warn", `reachable directly from this machine over HTTPS (HTTP ${res.status}).${redirect} Reachability from a regional exit is only known after an audit.`));
      } catch (e) {
        out.push(check(`target:${origin}`, `Target ${origin}`, "fail", `could not be reached over HTTPS from this machine: ${errorMessage(e).slice(0, 120)}.`));
      }
    }
  }

  // 4. Echo service (also learns the worker's own IP for proxy-bypass detection)
  try {
    const res = await f(config.egressEchoUrl, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json, text/plain" } });
    const ip = res.ok ? parseEchoIp((await res.text()).slice(0, 2000)) : null;
    out.push(
      ip
        ? check("echo", "Egress echo service", "ok", `${new URL(config.egressEchoUrl).host} answers directly. The worker's own IP is learned from it to detect a proxy bypass. It must also be reachable through the gateway (and in the intent's allowed domains if you use them).`)
        : check("echo", "Egress echo service", "warn", `${config.egressEchoUrl} answered without a usable IP; proxy-bypass detection will be off.`),
    );
  } catch (e) {
    out.push(check("echo", "Egress echo service", "warn", `${config.egressEchoUrl} could not be reached directly (${errorMessage(e).slice(0, 80)}); proxy-bypass detection will be off.`));
  }

  // 5. GeoIP
  if (config.geoipProvider === "none") {
    out.push(check("geoip", "GeoIP estimate", "warn", "AUDITOR_GEOIP_PROVIDER=none: every exit will be 'unverified' and nothing will be interpreted."));
  } else {
    const result = await new (config.geoipProvider === "ipwhois" ? IpWhoIsProvider : NoGeoIpProvider)().lookup("8.8.8.8");
    out.push(
      result.country
        ? check("geoip", "GeoIP estimate", "ok", `${result.source} answered (an estimate, not proof of location).`)
        : check("geoip", "GeoIP estimate", "warn", `${result.source} gave no answer (${result.note ?? "unknown"}); exits would be 'unverified' until it does.`),
    );
  }

  // 6. Model (free: GET /models/{id})
  if (!config.model.apiKey) {
    out.push(check("model", "Meta model access", "warn", "MODEL_API_KEY is not set; audits will capture evidence but report 'AI analysis not run'."));
  } else {
    try {
      const res = await f(`${config.model.baseUrl}/models/${encodeURIComponent(config.model.id)}`, { headers: { authorization: `Bearer ${config.model.apiKey}` }, signal: AbortSignal.timeout(10_000) });
      out.push(
        res.ok
          ? check("model", "Meta model access", "ok", `the key can see ${config.model.id} (${config.model.dataMode} mode). No tokens were spent.`)
          : check("model", "Meta model access", "fail", res.status === 401 ? "the API key was rejected (HTTP 401)." : `GET /models/${config.model.id} answered HTTP ${res.status}.`),
      );
    } catch (e) {
      out.push(check("model", "Meta model access", "fail", `the model API could not be reached: ${errorMessage(e).slice(0, 80)}.`));
    }
  }

  // 7. Browser
  if (options.skipBrowser) out.push(check("browser", "Chromium", "skip", "skipped."));
  else {
    try {
      const browser = await chromium.launch({ headless: true, executablePath: config.chromeExecutablePath ?? undefined });
      const version = browser.version();
      await browser.close();
      out.push(check("browser", "Chromium", "ok", `launches (version ${version}).`));
    } catch (e) {
      out.push(check("browser", "Chromium", "fail", `cannot launch: ${errorMessage(e).split("\n")[0]?.slice(0, 120)}. Run "npx playwright install chromium" or set AUDITOR_CHROME_PATH.`));
    }
  }

  // 8. Storage
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    const probe = `${config.dataDir}/.preflight-${process.pid}`;
    await fs.writeFile(probe, "ok");
    await fs.rm(probe);
    out.push(check("storage", "Job and screenshot storage", "ok", `${config.dataDir} is writable${config.databaseUrl ? " (jobs go to PostgreSQL; screenshots stay here)" : " (filesystem job store)"}.`));
  } catch (e) {
    out.push(check("storage", "Job and screenshot storage", "fail", `${config.dataDir} is not writable: ${errorMessage(e).slice(0, 80)}.`));
  }

  // 9. Region inventory from the control API
  if (!options.apiUrl) {
    out.push(check("regions", "Region inventory", "skip", "pass --api-url <control API> to compare the requested regions with active listings."));
  } else {
    try {
      const res = await f(new URL("/v1/listings/facets", options.apiUrl), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const facets = (await res.json()) as { countries?: Array<{ value: string; count: number }> };
      const have = new Map((facets.countries ?? []).map((c) => [c.value.toUpperCase(), c.count]));
      const want = (options.regions ?? []).map((r) => r.toUpperCase());
      const missing = want.filter((r) => !have.has(r));
      const listing = [...have].map(([c, n]) => `${c}×${n}`).join(", ") || "none";
      out.push(
        missing.length > 0
          ? check("regions", "Region inventory", "fail", `no active listing is declared for ${missing.join(", ")} (active: ${listing}). Provider-declared supply only; online/routable status is unknown until an audit runs.`)
          : check("regions", "Region inventory", "ok", `active listings declare: ${listing}. These are provider claims about supply; each exit is verified during the audit.`),
      );
    } catch (e) {
      out.push(check("regions", "Region inventory", "warn", `could not read ${options.apiUrl}/v1/listings/facets (${errorMessage(e).slice(0, 80)}).`));
    }
  }

  return out;
}

export function liveReady(checks: PreflightCheck[]): boolean {
  return checks.every((c) => c.status !== "fail");
}
