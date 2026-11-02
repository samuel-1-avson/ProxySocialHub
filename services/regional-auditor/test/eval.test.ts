import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EVAL_CASES } from "../src/eval/groundTruth.ts";
import { scoreCase, summarize } from "../src/eval/score.ts";
import { SCENARIOS, type Defect } from "../src/fixtures/scenarios.ts";
import type { AuditJob } from "../src/contracts.ts";
import { capture, finding } from "./helpers.ts";

const emptyAnalysis = (over: Partial<AuditJob["analysis"]> = {}): AuditJob["analysis"] => ({
  status: "completed", failure: null, model: null, startedAt: null, completedAt: null, evidenceOrigins: [], expectationResults: [], findings: [], limitations: [],
  validation: { droppedFindings: [], adjustedFindings: [] }, usage: { calls: [], totalInputTokens: 0, totalOutputTokens: 0, costEstimate: null }, attempts: 1, ...over,
});

function job(over: Partial<AuditJob>): AuditJob {
  return {
    schemaVersion: 1, id: "aud_000000000001", ownerId: "owner-aaaaaaaa", request: {} as AuditJob["request"], mode: "fixture", evidenceOrigin: "synthetic_fixture",
    previousAuditId: null, replayOfAuditId: null, status: "completed", createdAt: "2026-11-01T10:00:00.000Z", startedAt: null, completedAt: "2026-11-01T10:00:20.000Z",
    cancelRequestedAt: null, stages: [], plan: null, regions: [], captures: [], analysis: emptyAnalysis(), comparison: null, planUsage: [], sessionPlan: null, failure: null, limitations: [], revision: 0, ...over,
  };
}

const byId = (id: string) => EVAL_CASES.find((c) => c.id === id)!;

describe("evaluation ground truth", () => {
  it("has 12-15 labelled cases with both defects and healthy controls", () => {
    assert.ok(EVAL_CASES.length >= 12 && EVAL_CASES.length <= 15);
    assert.ok(EVAL_CASES.some((c) => c.defects.length > 0));
    assert.ok(EVAL_CASES.filter((c) => c.defects.length === 0).length >= 4);
  });

  it("every case points at a real demo scenario and its labels match what that scenario seeds", () => {
    const expectedBySeeded: Record<Defect, string | null> = {
      signup_obscured: "obscured", wrong_currency: "wrong_currency", asset_404: "asset_404", signup_missing: "missing_signup", server_error: "http_500",
      bot_challenge: null, prompt_injection: null, regional_promo: null,
    };
    for (const c of EVAL_CASES) {
      const scenario = SCENARIOS.find((s) => s.id === c.scenario);
      assert.ok(scenario, `${c.id}: unknown scenario ${c.scenario}`);
      const seeded = Object.entries(scenario.regions).flatMap(([region, defects]) => defects.map((d) => ({ region, evidence: expectedBySeeded[d] })).filter((x) => x.evidence));
      const labelled = c.defects.map((d) => ({ region: d.region, evidence: d.evidence }));
      assert.deepEqual(labelled.sort(cmp), seeded.sort(cmp), `${c.id}: labels must equal the defects the scenario seeds`);
    }
  });
});
const cmp = (a: { region: string; evidence: string | null }, b: { region: string; evidence: string | null }) => `${a.region}${a.evidence}`.localeCompare(`${b.region}${b.evidence}`);

describe("scoring", () => {
  it("counts a matching observed defect as detected and an unrelated one as unexpected", () => {
    const c = byId("signup-obscured-gh");
    const gh = capture("GH", { checks: [{ checkId: "c1", action: "find_control", status: "ok", detail: "", data: { obscured: true }, elapsedMs: 1 }] });
    const s = scoreCase(c, job({ captures: [gh], analysis: emptyAnalysis({ findings: [{ ...finding(), id: "f1" }, { ...finding({ kind: "currency_mismatch", regions: ["US"] }), id: "f2" }] }) }));
    assert.equal(s.scored, true);
    assert.deepEqual(s.defects.map((d) => [d.asserted, d.evidenceSufficient]), [[true, true]]);
    assert.equal(s.unexpectedObserved.length, 1);
  });

  it("distinguishes hypothesis-only, right-region-wrong-kind and missed", () => {
    const c = byId("wrong-currency-us");
    const hypo = scoreCase(c, job({ analysis: emptyAnalysis({ findings: [{ ...finding({ kind: "currency_mismatch", classification: "hypothesis", regions: ["US"] }), id: "f1" }] }) }));
    assert.deepEqual([hypo.defects[0]!.asserted, hypo.defects[0]!.flaggedOnly], [false, true]);
    const wrongKind = scoreCase(c, job({ analysis: emptyAnalysis({ findings: [{ ...finding({ kind: "performance", regions: ["US"] }), id: "f1" }] }) }));
    assert.deepEqual([wrongKind.defects[0]!.asserted, wrongKind.defects[0]!.regionOnly], [false, true]);
    const missed = scoreCase(c, job({ analysis: emptyAnalysis() }));
    assert.deepEqual([missed.defects[0]!.asserted, missed.defects[0]!.flaggedOnly, missed.defects[0]!.regionOnly], [false, false, false]);
  });

  it("treats any observed defect on a healthy control as a false alarm, but hypotheses only as noise", () => {
    const healthy = byId("healthy-control");
    const alarm = scoreCase(healthy, job({ analysis: emptyAnalysis({ findings: [{ ...finding(), id: "f1" }] }) }));
    assert.equal(alarm.unexpectedObserved.length, 1);
    const noise = scoreCase(healthy, job({ analysis: emptyAnalysis({ findings: [{ ...finding({ classification: "hypothesis" }), id: "f1" }] }) }));
    assert.equal(noise.unexpectedObserved.length, 0);
    assert.equal(noise.hypotheses, 1);
  });

  it("never scores a case without a completed analysis: it is skipped, not passed", () => {
    const s = scoreCase(byId("demo-v1"), job({ analysis: emptyAnalysis({ status: "not_run", failure: { code: "missing_key", message: "AI analysis not run", retryable: false, attempts: 0 } }) }));
    assert.equal(s.scored, false);
    assert.match(s.skippedReason ?? "", /AI analysis not run/);
    const sum = summarize([s]);
    assert.deepEqual([sum.casesRun, sum.casesScored, sum.casesSkipped], [1, 0, 1]);
    assert.equal(sum.recall, null);
    assert.equal(sum.defects.asserted + sum.defects.missed, 0);
  });

  it("separates capture quality from model quality", () => {
    // Evidence lacked the signal: the defect was undetectable regardless of the model.
    const s = scoreCase(byId("signup-obscured-gh"), job({ captures: [capture("GH")], analysis: emptyAnalysis() }));
    assert.equal(s.defects[0]!.evidenceSufficient, false);
    const sum = summarize([s]);
    assert.deepEqual([sum.captureLevel.seededDefects, sum.captureLevel.evidenceSufficient], [2 - 1, 0]);
  });

  it("computes precision, recall and evidence support over scored runs", () => {
    const detected = scoreCase(byId("signup-obscured-gh"), job({ analysis: emptyAnalysis({ findings: [{ ...finding(), id: "f1" }], validation: { droppedFindings: [{ summary: "x", reason: "no valid evidence reference supports this finding" }], adjustedFindings: [{ findingId: "f1", reason: "removed 2 evidence reference(s) that do not exist" }] } }) }));
    const missed = scoreCase(byId("wrong-currency-us"), job({ analysis: emptyAnalysis() }));
    const falseAlarm = scoreCase(byId("healthy-control"), job({ analysis: emptyAnalysis({ findings: [{ ...finding({ regions: ["US"] }), id: "f1" }] }) }));
    const sum = summarize([detected, missed, falseAlarm]);
    assert.equal(sum.defects.asserted, 1);
    assert.equal(sum.defects.missed, 1);
    assert.equal(sum.recall, 0.5);
    assert.equal(sum.precision, 0.5); // 1 correct of 2 observed defects asserted
    assert.equal(sum.healthyControls.withFalseAlarm, 1);
    assert.equal(sum.evidence.inventedRefsRemoved, 2);
    assert.equal(sum.evidence.findingsDropped, 1);
  });
});
