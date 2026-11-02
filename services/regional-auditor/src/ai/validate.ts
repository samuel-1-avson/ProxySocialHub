// Validation of everything the model returns. Model output is untrusted:
// it is schema-checked, grounded against the evidence that was actually
// collected, and anything unsupported is dropped or downgraded with a
// recorded reason (never silently kept).

import {
  AnalysisModelOutput,
  PlanModelOutput,
  type Analysis,
  type CheckAction,
  type ExpectationResult,
  type Finding,
  type FindingModelOutput,
  type InspectionCheck,
  type InspectionPlan,
  type PlanExpectation,
  type RegionCapture,
} from "../contracts.ts";
import { redactSecrets } from "../redact.ts";
import { truncate } from "../util.ts";

// ---------------------------------------------------------------------------
// Inspection plan
// ---------------------------------------------------------------------------

const URL_LIKE = /(?:https?:\/\/|javascript:|data:|file:|\/\/[a-z0-9.-]+\.[a-z]{2,})/i;

function actionParamsValid(check: InspectionCheck): string | null {
  const nonEmpty = (v: string | null) => typeof v === "string" && v.trim().length > 0;
  switch (check.action as CheckAction) {
    case "find_text":
      return nonEmpty(check.text) ? null : "find_text needs text";
    case "find_control":
      return nonEmpty(check.name) ? null : "find_control needs a name";
    case "follow_link":
      return nonEmpty(check.text) ? null : "follow_link needs the visible link text";
    case "read_currency":
    case "scroll_capture":
      return null;
    default:
      return "unsupported action";
  }
}

export interface PlanValidation {
  plan: InspectionPlan | null;
  rejected: Array<{ id: string; reason: string }>;
}

export function validatePlan(raw: unknown, maxChecks: number): PlanValidation {
  const parsed = PlanModelOutput.safeParse(clipDeep(raw, 400));
  if (!parsed.success) return { plan: null, rejected: [{ id: "plan", reason: "does not match the plan schema" }] };

  const rejected: PlanValidation["rejected"] = [];
  const accepted: InspectionCheck[] = [];
  const seen = new Set<string>();
  for (const check of parsed.data.checks) {
    if (seen.has(check.id)) {
      rejected.push({ id: check.id, reason: "duplicate check id" });
      continue;
    }
    seen.add(check.id);
    const problem = actionParamsValid(check);
    if (problem) {
      rejected.push({ id: check.id, reason: problem });
      continue;
    }
    const strings = [check.text, check.name].filter((s): s is string => typeof s === "string");
    if (strings.some((s) => URL_LIKE.test(s))) {
      rejected.push({ id: check.id, reason: "URLs are not allowed in check parameters" });
      continue;
    }
    if (accepted.length >= maxChecks) {
      rejected.push({ id: check.id, reason: `more than ${maxChecks} checks` });
      continue;
    }
    accepted.push({
      ...check,
      text: check.text === null ? null : redactSecrets(check.text.trim()),
      name: check.name === null ? null : redactSecrets(check.name.trim()),
    });
  }
  const acceptedIds = new Set(accepted.map((c) => c.id));
  const expectations: PlanExpectation[] = parsed.data.expectations.map((e) => ({
    id: e.id,
    text: redactSecrets(e.text.replace(/^\s*(?:\d+|[a-z])[.)]\s+/i, "").trim()),
    checkIds: e.checkIds.filter((id) => acceptedIds.has(id)),
  }));
  const uniqueExpectations = expectations.filter((e, i) => expectations.findIndex((x) => x.id === e.id) === i);
  if (uniqueExpectations.length === 0) return { plan: null, rejected: [...rejected, { id: "plan", reason: "no usable expectations" }] };

  return {
    plan: { source: "model", note: null, expectations: uniqueExpectations, checks: accepted },
    rejected,
  };
}

/** Deterministic plan used when no model is configured or planning failed. */
export function buildDefaultPlan(userExpectations: string, note: string): InspectionPlan {
  return {
    source: "default",
    note,
    expectations: [{ id: "e1", text: truncate(redactSecrets(userExpectations.replace(/\s+/g, " ").trim()), 400), checkIds: ["c1"] }],
    checks: [{ id: "c1", action: "read_currency", text: null, role: null, name: null }],
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

const FIELD_LIMITS: Record<string, number> = {
  summary: 300,
  observed: 500,
  expected: 500,
  nextAction: 400,
  uncertainty: 400,
  description: 300,
  rationale: 500,
  text: 400,
};

/** Clip over-long strings instead of rejecting a whole otherwise-valid answer. */
function clipDeep(value: unknown, fallbackMax: number, key = ""): unknown {
  if (typeof value === "string") return truncate(value, FIELD_LIMITS[key] ?? fallbackMax);
  if (Array.isArray(value)) return value.map((v) => clipDeep(v, key === "reproduction" ? 200 : key === "limitations" ? 300 : fallbackMax, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clipDeep(v, fallbackMax, k)]));
  }
  return value;
}

export interface AnalysisValidationContext {
  /** Captures whose route assurance is verified: the only evidence a model may cite. */
  captures: RegionCapture[];
  plan: InspectionPlan;
}

export type AnalysisParts = Pick<Analysis, "expectationResults" | "findings" | "limitations" | "validation">;

export function validateAnalysis(raw: unknown, ctx: AnalysisValidationContext): { ok: true; parts: AnalysisParts } | { ok: false; message: string } {
  const parsed = AnalysisModelOutput.safeParse(clipDeep(raw, 500));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Model output does not match the report schema (${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"}).` };
  }

  const byEvidence = new Map(ctx.captures.map((c) => [c.evidenceId, c]));
  const regionsWithEvidence = new Set(ctx.captures.map((c) => c.requestedCountry));
  const expectationIds = new Set(ctx.plan.expectations.map((e) => e.id));
  const dropped: Analysis["validation"]["droppedFindings"] = [];
  const adjusted: Analysis["validation"]["adjustedFindings"] = [];
  const kept: Array<{ finding: FindingModelOutput; notes: string[] }> = [];

  for (const original of parsed.data.findings) {
    const finding: FindingModelOutput = { ...original };
    const notes: string[] = [];
    const summary = truncate(redactSecrets(finding.summary), 200);

    const validIds = [...new Set(finding.evidenceIds)].filter((id) => byEvidence.has(id));
    const unknownIds = finding.evidenceIds.filter((id) => !byEvidence.has(id));
    if (unknownIds.length > 0) notes.push(`removed ${unknownIds.length} evidence reference(s) that do not exist`);
    finding.evidenceIds = validIds;

    if (finding.classification !== "hypothesis" && validIds.length === 0) {
      dropped.push({ summary, reason: "no valid evidence reference supports this finding" });
      continue;
    }

    const citedRegions = new Set(validIds.map((id) => byEvidence.get(id)!.requestedCountry));
    const regions = [...new Set(finding.regions)].filter((r) => regionsWithEvidence.has(r));
    const supportedRegions = finding.classification === "hypothesis" ? regions : regions.filter((r) => citedRegions.has(r));
    if (supportedRegions.length !== finding.regions.length) notes.push("removed regions without cited evidence");
    if (supportedRegions.length === 0) {
      dropped.push({ summary, reason: "no affected region is backed by cited, verified evidence" });
      continue;
    }
    finding.regions = supportedRegions;

    if (finding.expectationId !== null && !expectationIds.has(finding.expectationId)) {
      notes.push("unknown expectation reference cleared");
      finding.expectationId = null;
    }

    // Location must point at something that exists.
    if (finding.location) {
      const capture = byEvidence.get(finding.location.evidenceId);
      const screenshotOk = !finding.location.screenshot || !!capture?.screenshots.some((s) => s.label === finding.location!.screenshot);
      const checkOk = !finding.location.checkId || !!capture?.checks.some((c) => c.checkId === finding.location!.checkId);
      if (!capture || !validIds.includes(finding.location.evidenceId) || !screenshotOk || !checkOk) {
        notes.push("location removed because it does not match cited evidence");
        finding.location = null;
      }
    }

    // Objective grounding: certain claims need matching recorded facts.
    if (finding.classification === "observed_defect" && !groundedInEvidence(finding, validIds.map((id) => byEvidence.get(id)!))) {
      finding.classification = "hypothesis";
      notes.push("downgraded to hypothesis: the cited evidence does not directly record this kind of defect");
    }
    if (finding.classification === "hypothesis" && (finding.severity === "critical" || finding.severity === "high")) {
      finding.severity = "medium";
      notes.push("severity capped for a hypothesis");
    }

    finding.summary = redactSecrets(finding.summary);
    finding.observed = redactSecrets(finding.observed);
    finding.expected = redactSecrets(finding.expected);
    finding.nextAction = redactSecrets(finding.nextAction);
    finding.uncertainty = redactSecrets(finding.uncertainty);
    finding.reproduction = finding.reproduction.map(redactSecrets);
    kept.push({ finding, notes });
  }

  const findings: Finding[] = kept.slice(0, 10).map(({ finding, notes }, i) => {
    const id = `f${i + 1}`;
    for (const note of notes) adjusted.push({ findingId: id, reason: note });
    return { ...finding, id };
  });

  const results = new Map<string, ExpectationResult>();
  for (const r of parsed.data.expectationResults) {
    if (!expectationIds.has(r.expectationId) || results.has(r.expectationId)) continue;
    results.set(r.expectationId, {
      ...r,
      regions: r.regions.filter((c) => regionsWithEvidence.has(c)),
      rationale: redactSecrets(r.rationale),
    });
  }
  const expectationResults: ExpectationResult[] = ctx.plan.expectations.map((e) => {
    const given = results.get(e.id) ?? {
      expectationId: e.id,
      status: "not_evaluated" as const,
      regions: [],
      rationale: "The model did not return a result for this expectation.",
    };
    const defect = findings.find((f) => f.expectationId === e.id && f.classification === "observed_defect");
    if (defect && given.status === "met") {
      adjusted.push({ findingId: defect.id, reason: `expectation ${e.id} marked met by the model but an observed defect cites it; status set to not_met` });
      const defectRegions = findings.filter((f) => f.expectationId === e.id && f.classification === "observed_defect").flatMap((f) => f.regions);
      return { ...given, status: "not_met" as const, regions: [...new Set(defectRegions)] };
    }
    return given;
  });

  return {
    ok: true,
    parts: {
      expectationResults,
      findings,
      limitations: parsed.data.limitations.map(redactSecrets),
      validation: { droppedFindings: dropped, adjustedFindings: adjusted },
    },
  };
}

function groundedInEvidence(finding: FindingModelOutput, cited: RegionCapture[]): boolean {
  switch (finding.kind) {
    case "asset_failed":
      return cited.some((c) => c.failedRequests.length > 0);
    case "element_obscured":
      return cited.some((c) => c.checks.some((k) => k.data["obscured"] === true));
    case "element_missing":
      // A not_found check only counts when the planned name does not also appear in the page text:
      // planned roles/names are guesses made before the page was seen.
      return cited.some((c) =>
        c.checks.some((k) => {
          if (k.status !== "not_found") return false;
          const needle = String(k.data["name"] ?? k.data["searched"] ?? k.data["link"] ?? "").toLowerCase().trim();
          return needle.length === 0 || !c.page.visibleText.toLowerCase().includes(needle);
        }),
      );
    case "navigation_error":
      return cited.some(
        (c) =>
          c.page.navigationError !== null ||
          (c.page.mainDocumentStatus !== null && c.page.mainDocumentStatus >= 400) ||
          c.page.loadState === "error" ||
          c.page.loadState === "timeout",
      );
    default:
      return true;
  }
}
