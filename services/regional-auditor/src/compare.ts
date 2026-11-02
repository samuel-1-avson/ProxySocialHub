// Rerun comparison. Findings are matched by (expectation, kind, region), not by
// text or screenshot position, so wording changes between model runs do not
// create false "new" findings. A region that could not be interpreted in
// either run is reported as incomparable instead of being counted as resolved.

import type { AuditJob, Comparison, ComparisonItem, Finding, RegionCapture } from "./contracts.ts";
import { isInterpretable } from "./geo.ts";
import { nowIso, truncate } from "./util.ts";

function interpretableRegions(job: AuditJob): Map<string, RegionCapture> {
  const map = new Map<string, RegionCapture>();
  for (const c of job.captures) {
    if (isInterpretable(c.route.assurance) && c.page.loadState !== "not_attempted") map.set(c.requestedCountry, c);
  }
  return map;
}

function keyFor(f: Finding, region: string): string {
  return `${f.expectationId ?? "-"}|${f.kind}|${region}`;
}

function index(job: AuditJob): Map<string, Finding> {
  const map = new Map<string, Finding>();
  for (const f of job.analysis.findings) {
    for (const region of f.regions) {
      const key = keyFor(f, region);
      if (!map.has(key)) map.set(key, f);
    }
  }
  return map;
}

export function compareAudits(current: AuditJob, previous: AuditJob): Comparison {
  const caveats: string[] = [];
  if (current.evidenceOrigin !== previous.evidenceOrigin) {
    caveats.push(`Evidence origin differs (${previous.evidenceOrigin} before, ${current.evidenceOrigin} now); treat differences with care.`);
  }
  if (current.request.browserProfile.id !== previous.request.browserProfile.id) {
    caveats.push("The browser profile changed between runs, so differences may not be caused by the site.");
  }
  if (current.request.targetUrl !== previous.request.targetUrl) caveats.push("The target URL differs between the two runs.");
  if (current.analysis.status !== "completed" || previous.analysis.status !== "completed") {
    caveats.push("At least one run has no completed AI analysis, so findings could not be compared in full.");
  }
  const sharedChecks = new Set(previous.plan?.checks.map((c) => c.id) ?? []);
  if (current.plan && previous.plan && !current.plan.checks.every((c) => sharedChecks.has(c.id))) {
    caveats.push("The set of checks differs between runs.");
  }
  caveats.push("Screenshots are compared by findings, not pixel alignment; layout shifts can change what a screenshot shows.");

  const curOk = interpretableRegions(current);
  const prevOk = interpretableRegions(previous);
  const curFindings = index(current);
  const prevFindings = index(previous);
  const regions = [...new Set([...current.request.regions, ...previous.request.regions])];
  const items: ComparisonItem[] = [];
  const analysisComparable = current.analysis.status === "completed" && previous.analysis.status === "completed";

  for (const region of regions) {
    const inCur = curOk.has(region);
    const inPrev = prevOk.has(region);
    if (!inCur || !inPrev || !analysisComparable) {
      const why = !inCur && !inPrev
        ? "was not verified in either run"
        : !inCur
          ? "was not verified in the current run"
          : !inPrev
            ? "was not verified in the previous run"
            : "has no completed AI analysis in one of the runs";
      items.push({
        status: "incomparable",
        key: `region|${region}`,
        summary: `${region} ${why}.`,
        currentFindingId: null,
        previousFindingId: null,
        regions: [region],
        note: "A region without verified evidence is never counted as fixed.",
      });
      continue;
    }
    const keys = new Set([...curFindings.keys(), ...prevFindings.keys()].filter((k) => k.endsWith(`|${region}`)));
    for (const key of keys) {
      const cur = curFindings.get(key);
      const prev = prevFindings.get(key);
      const status: ComparisonItem["status"] = cur && prev ? "persisting" : cur ? "new" : "resolved";
      const f = (cur ?? prev)!;
      items.push({
        status,
        key,
        summary: truncate(f.summary, 300),
        currentFindingId: cur?.id ?? null,
        previousFindingId: prev?.id ?? null,
        regions: [region],
        note:
          status === "resolved"
            ? "Not reported in the current run; the region was verified and analyzed in both runs."
            : status === "persisting" && cur && prev && cur.classification !== prev.classification
              ? `Classification changed from ${prev.classification} to ${cur.classification}.`
              : null,
      });
    }
  }
  const order = { persisting: 0, new: 1, resolved: 2, incomparable: 3 } as const;
  items.sort((a, b) => order[a.status] - order[b.status]);
  return { previousAuditId: previous.id, comparedAt: nowIso(), items: items.slice(0, 40), caveats };
}
