// Shared, validated contracts for the Regional Auditor.
//
// Everything that crosses a trust boundary (HTTP bodies, model output, stored
// documents) is parsed with these schemas. Model-facing schemas are kept flat
// and fully required/nullable so they can be sent as a strict JSON schema.

import { z } from "zod";

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const AUDIT_MODES = ["live", "fixture", "replay"] as const;
export type AuditMode = (typeof AUDIT_MODES)[number];

/** Where a piece of evidence came from. Attached to every capture and export. */
export const EVIDENCE_ORIGINS = ["live_capture", "recorded_replay", "synthetic_fixture"] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

export const JOB_STATUSES = ["queued", "running", "completed", "partial", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["completed", "partial", "failed", "cancelled"];

export const STAGE_NAMES = ["plan", "capture", "analysis"] as const;
export type StageName = (typeof STAGE_NAMES)[number];
export const STAGE_STATUSES = ["pending", "running", "completed", "failed", "skipped", "cancelled", "not_run"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const REGION_STATUSES = [
  "pending",
  "running",
  "captured", // captured and route assurance is verified
  "unverified", // captured, but the exit country could not be confirmed
  "mismatch", // exit country differs from the requested country; evidence withheld from interpretation
  "unavailable", // no session / region could not be provided
  "failed", // capture failed for another reason
  "cancelled",
] as const;
export type RegionStatus = (typeof REGION_STATUSES)[number];

export const ASSURANCE_STATUSES = ["verified", "unverified", "mismatch", "direct_egress", "unavailable"] as const;
export type AssuranceStatus = (typeof ASSURANCE_STATUSES)[number];

export const FINDING_KINDS = [
  "element_obscured",
  "element_missing",
  "asset_failed",
  "content_mismatch",
  "currency_mismatch",
  "navigation_error",
  "blocked_or_challenged",
  "performance",
  "regional_variation",
  "other",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_CLASSIFICATIONS = ["observed_defect", "regional_difference", "hypothesis"] as const;
export type FindingClassification = (typeof FINDING_CLASSIFICATIONS)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CHECK_ACTIONS = ["find_text", "find_control", "read_currency", "follow_link", "scroll_capture"] as const;
export type CheckAction = (typeof CHECK_ACTIONS)[number];

export const CONTROL_ROLES = ["button", "link", "textbox", "checkbox", "combobox"] as const;
export type ControlRole = (typeof CONTROL_ROLES)[number];

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const CountryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, "country must be an ISO 3166-1 alpha-2 code in upper case");

const IsoTime = z.string().datetime({ offset: true });
const shortText = (max: number) => z.string().max(max);

// ---------------------------------------------------------------------------
// Browser profile (controlled so regions are comparable)
// ---------------------------------------------------------------------------

export const BrowserProfile = z.object({
  id: z.string().min(1).max(64),
  viewport: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(480).max(1600) }),
  locale: z.string().min(2).max(16),
  timezoneId: z.string().min(1).max(64),
  deviceScaleFactor: z.number().min(1).max(3),
});
export type BrowserProfile = z.infer<typeof BrowserProfile>;

export const DEFAULT_BROWSER_PROFILE: BrowserProfile = {
  id: "desktop-chromium-1280x800",
  viewport: { width: 1280, height: 800 },
  locale: "en-US",
  timezoneId: "UTC",
  deviceScaleFactor: 1,
};

// ---------------------------------------------------------------------------
// Audit request (what a user can ask for)
// ---------------------------------------------------------------------------

export const AuditRequest = z.object({
  targetUrl: z.string().url().max(2048),
  regions: z.array(CountryCode).min(1).max(4),
  expectations: z.string().trim().min(10).max(2000),
  mode: z.enum(["live", "fixture"]),
  browserProfile: BrowserProfile.default(DEFAULT_BROWSER_PROFILE),
});
export type AuditRequest = z.infer<typeof AuditRequest>;

// ---------------------------------------------------------------------------
// Inspection plan: a small, closed vocabulary of read-only checks
// ---------------------------------------------------------------------------

/** Flat shape so it can be sent as a strict JSON schema; cross-field rules live in validatePlan. */
export const InspectionCheck = z.object({
  id: z.string().regex(/^c[0-9]{1,2}$/),
  action: z.enum(CHECK_ACTIONS),
  text: shortText(120).nullable(),
  role: z.enum(CONTROL_ROLES).nullable(),
  name: shortText(120).nullable(),
});
export type InspectionCheck = z.infer<typeof InspectionCheck>;

export const PlanExpectation = z.object({
  id: z.string().regex(/^e[0-9]{1,2}$/),
  text: shortText(400),
  checkIds: z.array(z.string().regex(/^c[0-9]{1,2}$/)).max(6),
});
export type PlanExpectation = z.infer<typeof PlanExpectation>;

/** What the planning model is allowed to return. */
export const PlanModelOutput = z.object({
  expectations: z.array(PlanExpectation).min(1).max(6),
  checks: z.array(InspectionCheck).max(6),
});
export type PlanModelOutput = z.infer<typeof PlanModelOutput>;

export const InspectionPlan = z.object({
  source: z.enum(["model", "default"]),
  /** Why the default plan was used, when source is "default". */
  note: shortText(300).nullable(),
  expectations: z.array(PlanExpectation).min(1).max(6),
  checks: z.array(InspectionCheck).max(6),
});
export type InspectionPlan = z.infer<typeof InspectionPlan>;

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const CheckResult = z.object({
  checkId: z.string(),
  action: z.enum(CHECK_ACTIONS),
  status: z.enum(["ok", "not_found", "error", "skipped"]),
  detail: shortText(600),
  /** Small, bounded structured observations (booleans, counts, short strings). */
  data: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean(), z.null(), z.array(z.string().max(80)).max(12)])),
  elapsedMs: z.number().min(0),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const EgressObservation = z.object({
  phase: z.enum(["before", "after"]),
  ip: z.string().max(64).nullable(),
  at: IsoTime,
  elapsedMs: z.number().min(0),
  error: shortText(200).nullable(),
});
export type EgressObservation = z.infer<typeof EgressObservation>;

/** Where a live route's credentials came from. Shown to the user; it never changes how evidence is verified. */
export const SESSION_SOURCES = ["session_intent", "marketplace_order"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

export const RouteEvidence = z.object({
  /** Opaque reference to the ProxyHubb session intent or marketplace order, or the fixture route name. Never a credential. */
  sessionRef: shortText(120).nullable(),
  /** Null for fixture routes and for audits stored before this field existed. */
  sessionSource: z.enum(SESSION_SOURCES).nullable().default(null),
  transport: z.enum(["proxyhubb_gateway", "fixture_proxy"]),
  requestedCountry: CountryCode,
  declaredCountry: z.object({
    value: CountryCode.nullable(),
    source: shortText(160),
    observedAt: IsoTime.nullable(),
  }),
  observedEgressIp: z.string().max(64).nullable(),
  egressObservations: z.array(EgressObservation).max(4),
  geoip: z.object({
    country: CountryCode.nullable(),
    source: shortText(120),
    lookedUpAt: IsoTime.nullable(),
    note: shortText(240).nullable(),
  }),
  /** True/false when the worker's own direct egress IP could be learned; null when unknown. */
  matchesWorkerDirectIp: z.boolean().nullable(),
  assurance: z.enum(ASSURANCE_STATUSES),
  assuranceReason: shortText(400),
});
export type RouteEvidence = z.infer<typeof RouteEvidence>;

export const ScreenshotRef = z.object({
  artifactId: z.string().max(120),
  label: z.enum(["initial", "scrolled"]),
  width: z.number().int(),
  height: z.number().int(),
  bytes: z.number().int(),
  sha256: z.string().length(64),
});
export type ScreenshotRef = z.infer<typeof ScreenshotRef>;

export const RequestRecord = z.object({
  url: shortText(300),
  method: shortText(12),
  resourceType: shortText(32),
  status: z.number().int().nullable(),
  failure: shortText(160).nullable(),
});
export type RequestRecord = z.infer<typeof RequestRecord>;

export const RegionCapture = z.object({
  evidenceId: z.string().regex(/^ev-[a-z0-9]{6,12}-[A-Z]{2}$/),
  auditId: z.string(),
  requestedCountry: CountryCode,
  origin: z.enum(EVIDENCE_ORIGINS),
  /** When the browser evidence was actually captured (preserved through replay). */
  capturedAt: IsoTime,
  route: RouteEvidence,
  browser: z.object({
    profileId: z.string(),
    viewport: z.object({ width: z.number().int(), height: z.number().int() }),
    locale: z.string(),
    timezoneId: z.string(),
    userAgent: shortText(300),
    browserVersion: shortText(64),
  }),
  page: z.object({
    requestedUrl: shortText(2048),
    finalUrl: shortText(2048).nullable(),
    redirectChain: z.array(shortText(300)).max(10),
    mainDocumentStatus: z.number().int().nullable(),
    title: shortText(300).nullable(),
    /** Sanitized visible text (secrets/emails/long tokens redacted, truncated). */
    visibleText: shortText(8000),
    loadState: z.enum(["load", "domcontentloaded", "timeout", "error", "not_attempted"]),
    navigationError: shortText(300).nullable(),
  }),
  screenshots: z.array(ScreenshotRef).max(3),
  failedRequests: z.array(RequestRecord).max(40),
  blockedRequests: z.array(z.object({ url: shortText(300), reason: shortText(160) })).max(40),
  /** Requests the browser made that the policy does not approve and could not prevent (redirect hops). */
  policyViolations: z.array(z.object({ url: shortText(300), reason: shortText(200) })).max(40).default([]),
  consoleErrors: z.array(shortText(300)).max(20),
  /** Wall-clock browser timings with their definitions in `timingNotes`. */
  timings: z.object({
    navigationWallMs: z.number().nullable(),
    domContentLoadedMs: z.number().nullable(),
    loadEventMs: z.number().nullable(),
    totalCaptureMs: z.number(),
  }),
  timingNotes: shortText(400),
  checks: z.array(CheckResult).max(8),
  limits: z.object({
    requestCount: z.number().int(),
    approxBytes: z.number().int(),
    truncated: z.boolean(),
  }),
});
export type RegionCapture = z.infer<typeof RegionCapture>;

// ---------------------------------------------------------------------------
// Findings and analysis
// ---------------------------------------------------------------------------

export const FindingLocation = z.object({
  evidenceId: z.string(),
  screenshot: z.enum(["initial", "scrolled"]).nullable(),
  description: shortText(300),
  checkId: z.string().nullable(),
});
export type FindingLocation = z.infer<typeof FindingLocation>;

/** What the analysis model is allowed to return for each finding. */
export const FindingModelOutput = z.object({
  expectationId: z.string().nullable(),
  kind: z.enum(FINDING_KINDS),
  classification: z.enum(FINDING_CLASSIFICATIONS),
  severity: z.enum(SEVERITIES),
  regions: z.array(CountryCode).min(1).max(4),
  summary: shortText(300),
  observed: shortText(500),
  expected: shortText(500),
  evidenceIds: z.array(z.string()).max(8),
  location: FindingLocation.nullable(),
  reproduction: z.array(shortText(200)).max(6),
  nextAction: shortText(400),
  uncertainty: shortText(400),
});
export type FindingModelOutput = z.infer<typeof FindingModelOutput>;

export const Finding = FindingModelOutput.extend({ id: z.string().regex(/^f[0-9]{1,2}$/) });
export type Finding = z.infer<typeof Finding>;

export const ExpectationResult = z.object({
  expectationId: z.string(),
  status: z.enum(["met", "not_met", "unclear", "not_evaluated"]),
  regions: z.array(CountryCode).max(4),
  rationale: shortText(500),
});
export type ExpectationResult = z.infer<typeof ExpectationResult>;

export const AnalysisModelOutput = z.object({
  expectationResults: z.array(ExpectationResult).max(8),
  findings: z.array(FindingModelOutput).max(10),
  limitations: z.array(shortText(300)).max(8),
});
export type AnalysisModelOutput = z.infer<typeof AnalysisModelOutput>;

export const AI_FAILURE_CODES = [
  "missing_key",
  "rate_limited",
  "refused",
  "malformed_output",
  "truncated",
  "timeout",
  "http_error",
  "no_verified_evidence",
  "call_budget_exhausted",
] as const;
export type AiFailureCode = (typeof AI_FAILURE_CODES)[number];

export const UsageCall = z.object({
  stage: z.enum(["plan", "analyze"]),
  model: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  cachedTokens: z.number().int().nullable(),
  reasoningTokens: z.number().int().nullable(),
  latencyMs: z.number(),
  httpStatus: z.number().int().nullable(),
  responseId: shortText(80).nullable(),
  outcome: z.enum(["ok", "retryable_error", "fatal_error"]),
});
export type UsageCall = z.infer<typeof UsageCall>;

export const Analysis = z.object({
  status: z.enum(["not_run", "running", "completed", "failed", "skipped"]),
  failure: z
    .object({
      code: z.enum(AI_FAILURE_CODES),
      message: shortText(400),
      retryable: z.boolean(),
      attempts: z.number().int(),
    })
    .nullable(),
  model: z
    .object({
      provider: z.literal("meta"),
      id: z.string(),
      /** "standard" = provider does not train on the content. */
      dataMode: z.enum(["standard", "contributor"]),
    })
    .nullable(),
  startedAt: IsoTime.nullable(),
  completedAt: IsoTime.nullable(),
  /** Provenance of the evidence that was analyzed (a live Meta call may still see synthetic evidence). */
  evidenceOrigins: z.array(z.enum(EVIDENCE_ORIGINS)),
  expectationResults: z.array(ExpectationResult),
  findings: z.array(Finding),
  limitations: z.array(shortText(300)),
  validation: z.object({
    droppedFindings: z.array(z.object({ summary: shortText(200), reason: shortText(240) })),
    adjustedFindings: z.array(z.object({ findingId: z.string(), reason: shortText(240) })),
  }),
  usage: z.object({
    calls: z.array(UsageCall),
    totalInputTokens: z.number().int(),
    totalOutputTokens: z.number().int(),
    costEstimate: z
      .object({
        usd: z.number(),
        label: z.literal("estimate"),
        priceSource: shortText(240),
      })
      .nullable(),
  }),
  attempts: z.number().int(),
});
export type Analysis = z.infer<typeof Analysis>;

export function emptyAnalysis(status: Analysis["status"] = "not_run"): Analysis {
  return {
    status,
    failure: null,
    model: null,
    startedAt: null,
    completedAt: null,
    evidenceOrigins: [],
    expectationResults: [],
    findings: [],
    limitations: [],
    validation: { droppedFindings: [], adjustedFindings: [] },
    usage: { calls: [], totalInputTokens: 0, totalOutputTokens: 0, costEstimate: null },
    attempts: 0,
  };
}

// ---------------------------------------------------------------------------
// Job, regions, comparison
// ---------------------------------------------------------------------------

export const RegionState = z.object({
  country: CountryCode,
  status: z.enum(REGION_STATUSES),
  startedAt: IsoTime.nullable(),
  completedAt: IsoTime.nullable(),
  evidenceId: z.string().nullable(),
  assurance: z.enum(ASSURANCE_STATUSES).nullable(),
  failure: z.object({ code: shortText(48), message: shortText(400) }).nullable(),
});
export type RegionState = z.infer<typeof RegionState>;

export const StageRecord = z.object({
  name: z.enum(STAGE_NAMES),
  status: z.enum(STAGE_STATUSES),
  startedAt: IsoTime.nullable(),
  completedAt: IsoTime.nullable(),
  message: shortText(300).nullable(),
});
export type StageRecord = z.infer<typeof StageRecord>;

export const ComparisonItem = z.object({
  status: z.enum(["resolved", "persisting", "new", "incomparable"]),
  key: shortText(120),
  summary: shortText(300),
  currentFindingId: z.string().nullable(),
  previousFindingId: z.string().nullable(),
  regions: z.array(CountryCode),
  note: shortText(300).nullable(),
});
export type ComparisonItem = z.infer<typeof ComparisonItem>;

export const Comparison = z.object({
  previousAuditId: z.string(),
  comparedAt: IsoTime,
  items: z.array(ComparisonItem).max(40),
  caveats: z.array(shortText(300)),
});
export type Comparison = z.infer<typeof Comparison>;

const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which of the user's own marketplace orders carry a live audit's traffic, per region. These are
 * identifiers, not credentials: they let a rerun reuse the same orders. The credentials themselves are
 * fetched again by the web server for every run and are never stored.
 */
export const SessionPlan = z.object({
  source: z.literal("marketplace_order"),
  orders: z.record(CountryCode, z.string().regex(ORDER_ID_RE, "order ids are UUIDs")).refine((o) => Object.keys(o).length <= 8, "too many orders"),
});
export type SessionPlan = z.infer<typeof SessionPlan>;

export const AuditJob = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  ownerId: z.string().min(1).max(64),
  request: AuditRequest,
  mode: z.enum(AUDIT_MODES),
  /** The origin new captures carry, or "recorded_replay" for a replay job. */
  evidenceOrigin: z.enum(EVIDENCE_ORIGINS),
  previousAuditId: z.string().nullable(),
  replayOfAuditId: z.string().nullable(),
  status: z.enum(JOB_STATUSES),
  createdAt: IsoTime,
  startedAt: IsoTime.nullable(),
  completedAt: IsoTime.nullable(),
  cancelRequestedAt: IsoTime.nullable(),
  stages: z.array(StageRecord),
  plan: InspectionPlan.nullable(),
  regions: z.array(RegionState),
  captures: z.array(RegionCapture),
  analysis: Analysis,
  comparison: Comparison.nullable(),
  /** Model calls made while planning (kept apart so retrying analysis never loses them). */
  planUsage: z.array(UsageCall).max(12).default([]),
  /** Null when sessions were opened for the run (the default) or for fixture and replay jobs. */
  sessionPlan: SessionPlan.nullable().default(null),
  failure: z.object({ code: shortText(48), message: shortText(500) }).nullable(),
  limitations: z.array(shortText(300)),
  /** Monotonic counter for optimistic updates. */
  revision: z.number().int(),
});
export type AuditJob = z.infer<typeof AuditJob>;

/** Compact list item; never includes captures or the full analysis. */
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
  analysisStatus: Analysis["status"];
  findingCount: number;
  regionStatuses: Array<{ country: string; status: RegionStatus }>;
}

export function summarize(job: AuditJob): AuditSummary {
  return {
    id: job.id,
    targetUrl: job.request.targetUrl,
    regions: job.request.regions,
    mode: job.mode,
    evidenceOrigin: job.evidenceOrigin,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    previousAuditId: job.previousAuditId,
    analysisStatus: job.analysis.status,
    findingCount: job.analysis.findings.length,
    regionStatuses: job.regions.map((r) => ({ country: r.country, status: r.status })),
  };
}

// ---------------------------------------------------------------------------
// Internal HTTP contract
// ---------------------------------------------------------------------------

/** Per-region proxy credentials. Held in worker memory only; never persisted or returned. */
export const RegionCredential = z.object({
  /** Opaque reference (e.g. session intent id or order id) recorded in evidence. */
  sessionRef: z.string().min(1).max(120),
  source: z.enum(SESSION_SOURCES).default("session_intent"),
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(4096),
  /** Provider-declared country when the control API exposed it; otherwise omitted. */
  declaredCountry: CountryCode.optional(),
  declaredCountrySource: z.string().max(160).optional(),
});
export type RegionCredential = z.infer<typeof RegionCredential>;

/** Why the web server could not provide a session for a region (shown to the user verbatim). */
export const RegionUnavailable = z.object({ code: z.string().max(48), message: z.string().max(300) });
export type RegionUnavailable = z.infer<typeof RegionUnavailable>;

export const CreateAuditBody = z.object({
  request: AuditRequest,
  /** Live mode: one credential per requested region. A region without one is recorded as unavailable. */
  credentials: z.record(CountryCode, RegionCredential).optional(),
  unavailable: z.record(CountryCode, RegionUnavailable).optional(),
  /** Set when the credentials came from the user's own marketplace orders. */
  sessionPlan: SessionPlan.optional(),
});
export type CreateAuditBody = z.infer<typeof CreateAuditBody>;

export const RerunBody = z.object({
  credentials: z.record(CountryCode, RegionCredential).optional(),
  unavailable: z.record(CountryCode, RegionUnavailable).optional(),
  sessionPlan: SessionPlan.optional(),
});
export type RerunBody = z.infer<typeof RerunBody>;
