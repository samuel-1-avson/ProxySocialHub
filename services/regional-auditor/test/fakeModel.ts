// A rule-based stand-in for the Meta Model API, used ONLY in tests so the
// pipeline can be exercised deterministically. It is not a model and its
// output is never presented as one. It reads the same evidence payload a real
// model would and answers in the Responses-API shape.

import type { AnalysisModelOutput, PlanModelOutput } from "../src/contracts.ts";
import { jsonResponse, responsesBody } from "./helpers.ts";

export interface FakeModel {
  fetch: typeof fetch;
  requests: Array<{ stage: "plan" | "analyze"; body: any }>;
  /** Evidence ids the analysis request actually contained. */
  analyzedEvidenceIds(): string[];
}

const EXPECTED_CURRENCY: Record<string, string> = { GH: "GHS", US: "USD", DE: "EUR" };

interface Options {
  /** Number of leading analysis calls that fail with HTTP 500 (retries consume one each). */
  failAnalysisCalls?: number;
  /** Extra findings appended to every analysis answer (for validation tests). */
  extraFindings?: AnalysisModelOutput["findings"];
}

export function makeFakeModel(options: Options = {}): FakeModel {
  const requests: FakeModel["requests"] = [];
  let analysisCalls = 0;

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = body.text?.format?.name as string;
    const parts = body.input[0].content as Array<{ type: string; text?: string }>;

    if (name === "inspection_plan") {
      requests.push({ stage: "plan", body });
      const plan: PlanModelOutput = {
        expectations: [
          { id: "e1", text: "Signup is usable in every region", checkIds: ["c1"] },
          { id: "e2", text: "The expected currency is displayed", checkIds: ["c2"] },
        ],
        checks: [
          { id: "c1", action: "find_control", text: null, role: "button", name: "Sign up" },
          { id: "c2", action: "read_currency", text: null, role: null, name: null },
        ],
      };
      return jsonResponse(200, responsesBody(plan));
    }

    requests.push({ stage: "analyze", body });
    analysisCalls += 1;
    if (analysisCalls <= (options.failAnalysisCalls ?? 0)) return jsonResponse(500, { error: { message: "upstream exploded", type: "server_error" } });

    const findings: AnalysisModelOutput["findings"] = [];
    for (const part of parts) {
      const m = /^Evidence (ev-[a-z0-9]+-([A-Z]{2})) \(region [A-Z]{2}\):\n<untrusted_page_content>\n([\s\S]*)\n<\/untrusted_page_content>$/.exec(part.text ?? "");
      if (!m) continue;
      const [, evidenceId, country, json] = m as unknown as [string, string, string, string];
      const ev = JSON.parse(json) as { checks: Array<{ checkId: string; data: Record<string, unknown>; status: string }>; page: { mainDocumentStatus: number | null }; failedRequests: unknown[] };
      const control = ev.checks.find((c) => c.checkId === "c1");
      if (control && control.data["obscured"] === true) {
        findings.push({
          expectationId: "e1", kind: "element_obscured", classification: "observed_defect", severity: "high", regions: [country],
          summary: `Sign up is covered in ${country}`, observed: "Another element sits on top of the Sign up button.", expected: "Sign up is clickable",
          evidenceIds: [evidenceId], location: { evidenceId, screenshot: "initial", description: "bottom of the page", checkId: "c1" },
          reproduction: ["Open the page", "Try to click Sign up"], nextAction: "Fix the overlay", uncertainty: "Directly observed in one viewport.",
        });
      }
      const currency = ev.checks.find((c) => c.checkId === "c2");
      const codes = (currency?.data["codes"] as string[] | undefined) ?? [];
      if (currency && !codes.includes(EXPECTED_CURRENCY[country] ?? "")) {
        findings.push({
          expectationId: "e2", kind: "currency_mismatch", classification: "observed_defect", severity: "medium", regions: [country],
          summary: `Unexpected currency in ${country}`, observed: `Currency codes found: ${codes.join(", ") || "none"}.`, expected: `Prices in ${EXPECTED_CURRENCY[country]}`,
          evidenceIds: [evidenceId], location: null, reproduction: ["Open the page"], nextAction: "Fix currency selection", uncertainty: "Text-based observation.",
        });
      }
    }
    const answer: AnalysisModelOutput = {
      expectationResults: [
        { expectationId: "e1", status: findings.some((f) => f.kind === "element_obscured") ? "not_met" : "met", regions: [], rationale: "Based on the control check." },
        { expectationId: "e2", status: findings.some((f) => f.kind === "currency_mismatch") ? "not_met" : "met", regions: [], rationale: "Based on the currency read." },
      ],
      findings: [...findings, ...(options.extraFindings ?? [])],
      limitations: ["Fake model used in tests."],
    };
    return jsonResponse(200, responsesBody(answer));
  }) as unknown as typeof fetch;

  return {
    fetch: fetchImpl,
    requests,
    analyzedEvidenceIds() {
      const last = [...requests].reverse().find((r) => r.stage === "analyze");
      if (!last) return [];
      const text = (last.body.input[0].content as Array<{ text?: string }>).map((p) => p.text ?? "").join("\n");
      return [...text.matchAll(/^Evidence (ev-[a-z0-9]+-[A-Z]{2}) /gm)].map((m) => m[1]!);
    },
  };
}
