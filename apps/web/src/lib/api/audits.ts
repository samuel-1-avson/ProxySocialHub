/**
 * Regional Auditor API (browser side).
 *
 * Talks only to this app's /api/audits route handlers, which authenticate the
 * user, enforce ownership, and call the auditor worker server-side. Types
 * mirror services/regional-auditor/src/contracts.ts (public shape: no owner id,
 * no credentials).
 */

import { authApiFetch, ApiError } from "./client";

export type AuditMode = "live" | "fixture" | "replay";
export type EvidenceOrigin = "live_capture" | "recorded_replay" | "synthetic_fixture";
export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cancelled" | "not_run";
export type RegionStatus = "pending" | "running" | "captured" | "unverified" | "mismatch" | "unavailable" | "failed" | "cancelled";
export type Assurance = "verified" | "unverified" | "mismatch" | "direct_egress" | "unavailable";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Classification = "observed_defect" | "regional_difference" | "hypothesis";

export const TERMINAL_STATUSES: readonly JobStatus[] = ["completed", "partial", "failed", "cancelled"];
export const isActive = (status: JobStatus) => !TERMINAL_STATUSES.includes(status);

export interface AuditSummary {
  id: string;
  targetUrl: string;
  regions: string[];
  mode: AuditMode;
  evidenceOrigin: EvidenceOrigin;
  status: JobStatus;
  createdAt: string;
  completedAt: string | null;
  previousAuditId: string | null;
  analysisStatus: "not_run" | "running" | "completed" | "failed" | "skipped";
  findingCount: number;
  regionStatuses: Array<{ country: string; status: RegionStatus }>;
}

export interface Screenshot {
  artifactId: string;
  label: "initial" | "scrolled";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

export interface Capture {
  evidenceId: string;
  requestedCountry: string;
  origin: EvidenceOrigin;
  capturedAt: string;
  route: {
    sessionRef: string | null;
    /** Where the route's credentials came from; null for fixture routes and audits stored before this existed. */
    sessionSource?: "session_intent" | "marketplace_order" | null;
    transport: "proxyhubb_gateway" | "fixture_proxy";
    declaredCountry: { value: string | null; source: string; observedAt: string | null };
    observedEgressIp: string | null;
    egressObservations: Array<{ phase: "before" | "after"; ip: string | null; at: string; elapsedMs: number; error: string | null }>;
    geoip: { country: string | null; source: string; lookedUpAt: string | null; note: string | null; network?: string | null; satellite?: boolean };
    assurance: Assurance;
    assuranceReason: string;
  };
  browser: { profileId: string; viewport: { width: number; height: number }; locale: string; timezoneId: string; userAgent: string; browserVersion: string };
  page: {
    requestedUrl: string;
    finalUrl: string | null;
    redirectChain: string[];
    mainDocumentStatus: number | null;
    title: string | null;
    loadState: "load" | "domcontentloaded" | "timeout" | "error" | "not_attempted";
    navigationError: string | null;
  };
  screenshots: Screenshot[];
  failedRequests: Array<{ url: string; method: string; resourceType: string; status: number | null; failure: string | null }>;
  blockedRequests: Array<{ url: string; reason: string }>;
  policyViolations: Array<{ url: string; reason: string }>;
  consoleErrors: string[];
  timings: { navigationWallMs: number | null; domContentLoadedMs: number | null; loadEventMs: number | null; totalCaptureMs: number };
  timingNotes: string;
  checks: Array<{ checkId: string; action: string; status: "ok" | "not_found" | "error" | "skipped"; detail: string; data: Record<string, unknown>; elapsedMs: number }>;
  limits: { requestCount: number; approxBytes: number; truncated: boolean };
}

export interface Finding {
  id: string;
  expectationId: string | null;
  kind: string;
  classification: Classification;
  severity: Severity;
  regions: string[];
  summary: string;
  observed: string;
  expected: string;
  evidenceIds: string[];
  location: { evidenceId: string; screenshot: "initial" | "scrolled" | null; description: string; checkId: string | null } | null;
  reproduction: string[];
  nextAction: string;
  uncertainty: string;
}

export interface Analysis {
  status: "not_run" | "running" | "completed" | "failed" | "skipped";
  failure: { code: string; message: string; retryable: boolean; attempts: number } | null;
  model: { provider: "meta"; id: string; dataMode: "standard" | "contributor" } | null;
  startedAt: string | null;
  completedAt: string | null;
  evidenceOrigins: EvidenceOrigin[];
  expectationResults: Array<{ expectationId: string; status: "met" | "not_met" | "unclear" | "not_evaluated"; regions: string[]; rationale: string }>;
  findings: Finding[];
  limitations: string[];
  validation: { droppedFindings: Array<{ summary: string; reason: string }>; adjustedFindings: Array<{ findingId: string; reason: string }> };
  usage: {
    calls: Array<{ stage: "plan" | "analyze"; model: string; inputTokens: number | null; outputTokens: number | null; latencyMs: number; outcome: string }>;
    totalInputTokens: number;
    totalOutputTokens: number;
    costEstimate: { usd: number; label: "estimate"; priceSource: string } | null;
  };
  attempts: number;
}

export interface ComparisonItem {
  status: "resolved" | "persisting" | "new" | "incomparable";
  key: string;
  summary: string;
  currentFindingId: string | null;
  previousFindingId: string | null;
  regions: string[];
  note: string | null;
}

export interface Audit {
  schemaVersion: number;
  id: string;
  request: { targetUrl: string; regions: string[]; expectations: string; mode: "live" | "fixture"; browserProfile: { id: string; viewport: { width: number; height: number }; locale: string; timezoneId: string } };
  mode: AuditMode;
  evidenceOrigin: EvidenceOrigin;
  previousAuditId: string | null;
  replayOfAuditId: string | null;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  stages: Array<{ name: "plan" | "capture" | "analysis"; status: StageStatus; startedAt: string | null; completedAt: string | null; message: string | null }>;
  plan: {
    source: "model" | "default";
    note: string | null;
    expectations: Array<{ id: string; text: string; checkIds: string[] }>;
    checks: Array<{ id: string; action: string; text: string | null; role: string | null; name: string | null }>;
  } | null;
  regions: Array<{
    country: string;
    status: RegionStatus;
    startedAt: string | null;
    completedAt: string | null;
    evidenceId: string | null;
    assurance: Assurance | null;
    failure: { code: string; message: string } | null;
  }>;
  captures: Capture[];
  analysis: Analysis;
  comparison: { previousAuditId: string; comparedAt: string; items: ComparisonItem[]; caveats: string[] } | null;
  /** Set when the run used the user's own marketplace orders; identifiers only, never credentials. */
  sessionPlan?: { source: "marketplace_order"; orders: Record<string, string> } | null;
  failure: { code: string; message: string } | null;
  limitations: string[];
}

export interface AuditCapabilities {
  auditor: {
    modes: {
      live: { available: boolean; missing: string[]; allowedTargetOrigins: string[]; allowedHosts?: string[]; proxyEndpoint?: string | null };
      fixture: { available: boolean; missing: string[]; targetUrl: string | null; regions: string[]; scenario: string | null };
      replay: { available: boolean };
    };
    ai: { provider: "meta"; configured: boolean; model: string; dataMode: "standard" | "contributor" };
    limits: { maxRegions: number; maxChecks: number; jobTimeoutSeconds: number };
    geoip: string;
  } | null;
  auditorProblem: { code: string; message: string } | null;
  listingRegions: { available: boolean; regions: Array<{ code: string; listings: number }>; source: string; message?: string };
}

export interface CreateAuditInput {
  targetUrl: string;
  regions: string[];
  expectations: string;
  mode: "live" | "fixture";
  /** Live only. "intent" (default) opens sessions; "order" uses orders the user already paid for. */
  sessionSource?: "intent" | "order";
  /** With sessionSource "order": region code -> the user's order id. */
  orders?: Record<string, string>;
}

/** An active marketplace order the user could run an audit over (no credentials, wallet or seller data). */
export interface AuditOrderOption {
  id: string;
  /** Seller-declared country of the listing: a claim, verified by the audit. */
  country: string | null;
  title: string;
  city: string | null;
  isp: string | null;
  bandwidthGb: number | null;
  createdAt: string | null;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? "Request failed", body?.error?.code);
  }
  return body as T;
}

const post = (url: string, body?: unknown) =>
  authApiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export async function getCapabilities(): Promise<AuditCapabilities> {
  return json<AuditCapabilities>(await authApiFetch("/api/audits/capabilities"));
}
/** The orders that can carry an audit, and how many others the account holds by status (they cannot). */
export interface AuditOrderList {
  orders: AuditOrderOption[];
  otherStatuses: Record<string, number>;
}
export async function listAuditOrders(): Promise<AuditOrderList> {
  const body = await json<{ orders: AuditOrderOption[]; otherStatuses?: Record<string, number> }>(await authApiFetch("/api/audits/orders"));
  return { orders: body.orders, otherStatuses: body.otherStatuses ?? {} };
}
export async function listAudits(): Promise<AuditSummary[]> {
  return (await json<{ audits: AuditSummary[] }>(await authApiFetch("/api/audits"))).audits;
}
export async function getAudit(id: string): Promise<Audit> {
  return (await json<{ audit: Audit }>(await authApiFetch(`/api/audits/${encodeURIComponent(id)}`))).audit;
}
export async function createAudit(input: CreateAuditInput): Promise<Audit> {
  return (await json<{ audit: Audit }>(await post("/api/audits", input))).audit;
}
export async function auditAction(id: string, action: "cancel" | "rerun" | "replay" | "retry-analysis"): Promise<Audit> {
  return (await json<{ audit: Audit }>(await post(`/api/audits/${encodeURIComponent(id)}/${action}`))).audit;
}
export async function setFixtureScenario(scenarioId: string): Promise<{ current: string }> {
  return json<{ current: string }>(await post("/api/audits/fixture/scenario", { id: scenarioId }));
}
export async function getFixtureScenarios(): Promise<{ current: string; scenarios: Array<{ id: string; title: string }> }> {
  return json(await authApiFetch("/api/audits/fixture/scenario"));
}

/** Screenshots need the caller's bearer token, so they are fetched and shown as blob URLs. */
export async function fetchScreenshotBlob(auditId: string, artifactId: string): Promise<Blob> {
  const res = await authApiFetch(`/api/audits/${encodeURIComponent(auditId)}/artifacts/${encodeURIComponent(artifactId)}`);
  if (!res.ok) throw new ApiError(res.status, "Screenshot unavailable");
  return res.blob();
}

export async function downloadExport(auditId: string, format: "json" | "html"): Promise<void> {
  const res = await authApiFetch(`/api/audits/${encodeURIComponent(auditId)}/export?format=${format}`);
  if (!res.ok) throw new ApiError(res.status, "Export unavailable");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `regional-audit-${auditId}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const auditKeys = {
  all: ["audits"] as const,
  list: () => [...auditKeys.all, "list"] as const,
  detail: (id: string) => [...auditKeys.all, "detail", id] as const,
  capabilities: () => [...auditKeys.all, "capabilities"] as const,
  orders: () => [...auditKeys.all, "orders"] as const,
};
