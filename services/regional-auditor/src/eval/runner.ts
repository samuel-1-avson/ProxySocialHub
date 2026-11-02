// Runs the labelled evaluation cases through the real pipeline (real browser,
// real fixture proxy, and a real model when MODEL_API_KEY is configured) and
// scores them against ground truth. Raw results are returned separately from
// the ground truth and never overwrite it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MetaClient } from "../ai/meta.ts";
import type { AuditorConfig } from "../config.ts";
import { startFixtureHarness } from "../fixtures/harness.ts";
import { AuditRunner } from "../runner.ts";
import { FileArtifactStore, FileJobStore } from "../store/fileStore.ts";
import { EVAL_CASES, EVAL_EXPECTATIONS, EVAL_REGIONS, type EvalCase } from "./groundTruth.ts";
import { scoreCase, summarize, type CaseScore, type Summary } from "./score.ts";

export interface EvalRun {
  caseId: string;
  repeat: number;
  jobId: string;
  score: CaseScore;
  /** What the model actually said, kept for inspection next to (not inside) the ground truth. */
  modelFindings: Array<{ regions: string[]; kind: string; classification: string; severity: string; summary: string; evidenceIds: string[] }>;
  validation: { dropped: Array<{ summary: string; reason: string }>; adjusted: Array<{ findingId: string; reason: string }> };
}

export interface EvalReport {
  startedAt: string;
  finishedAt: string;
  mode: "synthetic_fixture";
  model: { id: string; dataMode: string; configured: boolean };
  repeat: number;
  caveats: string[];
  runs: EvalRun[];
  summary: Summary;
}

export async function runEval(options: { config: AuditorConfig; repeat?: number; cases?: string[]; log?: (line: string) => void }): Promise<EvalReport> {
  const { config } = options;
  const log = options.log ?? (() => undefined);
  const repeat = Math.max(1, options.repeat ?? 1);
  const selected: EvalCase[] = options.cases?.length ? EVAL_CASES.filter((c) => options.cases!.includes(c.id)) : EVAL_CASES;
  if (selected.length === 0) throw new Error("no matching evaluation cases");

  const startedAt = new Date().toISOString();
  const harness = await startFixtureHarness();
  const dir = await mkdtemp(path.join(tmpdir(), "auditor-eval-"));
  const store = new FileJobStore(dir);
  const meta = new MetaClient(config.model);
  const runner = new AuditRunner({
    config: { ...config, limits: { ...config.limits, maxActiveJobsPerOwner: 20, createsPerOwnerPerHour: 1000, maxQueue: 500 } },
    store,
    artifacts: new FileArtifactStore(dir),
    meta,
    fixture: harness,
  });

  const runs: EvalRun[] = [];
  try {
    for (let r = 1; r <= repeat; r++) {
      for (const testCase of selected) {
        harness.setScenario(testCase.scenario);
        const created = await runner.create("eval-runner-0001", {
          request: { targetUrl: `${harness.targetOrigin}/`, regions: EVAL_REGIONS, expectations: EVAL_EXPECTATIONS, mode: "fixture" },
        });
        await runner.idle();
        const job = (await store.get(created.id))!;
        const score = scoreCase(testCase, job);
        runs.push({
          caseId: testCase.id,
          repeat: r,
          jobId: job.id,
          score,
          modelFindings: job.analysis.findings.map((f) => ({ regions: f.regions, kind: f.kind, classification: f.classification, severity: f.severity, summary: f.summary, evidenceIds: f.evidenceIds })),
          validation: { dropped: job.analysis.validation.droppedFindings, adjusted: job.analysis.validation.adjustedFindings },
        });
        const found = score.defects.filter((d) => d.asserted).length;
        log(
          `[${r}/${repeat}] ${testCase.id.padEnd(24)} ${score.scored ? `defects ${found}/${score.defects.length}  unexpected ${score.unexpectedObserved.length}  findings ${score.findingsKept}` : `SKIPPED (${score.skippedReason})`}`,
        );
      }
    }
  } finally {
    await runner.shutdown();
    await harness.stop();
    await rm(dir, { recursive: true, force: true });
  }

  const summary = summarize(runs.map((r) => r.score));
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    mode: "synthetic_fixture",
    model: { id: config.model.id, dataMode: config.model.dataMode, configured: meta.configured },
    repeat,
    caveats: [
      "Synthetic fixture cases built by the authors of this tool; ground truth is hand-written in src/eval/groundTruth.ts.",
      "A small, seeded suite measures this prototype on these cases only. It is not a general accuracy figure.",
      "Model output varies between runs; use --repeat to see the spread. Cases without a completed AI analysis are reported as skipped, never as passed.",
    ],
    runs,
    summary,
  };
}
