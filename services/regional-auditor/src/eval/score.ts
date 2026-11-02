// Pure scoring of an audit job against ground truth. No I/O, no model calls.

import type { AuditJob, Finding, RegionCapture } from "../contracts.ts";
import type { EvalCase, ExpectedDefect } from "./groundTruth.ts";

export interface DefectOutcome {
  region: string;
  description: string;
  /** Was the objective signal present in the captured evidence at all? (capture quality, independent of the model) */
  evidenceSufficient: boolean;
  /** A finding of an accepted kind in that region classified as an observed defect. */
  asserted: boolean;
  /** Only raised as a hypothesis to investigate. */
  flaggedOnly: boolean;
  /** Some observed defect in the right region but of another kind. */
  regionOnly: boolean;
}

export interface CaseScore {
  caseId: string;
  category: EvalCase["category"];
  jobStatus: AuditJob["status"];
  analysisStatus: AuditJob["analysis"]["status"];
  /** "scored" only when a completed AI analysis exists; otherwise the case is reported as skipped, never as passed. */
  scored: boolean;
  skippedReason: string | null;
  defects: DefectOutcome[];
  /** observed_defect findings that match no expected defect (all of them on a healthy case). */
  unexpectedObserved: Array<{ region: string; kind: string; summary: string }>;
  hypotheses: number;
  findingsKept: number;
  findingsDropped: number;
  findingsAdjusted: number;
  inventedEvidenceRefsRemoved: number;
  latencyMs: { job: number | null; model: number };
  tokens: { input: number; output: number };
  estimatedCostUsd: number | null;
}

function evidenceSufficient(defect: ExpectedDefect, capture: RegionCapture | undefined): boolean {
  if (!capture || capture.route.assurance !== "verified") return false;
  const text = capture.page.visibleText;
  switch (defect.evidence) {
    case "obscured":
      return capture.checks.some((c) => c.data["obscured"] === true);
    case "missing_signup":
      return !/sign up free/i.test(text) && capture.page.mainDocumentStatus === 200;
    case "wrong_currency": {
      const expected = defect.region === "GH" ? { code: "GHS", symbol: "GH₵" } : { code: "USD", symbol: "$" };
      return !text.includes(expected.code) && !text.includes(expected.symbol);
    }
    case "asset_404":
      return capture.failedRequests.some((r) => r.status === 404 && /pricing\.js/.test(r.url));
    case "http_500":
      return (capture.page.mainDocumentStatus ?? 0) >= 500;
  }
}

function matches(f: Finding, d: ExpectedDefect): boolean {
  return f.regions.includes(d.region) && d.kinds.includes(f.kind as ExpectedDefect["kinds"][number]);
}

export function scoreCase(testCase: EvalCase, job: AuditJob): CaseScore {
  const a = job.analysis;
  const scored = a.status === "completed";
  const findings = a.findings;
  const observed = findings.filter((f) => f.classification === "observed_defect");
  const defects: DefectOutcome[] = testCase.defects.map((d) => {
    const hit = observed.some((f) => matches(f, d));
    return {
      region: d.region,
      description: d.description,
      evidenceSufficient: evidenceSufficient(d, job.captures.find((c) => c.requestedCountry === d.region)),
      asserted: hit,
      flaggedOnly: !hit && findings.some((f) => f.classification === "hypothesis" && matches(f, d)),
      regionOnly: !hit && observed.some((f) => f.regions.includes(d.region)),
    };
  });
  const unexpectedObserved = observed
    .filter((f) => !testCase.defects.some((d) => matches(f, d)))
    .map((f) => ({ region: f.regions.join(","), kind: f.kind, summary: f.summary }));

  const removed = a.validation.adjustedFindings.reduce((sum, adj) => {
    const m = /removed (\d+) evidence reference/.exec(adj.reason);
    return sum + (m ? Number(m[1]) : 0);
  }, 0);
  const modelLatency = a.usage.calls.reduce((sum, c) => sum + c.latencyMs, 0);
  const created = Date.parse(job.createdAt);
  const done = job.completedAt ? Date.parse(job.completedAt) : NaN;

  return {
    caseId: testCase.id,
    category: testCase.category,
    jobStatus: job.status,
    analysisStatus: a.status,
    scored,
    skippedReason: scored ? null : a.failure?.message ?? `analysis ${a.status}`,
    defects,
    unexpectedObserved,
    hypotheses: findings.filter((f) => f.classification === "hypothesis").length,
    findingsKept: findings.length,
    findingsDropped: a.validation.droppedFindings.length,
    findingsAdjusted: a.validation.adjustedFindings.length,
    inventedEvidenceRefsRemoved: removed,
    latencyMs: { job: Number.isFinite(done - created) ? done - created : null, model: modelLatency },
    tokens: { input: a.usage.totalInputTokens, output: a.usage.totalOutputTokens },
    estimatedCostUsd: a.usage.costEstimate?.usd ?? null,
  };
}

export interface Summary {
  casesRun: number;
  casesScored: number;
  casesSkipped: number;
  seededDefects: number;
  /** Over scored cases only. */
  defects: { asserted: number; flaggedOnly: number; missed: number; regionOnly: number; evidenceSufficient: number; evidenceInsufficient: number };
  healthyControls: { scored: number; withFalseAlarm: number; falseAlarmFindings: number; hypotheses: number };
  /** Capture quality over EVERY run, scored or not: was the objective signal in the evidence at all? */
  captureLevel: { seededDefects: number; evidenceSufficient: number };
  unexpectedObservedOnDefectCases: number;
  precision: number | null;
  recall: number | null;
  evidence: { findingsKept: number; findingsDropped: number; findingsAdjusted: number; inventedRefsRemoved: number; supportedFindingRate: number | null };
  latencyMs: { jobP50: number | null; jobP95: number | null; modelP50: number | null };
  tokens: { input: number; output: number };
  estimatedCostUsd: number | null;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export function summarize(scores: CaseScore[]): Summary {
  const scored = scores.filter((s) => s.scored);
  const defects = scored.flatMap((s) => s.defects);
  const healthy = scored.filter((s) => s.category !== "defect" && s.defects.length === 0);
  const defectCases = scored.filter((s) => s.defects.length > 0);
  const asserted = defects.filter((d) => d.asserted).length;
  const unexpectedOnDefects = defectCases.reduce((n, s) => n + s.unexpectedObserved.length, 0);
  const falseOnHealthy = healthy.reduce((n, s) => n + s.unexpectedObserved.length, 0);
  const totalObserved = asserted + unexpectedOnDefects + falseOnHealthy;
  const kept = scored.reduce((n, s) => n + s.findingsKept, 0);
  const dropped = scored.reduce((n, s) => n + s.findingsDropped, 0);
  const costs = scored.map((s) => s.estimatedCostUsd).filter((c): c is number => c !== null);
  return {
    casesRun: scores.length,
    casesScored: scored.length,
    casesSkipped: scores.length - scored.length,
    seededDefects: scores.reduce((n, s) => n + s.defects.length, 0),
    defects: {
      asserted,
      flaggedOnly: defects.filter((d) => d.flaggedOnly).length,
      missed: defects.filter((d) => !d.asserted && !d.flaggedOnly).length,
      regionOnly: defects.filter((d) => d.regionOnly).length,
      evidenceSufficient: defects.filter((d) => d.evidenceSufficient).length,
      evidenceInsufficient: defects.filter((d) => !d.evidenceSufficient).length,
    },
    healthyControls: {
      scored: healthy.length,
      withFalseAlarm: healthy.filter((s) => s.unexpectedObserved.length > 0).length,
      falseAlarmFindings: falseOnHealthy,
      hypotheses: healthy.reduce((n, s) => n + s.hypotheses, 0),
    },
    captureLevel: {
      seededDefects: scores.reduce((n, x) => n + x.defects.length, 0),
      evidenceSufficient: scores.reduce((n, x) => n + x.defects.filter((d) => d.evidenceSufficient).length, 0),
    },
    unexpectedObservedOnDefectCases: unexpectedOnDefects,
    precision: totalObserved > 0 ? asserted / totalObserved : null,
    recall: defects.length > 0 ? asserted / defects.length : null,
    evidence: {
      findingsKept: kept,
      findingsDropped: dropped,
      findingsAdjusted: scored.reduce((n, s) => n + s.findingsAdjusted, 0),
      inventedRefsRemoved: scored.reduce((n, s) => n + s.inventedEvidenceRefsRemoved, 0),
      supportedFindingRate: kept + dropped > 0 ? kept / (kept + dropped) : null,
    },
    latencyMs: {
      jobP50: percentile(scored.map((s) => s.latencyMs.job).filter((n): n is number => n !== null), 50),
      jobP95: percentile(scored.map((s) => s.latencyMs.job).filter((n): n is number => n !== null), 95),
      modelP50: percentile(scored.map((s) => s.latencyMs.model), 50),
    },
    tokens: { input: scored.reduce((n, s) => n + s.tokens.input, 0), output: scored.reduce((n, s) => n + s.tokens.output, 0) },
    estimatedCostUsd: costs.length > 0 ? Math.round(costs.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null,
  };
}
