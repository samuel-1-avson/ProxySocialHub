// One isolated, bounded browser capture for one region.
//
// Guarantees (see docs/hackathon/REGIONAL_AUDITOR.md for the residual limits):
//   * the browser is launched with the region's proxy; there is no direct fallback
//   * the egress IP is observed through that same browser before and after capture
//   * the capture is refused (not attempted) when the route fails verification
//   * every request the page makes is checked against the target policy
//   * the browser is closed on every exit path, including abort and error

import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import type { AuditorConfig } from "../config.ts";
import type {
  BrowserProfile,
  EgressObservation,
  EvidenceOrigin,
  InspectionPlan,
  RegionCapture,
  RequestRecord,
  ScreenshotRef,
  SessionSource,
} from "../contracts.ts";
import { evaluateAssurance, parseEchoIp, type GeoIpProvider } from "../geo.ts";
import { redactKnown, sanitizeLine, sanitizeUrl, sanitizeVisibleText } from "../redact.ts";
import { evaluateRequest, type RequestPolicyContext } from "../targetPolicy.ts";
import { evidenceIdFor, nowIso, sha256Hex, truncate } from "../util.ts";
import { runChecks } from "./checks.ts";

export interface RegionRoute {
  transport: "proxyhubb_gateway" | "fixture_proxy";
  proxy: { server: string; username: string; password: string };
  sessionRef: string | null;
  sessionSource?: SessionSource | null;
  declaredCountry: { value: string | null; source: string; observedAt: string | null };
  geoip: GeoIpProvider;
  /** The worker's own public IP when known (for proxy-bypass detection). */
  workerDirectIp: string | null;
  origin: EvidenceOrigin;
  egressEchoUrl: string;
  /** Development-only plain-http origins (fixture harness). Empty for live audits. */
  fixtureOrigins: string[];
  /** Origins a live page may load besides the target: approved subresource origins. */
  approvedOrigins: string[];
}

export interface CaptureInput {
  auditId: string;
  country: string;
  targetUrl: string;
  plan: InspectionPlan;
  profile: BrowserProfile;
  route: RegionRoute;
  config: AuditorConfig;
  signal?: AbortSignal;
  saveScreenshot: (artifactId: string, bytes: Buffer) => Promise<void>;
  onPhase?: (phase: "browser" | "egress" | "navigate" | "checks" | "finalize") => void;
}

class CaptureAbort extends Error {}

function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length > 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

export async function captureRegion(input: CaptureInput): Promise<RegionCapture> {
  const { config, route: regionRoute, profile, plan, country, auditId } = input;
  const evidenceId = evidenceIdFor(auditId, country);
  const secrets = [regionRoute.proxy.password, regionRoute.proxy.username, config.model.apiKey];
  const started = Date.now();
  const target = new URL(input.targetUrl);
  const echo = new URL(regionRoute.egressEchoUrl);

  const fixtureOrigins = new Set(regionRoute.fixtureOrigins);
  const targetPolicy: RequestPolicyContext = {
    allowedOrigins: new Set([target.origin, ...regionRoute.approvedOrigins]),
    fixtureOrigins,
    allowNonReadOnly: config.allowNonReadOnlySubrequests,
  };
  const probePolicy: RequestPolicyContext = {
    allowedOrigins: new Set([echo.origin]),
    fixtureOrigins: new Set(fixtureOrigins.has(echo.origin) ? [echo.origin] : []),
    allowNonReadOnly: false,
  };

  const state = {
    policy: probePolicy,
    requests: 0,
    bytes: 0,
    truncated: false,
    capturing: false,
    navigationViolation: null as string | null,
  };
  const failedRequests: RequestRecord[] = [];
  const blockedRequests: RegionCapture["blockedRequests"] = [];
  const policyViolations: RegionCapture["policyViolations"] = [];
  const consoleErrors: string[] = [];
  const screenshots: ScreenshotRef[] = [];
  const egress: EgressObservation[] = [];

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let userAgent = "";
  let browserVersion = "";

  const capture: RegionCapture = {
    evidenceId,
    auditId,
    requestedCountry: country,
    origin: regionRoute.origin,
    capturedAt: nowIso(),
    route: {
      sessionRef: regionRoute.sessionRef,
      sessionSource: regionRoute.sessionSource ?? null,
      transport: regionRoute.transport,
      requestedCountry: country,
      declaredCountry: regionRoute.declaredCountry,
      observedEgressIp: null,
      egressObservations: [],
      geoip: { country: null, source: "not looked up", lookedUpAt: null, note: null },
      matchesWorkerDirectIp: null,
      assurance: "unavailable",
      assuranceReason: "Egress was not observed.",
    },
    browser: {
      profileId: profile.id,
      viewport: profile.viewport,
      locale: profile.locale,
      timezoneId: profile.timezoneId,
      userAgent: "",
      browserVersion: "",
    },
    page: {
      requestedUrl: sanitizeUrl(input.targetUrl, 2048),
      finalUrl: null,
      redirectChain: [],
      mainDocumentStatus: null,
      title: null,
      visibleText: "",
      loadState: "not_attempted",
      navigationError: null,
    },
    screenshots: [],
    failedRequests,
    blockedRequests,
    policyViolations,
    consoleErrors,
    timings: { navigationWallMs: null, domContentLoadedMs: null, loadEventMs: null, totalCaptureMs: 0 },
    timingNotes:
      "navigationWallMs is the wall-clock time page.goto took to reach DOMContentLoaded, measured by the worker through the proxy. " +
      "domContentLoadedMs and loadEventMs come from the browser's Navigation Timing API, relative to navigation start. " +
      "None of these is a pure network latency measurement.",
    checks: [],
    limits: { requestCount: 0, approxBytes: 0, truncated: false },
  };

  const note = (message: string) => truncate(redactKnown(message, secrets), 300);

  try {
    input.onPhase?.("browser");
    if (input.signal?.aborted) throw new CaptureAbort("cancelled");

    browser = await chromium.launch({
      headless: true,
      executablePath: config.chromeExecutablePath ?? undefined,
      proxy: {
        server: regionRoute.proxy.server,
        username: regionRoute.proxy.username,
        password: regionRoute.proxy.password,
        // Chromium bypasses the proxy for loopback by default; the fixture harness needs it applied.
        ...(regionRoute.transport === "fixture_proxy" ? { bypass: "<-loopback>" } : {}),
      },
      args: [
        // Do not let WebRTC reveal a non-proxied address.
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-background-networking",
        "--disable-component-update",
        "--no-first-run",
        "--disable-dev-shm-usage",
        ...config.testChromeArgs,
      ],
    });
    browserVersion = browser.version();
    const onAbort = () => void browser?.close().catch(() => undefined);
    input.signal?.addEventListener("abort", onAbort, { once: true });

    context = await browser.newContext({
      viewport: profile.viewport,
      locale: profile.locale,
      timezoneId: profile.timezoneId,
      deviceScaleFactor: profile.deviceScaleFactor,
      colorScheme: "light",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      ignoreHTTPSErrors: false,
    });
    context.setDefaultTimeout(config.limits.checkTimeoutMs);

    const block = (url: string, reason: string) => {
      if (blockedRequests.length < 40) blockedRequests.push({ url: sanitizeUrl(url), reason: truncate(reason, 160) });
    };

    await context.route("**/*", async (route: Route) => {
      const req = route.request();
      const url = req.url();
      const decision = evaluateRequest(url, req.method(), state.policy);
      if (!decision.ok) {
        block(url, decision.message);
        return route.abort("blockedbyclient");
      }
      if (state.requests >= config.limits.maxRequestsPerRegion) {
        state.truncated = true;
        block(url, "request budget for this region was reached");
        return route.abort("blockedbyclient");
      }
      if (state.bytes >= config.limits.maxBytesPerRegion) {
        state.truncated = true;
        block(url, "byte budget for this region was reached");
        return route.abort("blockedbyclient");
      }
      state.requests += 1;
      return route.continue();
    });
    // Realtime sockets are not part of a read-only audit.
    await context.routeWebSocket(/.*/, (ws) => {
      block(ws.url(), "WebSocket connections are not allowed in audits");
      void ws.close({ code: 1008, reason: "blocked by audit policy" });
    });

    context.on("page", (p) => {
      // Popups opened by the page are not followed (opener() is async in Playwright).
      void p
        .opener()
        .then((opener) => {
          if (opener && state.capturing) return p.close();
        })
        .catch(() => undefined);
    });
    context.on("requestfinished", (req) => {
      void req
        .sizes()
        .then((s) => {
          state.bytes += s.responseBodySize + s.responseHeadersSize;
        })
        .catch(() => undefined);
    });

    // Playwright does not call its route handler for redirect hops (verified empirically: a page that is
    // redirected A -> B -> C loads C even though the handler aborts C), and a second CDP Fetch interceptor
    // breaks Playwright's proxy-authentication handling. So a redirect to an unapproved destination cannot
    // be PREVENTED from the browser side. It is detected from the request events instead: the navigation is
    // stopped at once, nothing from that origin is read or stored, and the violation is reported. Prevention
    // belongs to the gateway (the signed intent's allowed_domains) and the provider's destination controls.
    const watchRedirects = (page: Page) => {
      let cdp: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | null = null;
      page.on("request", (req) => {
        const previous = req.redirectedFrom();
        if (!previous) return; // first hops are enforced by the route policy
        let hops = 0;
        for (let r: typeof previous | null = previous; r; r = r.redirectedFrom()) hops += 1;
        const decision = evaluateRequest(req.url(), req.method(), state.policy);
        const reason = !decision.ok
          ? `the browser followed a redirect to a destination the policy does not approve: ${decision.message}`
          : hops > config.limits.maxRedirects
            ? `more than ${config.limits.maxRedirects} redirects`
            : null;
        if (!reason) return;
        if (policyViolations.length < 40) policyViolations.push({ url: sanitizeUrl(req.url()), reason: truncate(reason, 200) });
        if (req.isNavigationRequest()) {
          state.navigationViolation = reason;
          // Page-domain command only: it does not interact with Playwright's own Fetch interception.
          void (async () => {
            try {
              cdp ??= await context!.newCDPSession(page);
              await cdp.send("Page.stopLoading");
            } catch {
              /* the page is already gone */
            }
          })();
        }
      });
    };
    const newWatchedPage = async (): Promise<Page> => {
      const page = await context!.newPage();
      watchRedirects(page);
      return page;
    };

    const probe = async (phase: "before" | "after"): Promise<EgressObservation> => {
      const t0 = Date.now();
      const page = await newWatchedPage();
      try {
        state.policy = probePolicy;
        if (!userAgent) userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "");
        const res = await page.goto(regionRoute.egressEchoUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
        const body = await page.evaluate(() => document.body?.innerText ?? "");
        const ip = res && res.ok() ? parseEchoIp(body) : null;
        return { phase, ip, at: nowIso(), elapsedMs: Date.now() - t0, error: ip ? null : note(`Echo service answered ${res?.status() ?? "no response"} without a usable IP.`) };
      } catch (error) {
        return { phase, ip: null, at: nowIso(), elapsedMs: Date.now() - t0, error: note(error instanceof Error ? error.message : "egress probe failed") };
      } finally {
        await page.close().catch(() => undefined);
      }
    };

    // 1. Observe egress through this browser, before touching the target.
    input.onPhase?.("egress");
    const before = await probe("before");
    egress.push(before);
    const sampleOf = async (ip: string | null) => ({ ip, geoip: ip ? await regionRoute.geoip.lookup(ip, input.signal) : null });
    const beforeSample = await sampleOf(before.ip);
    const firstVerdict = evaluateAssurance({
      requested: country,
      declaredCountry: regionRoute.declaredCountry.value,
      samples: [beforeSample],
      workerDirectIp: regionRoute.workerDirectIp,
    });
    capture.route.observedEgressIp = before.ip;
    capture.route.egressObservations = [...egress];
    if (beforeSample.geoip) capture.route.geoip = { ...beforeSample.geoip };
    capture.route.assurance = firstVerdict.assurance;
    capture.route.assuranceReason = firstVerdict.reason;
    capture.route.matchesWorkerDirectIp = firstVerdict.matchesWorkerDirectIp;

    // Only an unverified-but-plausible route proceeds; mismatch/bypass/unavailable stop here.
    if (firstVerdict.assurance !== "verified" && firstVerdict.assurance !== "unverified") {
      capture.page.navigationError = `Capture not attempted: ${firstVerdict.reason}`;
      return finalize();
    }

    // 2. Capture the target.
    input.onPhase?.("navigate");
    state.policy = targetPolicy;
    state.capturing = true;
    capture.capturedAt = nowIso();
    const page = await newWatchedPage();
    page.on("dialog", (d) => void d.dismiss().catch(() => undefined));
    // Page events count as evidence only while capturing; closing the page aborts whatever it still had in flight.
    page.on("console", (msg) => {
      if (state.capturing && msg.type() === "error" && consoleErrors.length < 20) consoleErrors.push(sanitizeLine(msg.text(), 300, secrets));
    });
    page.on("pageerror", (err) => {
      if (state.capturing && consoleErrors.length < 20) consoleErrors.push(sanitizeLine(`Uncaught: ${err.message}`, 300, secrets));
    });
    page.on("requestfailed", (req) => {
      if (!state.capturing) return;
      const reason = req.failure()?.errorText ?? "failed";
      if (/BLOCKED_?BY_?CLIENT/i.test(reason)) return; // already recorded as blocked by audit policy, not a site failure
      if (failedRequests.length < 40) {
        failedRequests.push({ url: sanitizeUrl(req.url()), method: req.method(), resourceType: req.resourceType(), status: null, failure: truncate(reason, 160) });
      }
    });
    page.on("response", (res) => {
      if (state.capturing && res.status() >= 400 && failedRequests.length < 40 && !res.request().isNavigationRequest()) {
        failedRequests.push({ url: sanitizeUrl(res.url()), method: res.request().method(), resourceType: res.request().resourceType(), status: res.status(), failure: null });
      }
    });

    const navStart = Date.now();
    let response = null;
    try {
      response = await page.goto(input.targetUrl, { waitUntil: "domcontentloaded", timeout: config.limits.navTimeoutMs });
      capture.timings.navigationWallMs = Date.now() - navStart;
      capture.page.loadState = "domcontentloaded";
      await page.waitForLoadState("load", { timeout: Math.min(10_000, config.limits.navTimeoutMs) }).then(
        () => {
          capture.page.loadState = "load";
        },
        () => undefined,
      );
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
    } catch (error) {
      capture.timings.navigationWallMs = Date.now() - navStart;
      const message = error instanceof Error ? error.message : "navigation failed";
      const timedOut = /timeout/i.test(message);
      capture.page.loadState = timedOut ? "timeout" : "error";
      const stoppedByPolicy = !timedOut && /BLOCKED_?BY_?CLIENT/i.test(message) ? blockedRequests.at(-1) : undefined;
      capture.page.navigationError = note(
        stoppedByPolicy
          ? `Navigation was stopped by the auditor's policy: ${stoppedByPolicy.reason} (${stoppedByPolicy.url})`
          : (message.split("\n")[0] ?? "navigation failed"),
      );
    }

    if (state.navigationViolation) {
      // A redirect led somewhere the policy does not approve. Whatever loaded is not evidence about the audited site.
      capture.page.loadState = "error";
      capture.page.navigationError = note(
        `The page redirected to a destination that is not approved for this audit, so the navigation was stopped and nothing from it was captured. (${state.navigationViolation})`,
      );
    } else if (response) {
      capture.page.mainDocumentStatus = response.status();
      const chain: string[] = [];
      for (let r = response.request().redirectedFrom(); r; r = r.redirectedFrom()) chain.unshift(sanitizeUrl(r.url()));
      capture.page.redirectChain = chain.slice(0, 10);
    }
    const stateNow = (): RegionCapture["page"]["loadState"] => capture.page.loadState;
    if (!state.navigationViolation && (stateNow() === "load" || stateNow() === "domcontentloaded" || stateNow() === "timeout")) {
      capture.page.finalUrl = sanitizeUrl(page.url(), 2048);
      try {
        const nav = await page.evaluate(() => {
          const e = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          return e ? { dcl: e.domContentLoadedEventEnd, load: e.loadEventEnd } : null;
        });
        if (nav) {
          capture.timings.domContentLoadedMs = nav.dcl > 0 ? Math.round(nav.dcl) : null;
          capture.timings.loadEventMs = nav.load > 0 ? Math.round(nav.load) : null;
        }
        capture.page.title = truncate(sanitizeLine(await page.title(), 300, secrets), 300) || null;
        const text = await page.evaluate(() => document.body?.innerText ?? "");
        capture.page.visibleText = sanitizeVisibleText(text, config.limits.maxVisibleTextChars, secrets);
      } catch (error) {
        capture.page.navigationError ??= note(error instanceof Error ? error.message : "could not read the page");
      }

      const shoot = async (label: "initial" | "scrolled") => {
        const bytes = await page.screenshot({ type: "png", animations: "disabled", caret: "hide", timeout: 10_000 });
        const artifactId = `${evidenceId}-${label}.png`;
        await input.saveScreenshot(artifactId, bytes);
        const { width, height } = pngSize(bytes);
        screenshots.push({ artifactId, label, width, height, bytes: bytes.length, sha256: sha256Hex(bytes) });
      };
      try {
        await shoot("initial");
      } catch (error) {
        consoleErrors.push(note(`Screenshot failed: ${error instanceof Error ? error.message : "unknown"}`));
      }

      // 3. Bounded, read-only checks from the validated plan.
      input.onPhase?.("checks");
      if (stateNow() !== "error") {
        capture.checks = await runChecks({
          page,
          plan,
          originalUrl: input.targetUrl,
          policy: targetPolicy,
          maxChecks: config.limits.maxChecks,
          checkTimeoutMs: config.limits.checkTimeoutMs,
          maxVisibleTextChars: config.limits.maxVisibleTextChars,
          knownSecrets: secrets.filter((s): s is string => !!s),
          takeScreenshot: async (label) => {
            if (screenshots.length < 3) await shoot(label);
          },
          signal: input.signal,
        });
      }
    }
    state.capturing = false;
    // The evidence is complete. Close the page before the exit re-check switches to the echo-only policy:
    // left open, its scripts keep requesting the site (prefetches, token refreshes), and those requests would
    // be blocked and reported as the site contacting unapproved destinations.
    await page.close().catch(() => undefined);

    // 4. Re-observe egress: a route change mid-capture must not go unnoticed.
    input.onPhase?.("egress");
    const after = await probe("after");
    egress.push(after);
    const afterSample = await sampleOf(after.ip);
    const finalVerdict = evaluateAssurance({
      requested: country,
      declaredCountry: regionRoute.declaredCountry.value,
      samples: [beforeSample, afterSample],
      workerDirectIp: regionRoute.workerDirectIp,
    });
    capture.route.egressObservations = [...egress];
    capture.route.assurance = finalVerdict.assurance;
    capture.route.assuranceReason = finalVerdict.reason;
    capture.route.matchesWorkerDirectIp = finalVerdict.matchesWorkerDirectIp;
    input.signal?.removeEventListener("abort", onAbort);
    return finalize();
  } catch (error) {
    if (error instanceof CaptureAbort || input.signal?.aborted) {
      capture.page.navigationError = "The audit was cancelled before this capture finished.";
    } else {
      capture.page.loadState = capture.page.loadState === "not_attempted" ? "not_attempted" : capture.page.loadState;
      capture.page.navigationError = note(error instanceof Error ? error.message.split("\n")[0] ?? "capture failed" : "capture failed");
      capture.route.assuranceReason ||= "Capture failed before the route could be verified.";
    }
    return finalize();
  } finally {
    // Always release the browser: success, failure and cancellation.
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  function finalize(): RegionCapture {
    input.onPhase?.("finalize");
    capture.screenshots = screenshots;
    capture.limits = { requestCount: state.requests, approxBytes: state.bytes, truncated: state.truncated };
    capture.timings.totalCaptureMs = Date.now() - started;
    capture.route.egressObservations = [...egress];
    capture.browser.userAgent = truncate(userAgent || "", 300);
    capture.browser.browserVersion = browserVersion || "unknown";
    return capture;
  }
}
