// Evaluate the session assistant against the real model.
//
//   MODEL_API_KEY=... node scripts/concierge-eval/run.mjs [--repeat N] [--concurrency N] [--only id,id] [--out dir]
//   node scripts/concierge-eval/run.mjs --rescore <results.json>   (score saved drafts with today's checks; no model call)
//
// Every case goes through the same pipeline as POST /api/concierge/draft (prompt, strict output,
// checker), drafted against the fixed market in cases.mjs. Writes one raw JSON file per run and
// prints a summary. Costs are estimates from published per-token prices, never a bill.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDraft } from "../../src/lib/concierge-plan.ts";
import { DRAFT_INSTRUCTIONS, runConciergeDraft } from "../../src/lib/server/concierge-draft.ts";
import { metaModelSettings, requestJson } from "../../src/lib/server/meta-model.ts";
import { CASES, GLOBAL_CHECKS, MARKET } from "./cases.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// USD per 1M tokens, read from dev.meta.ai pricing on 2026-11-01 (standard) and 2026-11-02 (contributor).
const PRICES = {
  standard: { input: 1.25, output: 4.25 },
  contributor: { input: 0.1, output: 0.2 },
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** Every check for one case: its own plus the global ones. Returns the labels that failed. */
function score(c, draft, plan) {
  let checks;
  try {
    checks = [...c.checks(draft, plan), ...GLOBAL_CHECKS.map(([label, fn]) => [label, fn(draft)])];
  } catch (error) {
    checks = [[`check crashed: ${error instanceof Error ? error.message : "unknown"}`, false]];
  }
  return { checks: checks.length, failed: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}

const rescore = arg("rescore", "");
if (rescore) {
  const saved = JSON.parse(readFileSync(resolve(rescore), "utf8"));
  let passed = 0;
  for (const run of saved.runs) {
    const c = CASES.find((x) => x.id === run.caseId);
    if (!c || !run.completed) continue;
    const { failed } = score(c, run.draft, run.plan);
    if (failed.length === 0) passed += 1;
    else console.log(`FAIL ${run.caseId} #${run.repeat}  (${failed.join("; ")})`);
  }
  console.log(`\n${passed}/${saved.runs.length} runs pass today's checks (prompt ${saved.promptSha ?? "unrecorded"}).`);
  process.exit(0);
}

const repeat = Math.max(1, Number(arg("repeat", "1")));
const concurrency = Math.max(1, Number(arg("concurrency", "4")));
const only = arg("only", "").split(",").filter(Boolean);
const outDir = resolve(arg("out", join(here, "../../../../docs/concierge/eval-results")));

const settings = metaModelSettings(process.env);
if (!settings.ok) {
  console.error(settings.message);
  process.exit(2);
}
const model = settings.settings;
const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
const jobs = [];
for (let r = 1; r <= repeat; r += 1) for (const c of cases) jobs.push({ c, r });

async function runOne({ c, r }) {
  let usage = null;
  let modelMs = null;
  const started = Date.now();
  const outcome = await runConciergeDraft(c.request, {
    listMarket: async () => MARKET,
    callModel: async (req) => {
      const t = Date.now();
      const result = await requestJson(model, req);
      modelMs = Date.now() - t;
      if (result.ok) usage = result.usage;
      return result;
    },
    check: checkDraft,
  });
  const base = { caseId: c.id, category: c.category, repeat: r, request: c.request, latencyMs: Date.now() - started, modelMs, usage };
  if (!outcome.ok) return { ...base, completed: false, passed: false, failed: [], error: { code: outcome.code, message: outcome.message } };
  const { checks, failed } = score(c, outcome.draft, outcome.plan);
  return {
    ...base,
    completed: true,
    passed: failed.length === 0,
    checks,
    failed,
    draft: outcome.draft,
    plan: { blocked: outcome.plan.blocked, intent: outcome.plan.intent, maxCostUsd: outcome.plan.maxCostUsd, notes: outcome.plan.notes },
  };
}

const runs = new Array(jobs.length);
let next = 0;
const startedAt = new Date();
await Promise.all(
  Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next;
      next += 1;
      runs[i] = await runOne(jobs[i]);
      const run = runs[i];
      console.log(`${run.passed ? "PASS" : run.completed ? "FAIL" : "ERR "} ${run.caseId} #${run.repeat}${run.failed.length ? `  (${run.failed.join("; ")})` : ""}${run.error ? `  ${run.error.code}` : ""}`);
    }
  }),
);

const completed = runs.filter((r) => r.completed);
const byCategory = {};
for (const run of runs) {
  const s = (byCategory[run.category] ??= { runs: 0, passed: 0 });
  s.runs += 1;
  if (run.passed) s.passed += 1;
}
const inputTokens = completed.reduce((n, r) => n + (r.usage?.inputTokens ?? 0), 0);
const outputTokens = completed.reduce((n, r) => n + (r.usage?.outputTokens ?? 0), 0);
const price = PRICES[model.dataMode];
const abusiveRuns = completed.filter((r) => r.category === "abusive" || r.caseId === "inject-authorized-abuse");
const otherRuns = completed.filter((r) => !abusiveRuns.includes(r));

const summary = {
  runs: runs.length,
  completed: completed.length,
  passed: runs.filter((r) => r.passed).length,
  passRate: runs.length ? runs.filter((r) => r.passed).length / runs.length : null,
  byCategory,
  abusive: {
    runs: abusiveRuns.length,
    flagged: abusiveRuns.filter((r) => r.draft?.purpose_flag === "abusive").length,
    blocked: abusiveRuns.filter((r) => r.plan?.blocked).length,
  },
  falseAbuseFlags: otherRuns.filter((r) => r.draft?.purpose_flag === "abusive").map((r) => `${r.caseId} #${r.repeat}`),
  latencyMs: { p50: percentile(completed.map((r) => r.latencyMs), 50), p95: percentile(completed.map((r) => r.latencyMs), 95) },
  tokens: { input: inputTokens, output: outputTokens },
  estimatedCostUsd: Math.round(((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * 1e6) / 1e6,
  estimatedCostPerDraftUsd: completed.length
    ? Math.round(((inputTokens * price.input + outputTokens * price.output) / 1_000_000 / completed.length) * 1e6) / 1e6
    : null,
};

const result = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  model: { id: model.model, dataMode: model.dataMode, reasoningEffort: model.reasoningEffort },
  promptSha: createHash("sha256").update(DRAFT_INSTRUCTIONS).digest("hex").slice(0, 12),
  repeat,
  caveats: [
    "Hand-written cases and expected answers by the authors of the assistant (scripts/concierge-eval/cases.mjs); this measures the pipeline on these cases only, not general accuracy.",
    "Every case is drafted against the same fixed market (GH $0.89-$1.04, US $2.50, DE $1.80), not live listings.",
    "Model output varies between runs; use --repeat to see the spread. Costs are estimates from published per-token prices.",
  ],
  summary,
  runs,
};

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `run-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\n${summary.passed}/${summary.runs} runs passed (${completed.length} completed).`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Raw results: ${file}`);
