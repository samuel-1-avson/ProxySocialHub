// Shared test builders. Nothing here talks to a real model or network.

import type { AuditorConfig } from "../src/config.ts";
import { loadConfig } from "../src/config.ts";
import type { FindingModelOutput, InspectionPlan, RegionCapture } from "../src/contracts.ts";

export const AUDIT_ID = "aud_0123456789ab";

export function testConfig(over: Record<string, string> = {}): AuditorConfig {
  return loadConfig({
    NODE_ENV: "test",
    AUDITOR_SERVICE_SECRET: "t".repeat(40),
    MODEL_API_KEY: "test-key-do-not-use-0000",
    AUDITOR_MODEL_MAX_RETRIES: "2",
    ...over,
  });
}

export function plan(): InspectionPlan {
  return {
    source: "model",
    note: null,
    expectations: [
      { id: "e1", text: "Signup is usable", checkIds: ["c1"] },
      { id: "e2", text: "Expected currency is shown", checkIds: ["c2"] },
    ],
    checks: [
      { id: "c1", action: "find_control", text: null, role: "button", name: "Sign up" },
      { id: "c2", action: "read_currency", text: null, role: null, name: null },
    ],
  };
}

export function capture(country: string, over: Partial<RegionCapture> = {}): RegionCapture {
  const evidenceId = `ev-${AUDIT_ID.slice(4, 12)}-${country}`;
  return {
    evidenceId,
    auditId: AUDIT_ID,
    requestedCountry: country,
    origin: "synthetic_fixture",
    capturedAt: "2026-11-01T10:00:00.000Z",
    route: {
      sessionRef: "fixture-route",
      sessionSource: null,
      transport: "fixture_proxy",
      requestedCountry: country,
      declaredCountry: { value: country, source: "test", observedAt: "2026-11-01T10:00:00.000Z" },
      observedEgressIp: "198.51.100.23",
      egressObservations: [],
      geoip: { country, source: "test", lookedUpAt: "2026-11-01T10:00:00.000Z", note: null },
      matchesWorkerDirectIp: null,
      assurance: "verified",
      assuranceReason: "ok",
    },
    browser: { profileId: "p", viewport: { width: 1280, height: 800 }, locale: "en-US", timezoneId: "UTC", userAgent: "ua", browserVersion: "143" },
    page: {
      requestedUrl: "http://127.0.0.1:1/",
      finalUrl: "http://127.0.0.1:1/",
      redirectChain: [],
      mainDocumentStatus: 200,
      title: "Acme",
      visibleText: "Acme Cloud GH₵ 149.00",
      loadState: "load",
      navigationError: null,
    },
    screenshots: [{ artifactId: `${evidenceId}-initial.png`, label: "initial", width: 1280, height: 800, bytes: 100, sha256: "a".repeat(64) }],
    failedRequests: [],
    blockedRequests: [],
    policyViolations: [],
    consoleErrors: [],
    timings: { navigationWallMs: 10, domContentLoadedMs: 9, loadEventMs: 10, totalCaptureMs: 100 },
    timingNotes: "n",
    checks: [],
    limits: { requestCount: 3, approxBytes: 1000, truncated: false },
    ...over,
  };
}

export function finding(over: Partial<FindingModelOutput> = {}): FindingModelOutput {
  return {
    expectationId: "e1",
    kind: "element_obscured",
    classification: "observed_defect",
    severity: "high",
    regions: ["GH"],
    summary: "Sign up button is covered",
    observed: "A cookie banner covers the button",
    expected: "Sign up is clickable",
    evidenceIds: [`ev-${AUDIT_ID.slice(4, 12)}-GH`],
    location: null,
    reproduction: ["Open the page"],
    nextAction: "Move the banner",
    uncertainty: "Direct observation in one viewport",
    ...over,
  };
}

/** A Responses-API body as Meta returns it. */
export function responsesBody(output: unknown, over: Record<string, unknown> = {}) {
  return {
    id: "resp_test_1",
    status: "completed",
    incomplete_details: null,
    error: null,
    output: [
      { type: "reasoning", content: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: typeof output === "string" ? output : JSON.stringify(output) }] },
    ],
    usage: { input_tokens: 1000, output_tokens: 400, input_tokens_details: { cached_tokens: 200 }, output_tokens_details: { reasoning_tokens: 150 }, total_tokens: 1400 },
    ...over,
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
