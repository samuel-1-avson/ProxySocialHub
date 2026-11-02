import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { SCHEMA_VERSION, type AuditJob } from "../src/contracts.ts";
import { compareAudits } from "../src/compare.ts";
import { FileArtifactStore, FileJobStore } from "../src/store/fileStore.ts";
import { PgJobStore } from "../src/store/pgStore.ts";
import { StaleRevisionError, type JobStore } from "../src/store/types.ts";
import { newAuditId } from "../src/util.ts";
import { capture, finding, plan } from "./helpers.ts";

function job(ownerId: string, over: Partial<AuditJob> = {}): AuditJob {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newAuditId(),
    ownerId,
    request: {
      targetUrl: "http://127.0.0.1:1/",
      regions: ["GH", "US"],
      expectations: "Check that signup works",
      mode: "fixture",
      browserProfile: { id: "p", viewport: { width: 1280, height: 800 }, locale: "en-US", timezoneId: "UTC", deviceScaleFactor: 1 },
    },
    mode: "fixture",
    evidenceOrigin: "synthetic_fixture",
    previousAuditId: null,
    replayOfAuditId: null,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    stages: [],
    plan: null,
    regions: [],
    captures: [],
    analysis: {
      status: "not_run", failure: null, model: null, startedAt: null, completedAt: null, evidenceOrigins: [], expectationResults: [], findings: [], limitations: [],
      validation: { droppedFindings: [], adjustedFindings: [] }, usage: { calls: [], totalInputTokens: 0, totalOutputTokens: 0, costEstimate: null }, attempts: 0,
    },
    comparison: null,
    planUsage: [],
    sessionPlan: null,
    failure: null,
    limitations: [],
    revision: 0,
    ...over,
  };
}

/** The same behavioural contract runs against every JobStore implementation. */
function contract(name: string, make: () => Promise<{ store: JobStore; cleanup: () => Promise<void> }>, skip?: string) {
  describe(`${name} contract`, { skip }, () => {
    let store: JobStore;
    let cleanup: () => Promise<void>;
    before(async () => ({ store, cleanup } = await make()));
    after(async () => cleanup());

    it("persists and reloads a job unchanged (survives a 'page refresh')", async () => {
      const j = job("owner-aaaaaaaa");
      await store.create(j);
      const loaded = await store.getOwned(j.id, "owner-aaaaaaaa");
      assert.equal(loaded?.id, j.id);
      assert.equal(loaded?.request.expectations, "Check that signup works");
    });

    it("never returns another owner's job", async () => {
      const j = job("owner-bbbbbbbb");
      await store.create(j);
      assert.equal(await store.getOwned(j.id, "owner-cccccccc"), null);
      assert.ok(await store.getOwned(j.id, "owner-bbbbbbbb"));
      assert.equal((await store.list("owner-cccccccc", 50)).some((x) => x.id === j.id), false);
    });

    it("lists newest first within an owner and honours the limit", async () => {
      const owner = "owner-dddddddd";
      const a = job(owner, { createdAt: "2026-11-01T10:00:00.000Z" });
      const b = job(owner, { createdAt: "2026-11-01T11:00:00.000Z" });
      await store.create(a);
      await store.create(b);
      const list = await store.list(owner, 1);
      assert.deepEqual(list.map((x) => x.id), [b.id]);
    });

    it("saves updates, bumps the revision, and rejects a stale writer", async () => {
      const j = job("owner-eeeeeeee");
      await store.create(j);
      const first = (await store.get(j.id))!;
      const second = (await store.get(j.id))!;
      first.status = "running";
      await store.save(first);
      assert.equal(first.revision, 1);
      second.revision = -1; // a writer that read before the update
      await assert.rejects(store.save(second), StaleRevisionError);
      assert.equal((await store.get(j.id))?.status, "running");
    });

    it("finds unfinished jobs for recovery and counts an owner's active jobs", async () => {
      const owner = "owner-ffffffff";
      const running = job(owner, { status: "running" });
      const done = job(owner, { status: "completed" });
      await store.create(running);
      await store.create(done);
      assert.ok((await store.listByStatus(["running"])).some((x) => x.id === running.id));
      assert.equal(await store.countActive(owner), 1);
    });

    it("deletes only FINISHED audits older than the cutoff and reports their ids", async () => {
      const owner = "owner-gggggggg";
      const old = "2020-01-01T00:00:00.000Z";
      const oldDone = job(owner, { status: "completed", createdAt: old });
      const oldFailed = job(owner, { status: "failed", createdAt: old });
      const oldRunning = job(owner, { status: "running", createdAt: old });
      const oldQueued = job(owner, { status: "queued", createdAt: old });
      const recentDone = job(owner, { status: "completed", createdAt: new Date().toISOString() });
      for (const j of [oldDone, oldFailed, oldRunning, oldQueued, recentDone]) await store.create(j);
      const deleted = await store.deleteFinishedBefore("2021-01-01T00:00:00.000Z");
      assert.deepEqual(deleted.filter((id) => [oldDone, oldFailed, oldRunning, oldQueued, recentDone].some((j) => j.id === id)).sort(), [oldDone.id, oldFailed.id].sort());
      assert.equal(await store.get(oldDone.id), null);
      assert.equal(await store.get(oldFailed.id), null);
      for (const kept of [oldRunning, oldQueued, recentDone]) assert.ok(await store.get(kept.id), "unfinished or recent audits are never deleted");
    });

    it("returns null for malformed ids", async () => {
      assert.equal(await store.get("../../etc/passwd"), null);
      assert.equal(await store.getOwned("nope", "owner-aaaaaaaa"), null);
    });
  });
}

contract("FileJobStore", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "auditor-store-"));
  return { store: new FileJobStore(dir), cleanup: () => rm(dir, { recursive: true, force: true }) };
});

// Runs only with a disposable database: AUDITOR_TEST_DATABASE_URL (table from migrations/000176).
// Skipped runs are reported as skipped, never as passed.
const pgUrl = process.env.AUDITOR_TEST_DATABASE_URL;
contract(
  "PgJobStore",
  async () => {
    const store = new PgJobStore(pgUrl!);
    return { store, cleanup: () => store.close() };
  },
  pgUrl ? undefined : "AUDITOR_TEST_DATABASE_URL is not set; PostgreSQL store not exercised",
);

describe("FileArtifactStore", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "auditor-art-"));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("round-trips bytes and copies between audits", async () => {
    const s = new FileArtifactStore(dir);
    const a = "aud_000000000001";
    const b = "aud_000000000002";
    await s.put(a, "ev-00000001-GH-initial.png", Buffer.from("png-bytes"));
    assert.equal((await s.get(a, "ev-00000001-GH-initial.png"))?.toString(), "png-bytes");
    assert.equal(await s.copy(a, b, "ev-00000001-GH-initial.png"), true);
    assert.equal((await s.get(b, "ev-00000001-GH-initial.png"))?.toString(), "png-bytes");
    assert.equal(await s.get(a, "missing.png"), null);
  });

  it("deletes every artifact of an audit and nothing else", async () => {
    const s = new FileArtifactStore(dir);
    const a = "aud_0000000000a1";
    const b = "aud_0000000000b2";
    await s.put(a, "one.png", Buffer.from("1"));
    await s.put(a, "two.png", Buffer.from("2"));
    await s.put(b, "keep.png", Buffer.from("k"));
    await s.deleteAudit(a);
    assert.equal(await s.get(a, "one.png"), null);
    assert.equal(await s.get(a, "two.png"), null);
    assert.equal((await s.get(b, "keep.png"))?.toString(), "k");
    await s.deleteAudit(a); // already gone: not an error
    await assert.rejects(s.deleteAudit("../escape"));
  });

  it("refuses path traversal and malformed references", async () => {
    const s = new FileArtifactStore(dir);
    await assert.rejects(s.get("aud_000000000001", "../../jobs/x.json"));
    await assert.rejects(s.put("aud_000000000001", "..\\evil.png", Buffer.from("x")));
    await assert.rejects(s.get("../aud_000000000001", "a.png"));
  });
});

describe("compareAudits (rerun)", () => {
  const withFindings = (id: string, findings: ReturnType<typeof finding>[], over: Partial<AuditJob> = {}) => {
    const evGH = capture("GH");
    const evUS = capture("US");
    return job("owner-aaaaaaaa", {
      id,
      plan: plan(),
      captures: [evGH, evUS],
      analysis: {
        ...job("x").analysis,
        status: "completed",
        findings: findings.map((f, i) => ({ ...f, id: `f${i + 1}` })),
      },
      ...over,
    });
  };

  it("classifies resolved, persisting and new findings per region", () => {
    const prev = withFindings("aud_000000000001", [
      finding({ kind: "element_obscured", regions: ["GH"] }),
      finding({ kind: "currency_mismatch", expectationId: "e2", regions: ["US"], evidenceIds: [capture("US").evidenceId] }),
    ]);
    const cur = withFindings("aud_000000000002", [
      finding({ kind: "currency_mismatch", expectationId: "e2", regions: ["US"], summary: "different wording now", evidenceIds: [capture("US").evidenceId] }),
      finding({ kind: "asset_failed", expectationId: "e1", regions: ["GH"] }),
    ]);
    const c = compareAudits(cur, prev);
    const by = (s: string) => c.items.filter((i) => i.status === s).map((i) => i.key);
    assert.deepEqual(by("persisting"), ["e2|currency_mismatch|US"]);
    assert.deepEqual(by("resolved"), ["e1|element_obscured|GH"]);
    assert.deepEqual(by("new"), ["e1|asset_failed|GH"]);
  });

  it("never counts an unverified region as fixed", () => {
    const prev = withFindings("aud_000000000001", [finding({ regions: ["GH"] })]);
    const cur = withFindings("aud_000000000002", [], {
      captures: [capture("GH", { route: { ...capture("GH").route, assurance: "mismatch" } }), capture("US")],
    });
    const c = compareAudits(cur, prev);
    assert.ok(c.items.some((i) => i.status === "incomparable" && i.regions[0] === "GH"));
    assert.equal(c.items.some((i) => i.status === "resolved"), false);
  });

  it("marks everything incomparable when a run has no completed analysis", () => {
    const prev = withFindings("aud_000000000001", [finding()]);
    const cur = withFindings("aud_000000000002", [], { analysis: { ...job("x").analysis, status: "failed" } });
    const c = compareAudits(cur, prev);
    assert.ok(c.items.length > 0 && c.items.every((i) => i.status === "incomparable"));
    assert.ok(c.caveats.some((x) => /no completed AI analysis/.test(x)));
  });

  it("notes when evidence origins differ", () => {
    const prev = withFindings("aud_000000000001", [], { evidenceOrigin: "live_capture" });
    const cur = withFindings("aud_000000000002", []);
    assert.ok(compareAudits(cur, prev).caveats.some((x) => /origin differs/.test(x)));
  });
});
