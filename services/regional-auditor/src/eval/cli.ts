// node src/eval/cli.ts [--repeat N] [--cases a,b] [--out file.json]

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { runEval } from "./runner.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(0)}%`);

async function main() {
  // The harness is development-only and is started in-process by the evaluator.
  const config = loadConfig({ ...process.env, AUDITOR_FIXTURE_ENABLED: "1", NODE_ENV: process.env.NODE_ENV === "production" ? "development" : (process.env.NODE_ENV ?? "development") });
  const repeat = Number(arg("repeat") ?? "1");
  const cases = arg("cases")?.split(",").filter(Boolean);
  const out = arg("out") ?? path.join(config.dataDir, "eval", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

  console.log(`Evaluating with model ${config.model.id} (${config.model.dataMode} mode), ${config.model.apiKey ? "key configured" : "NO KEY: cases will be skipped, not passed"}\n`);
  const report = await runEval({ config, repeat, cases, log: (l) => console.log(l) });

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));

  const s = report.summary;
  console.log("\n=== Summary (synthetic fixture suite; not a general accuracy claim) ===");
  console.log(`runs: ${s.casesRun}  scored: ${s.casesScored}  skipped: ${s.casesSkipped}`);
  console.log(`capture level: objective signal present in the evidence for ${s.captureLevel.evidenceSufficient}/${s.captureLevel.seededDefects} seeded defects`);
  if (s.casesScored > 0) {
    const scoredDefects = s.defects.asserted + s.defects.flaggedOnly + s.defects.missed;
    console.log(`seeded defects (scored runs): ${scoredDefects}  detected as observed defects: ${s.defects.asserted}  hypothesis only: ${s.defects.flaggedOnly}  missed: ${s.defects.missed}  (right region, wrong kind: ${s.defects.regionOnly})`);
    console.log(`healthy/inconclusive/adversarial controls: ${s.healthyControls.scored}  with false alarms: ${s.healthyControls.withFalseAlarm} (${s.healthyControls.falseAlarmFindings} findings)  hypotheses raised: ${s.healthyControls.hypotheses}`);
    console.log(`extra observed defects on defect cases: ${s.unexpectedObservedOnDefectCases}   precision ${pct(s.precision)}  recall ${pct(s.recall)}`);
    console.log(`evidence: findings kept ${s.evidence.findingsKept}, removed as unsupported ${s.evidence.findingsDropped}, adjusted ${s.evidence.findingsAdjusted}, invented evidence refs removed ${s.evidence.inventedRefsRemoved}, supported rate ${pct(s.evidence.supportedFindingRate)}`);
    console.log(`latency: job p50 ${s.latencyMs.jobP50 ?? "n/a"} ms, p95 ${s.latencyMs.jobP95 ?? "n/a"} ms; model calls p50 ${s.latencyMs.modelP50 ?? "n/a"} ms`);
    console.log(`usage (provider reported): ${s.tokens.input.toLocaleString()} input / ${s.tokens.output.toLocaleString()} output tokens; estimated cost ${s.estimatedCostUsd === null ? "n/a" : `$${s.estimatedCostUsd.toFixed(4)}`}`);
  }
  console.log(`\nraw results: ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
