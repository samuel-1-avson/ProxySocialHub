import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDefaultPlan, validateAnalysis, validatePlan } from "../src/ai/validate.ts";
import { AUDIT_ID, capture, finding, plan } from "./helpers.ts";

const evGH = `ev-${AUDIT_ID.slice(4, 12)}-GH`;
const evUS = `ev-${AUDIT_ID.slice(4, 12)}-US`;

function rawAnalysis(findings: unknown[], results: unknown[] = []) {
  return { expectationResults: results, findings, limitations: [] };
}

describe("validatePlan: the model may only request bounded, read-only checks", () => {
  const ok = { id: "c1", action: "find_text", text: "Sign up", role: null, name: null };

  it("accepts a valid plan and links checks to expectations", () => {
    const v = validatePlan({ expectations: [{ id: "e1", text: "1. Signup works", checkIds: ["c1"] }], checks: [ok] }, 6);
    assert.ok(v.plan);
    assert.equal(v.plan.expectations[0]!.text, "Signup works");
    assert.deepEqual(v.plan.checks.map((c) => c.id), ["c1"]);
  });

  it("rejects unsupported actions via the schema", () => {
    const v = validatePlan({ expectations: [{ id: "e1", text: "x", checkIds: ["c1"] }], checks: [{ ...ok, action: "execute_shell" }] }, 6);
    assert.equal(v.plan, null);
  });

  it("drops checks with missing parameters or URL-like parameters", () => {
    const v = validatePlan(
      {
        expectations: [{ id: "e1", text: "x", checkIds: ["c1", "c2", "c3"] }],
        checks: [
          { id: "c1", action: "find_control", text: null, role: null, name: null },
          { id: "c2", action: "follow_link", text: "https://evil.example/steal", role: null, name: null },
          { id: "c3", action: "find_text", text: "//evil.example.com/x", role: null, name: null },
        ],
      },
      6,
    );
    assert.ok(v.plan);
    assert.equal(v.plan.checks.length, 0);
    assert.equal(v.rejected.length, 3);
    assert.deepEqual(v.plan.expectations[0]!.checkIds, []);
  });

  it("enforces the configured maximum number of checks", () => {
    const checks = Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, action: "read_currency", text: null, role: null, name: null }));
    const v = validatePlan({ expectations: [{ id: "e1", text: "x", checkIds: [] }], checks }, 2);
    assert.equal(v.plan?.checks.length, 2);
    assert.equal(v.rejected.length, 3);
  });

  it("falls back to a clearly labelled default plan", () => {
    const p = buildDefaultPlan("Check pricing", "AI planning not run");
    assert.equal(p.source, "default");
    assert.match(p.note ?? "", /AI planning not run/);
  });
});

describe("validateAnalysis: findings must be backed by real, verified evidence", () => {
  const ctx = () => ({
    plan: plan(),
    captures: [
      capture("GH", { checks: [{ checkId: "c1", action: "find_control", status: "ok", detail: "covered", data: { obscured: true }, elapsedMs: 5 }] }),
      capture("US"),
    ],
  });

  it("keeps a supported observed defect and numbers findings", () => {
    const r = validateAnalysis(rawAnalysis([finding()]), ctx());
    assert.ok(r.ok);
    assert.equal(r.parts.findings.length, 1);
    assert.equal(r.parts.findings[0]!.id, "f1");
    assert.equal(r.parts.findings[0]!.classification, "observed_defect");
  });

  it("drops a finding whose only evidence id does not exist", () => {
    const r = validateAnalysis(rawAnalysis([finding({ evidenceIds: ["ev-deadbeef-GH"] })]), ctx());
    assert.ok(r.ok);
    assert.equal(r.parts.findings.length, 0);
    assert.equal(r.parts.validation.droppedFindings.length, 1);
    assert.match(r.parts.validation.droppedFindings[0]!.reason, /no valid evidence/);
  });

  it("removes only the invented ids when real ones remain, and records it", () => {
    const r = validateAnalysis(rawAnalysis([finding({ evidenceIds: [evGH, "ev-00000000-GH"] })]), ctx());
    assert.ok(r.ok);
    assert.deepEqual(r.parts.findings[0]!.evidenceIds, [evGH]);
    assert.ok(r.parts.validation.adjustedFindings.some((a) => /do not exist/.test(a.reason)));
  });

  it("removes regions that have no cited evidence", () => {
    const r = validateAnalysis(rawAnalysis([finding({ regions: ["GH", "US"], evidenceIds: [evGH] })]), ctx());
    assert.ok(r.ok);
    assert.deepEqual(r.parts.findings[0]!.regions, ["GH"]);
  });

  it("drops a finding about a region that has no verified capture at all", () => {
    const r = validateAnalysis(rawAnalysis([finding({ regions: ["NG"], evidenceIds: [evGH] })]), ctx());
    assert.ok(r.ok);
    assert.equal(r.parts.findings.length, 0);
  });

  it("downgrades a claimed defect that the recorded facts do not support", () => {
    // asset_failed with no failed request recorded in the cited capture
    const r = validateAnalysis(rawAnalysis([finding({ kind: "asset_failed", regions: ["US"], evidenceIds: [evUS], severity: "critical" })]), ctx());
    assert.ok(r.ok);
    const f = r.parts.findings[0]!;
    assert.equal(f.classification, "hypothesis");
    assert.equal(f.severity, "medium");
    assert.ok(r.parts.validation.adjustedFindings.some((a) => /does not directly record/.test(a.reason)));
  });

  it("accepts asset_failed when a failed request is actually recorded", () => {
    const c = ctx();
    c.captures[1] = capture("US", { failedRequests: [{ url: "http://x/assets/pricing.js", method: "GET", resourceType: "script", status: 404, failure: null }] });
    const r = validateAnalysis(rawAnalysis([finding({ kind: "asset_failed", regions: ["US"], evidenceIds: [evUS] })]), c);
    assert.ok(r.ok);
    assert.equal(r.parts.findings[0]!.classification, "observed_defect");
  });

  it("clears a location that points at a screenshot or check that does not exist", () => {
    const r = validateAnalysis(
      rawAnalysis([finding({ location: { evidenceId: evGH, screenshot: "scrolled", description: "bottom", checkId: null } })]),
      ctx(),
    );
    assert.ok(r.ok);
    assert.equal(r.parts.findings[0]!.location, null);
  });

  it("clears unknown expectation references", () => {
    const r = validateAnalysis(rawAnalysis([finding({ expectationId: "e9" })]), ctx());
    assert.ok(r.ok);
    assert.equal(r.parts.findings[0]!.expectationId, null);
  });

  it("does not let a model mark an expectation met while an observed defect cites it", () => {
    const r = validateAnalysis(rawAnalysis([finding()], [{ expectationId: "e1", status: "met", regions: ["GH"], rationale: "looks fine" }]), ctx());
    assert.ok(r.ok);
    assert.equal(r.parts.expectationResults.find((e) => e.expectationId === "e1")!.status, "not_met");
  });

  it("reports unanswered expectations as not_evaluated instead of silently passing them", () => {
    const r = validateAnalysis(rawAnalysis([], []), ctx());
    assert.ok(r.ok);
    assert.deepEqual(r.parts.expectationResults.map((e) => e.status), ["not_evaluated", "not_evaluated"]);
  });

  it("keeps hypotheses as hypotheses and caps their severity", () => {
    const r = validateAnalysis(rawAnalysis([finding({ classification: "hypothesis", severity: "critical", evidenceIds: [] })]), ctx());
    assert.ok(r.ok);
    assert.equal(r.parts.findings[0]!.classification, "hypothesis");
    assert.equal(r.parts.findings[0]!.severity, "medium");
  });

  it("redacts secrets the model echoes back", () => {
    const r = validateAnalysis(rawAnalysis([finding({ observed: "page showed api_key=sk_live_1234567890abcdef and me@example.com" })]), ctx());
    assert.ok(r.ok);
    assert.doesNotMatch(r.parts.findings[0]!.observed, /sk_live_|me@example/);
  });

  it("rejects output that does not match the schema instead of guessing", () => {
    const r = validateAnalysis({ findings: "nope" }, ctx());
    assert.equal(r.ok, false);
    const bad = validateAnalysis(rawAnalysis([{ ...finding(), kind: "made_up_kind" }]), ctx());
    assert.equal(bad.ok, false);
  });

  it("clips over-long model text rather than rejecting the whole report", () => {
    const r = validateAnalysis(rawAnalysis([finding({ summary: "x".repeat(900) })]), ctx());
    assert.ok(r.ok);
    assert.ok(r.parts.findings[0]!.summary.length <= 300);
  });
});
