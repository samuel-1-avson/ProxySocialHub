import test from "node:test";
import assert from "node:assert/strict";
import { createPublicCache } from "../src/lib/public-cache.ts";
import { publicResources, publicResourceTtlMs } from "../src/lib/public-data.ts";

const loaded = (body, ttlMs = 1_000, status = 200) => ({ status, body, ttlMs });
const clock = () => {
  let time = 0;
  return { now: () => time, advance: (ms) => (time += ms) };
};

test("an answer is reused until its lifetime ends", async () => {
  const time = clock();
  const serve = createPublicCache(10, time.now);
  let calls = 0;
  const load = async () => loaded({ n: ++calls });
  assert.equal((await serve("a", load)).source, "miss");
  const second = await serve("a", load);
  assert.deepEqual([second.source, second.body], ["hit", { n: 1 }]);
  time.advance(1_000);
  const third = await serve("a", load);
  assert.deepEqual([third.source, third.body], ["miss", { n: 2 }]);
});

test("concurrent requests for one key share a single upstream call", async () => {
  const serve = createPublicCache();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const load = async () => {
    calls += 1;
    await gate;
    return loaded({ ok: true });
  };
  const pending = [1, 2, 3, 4, 5].map(() => serve("same", load));
  release();
  const results = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.deepEqual(results.map((result) => result.source).sort(), [
    "miss",
    "shared",
    "shared",
    "shared",
    "shared",
  ]);
});

test("different keys are loaded separately", async () => {
  const serve = createPublicCache();
  let calls = 0;
  const load = async () => loaded({ n: ++calls });
  await serve("a", load);
  await serve("b", load);
  assert.equal(calls, 2);
});

test("a lifetime of zero is not stored", async () => {
  const serve = createPublicCache();
  let calls = 0;
  const load = async () => loaded({ n: ++calls }, 0);
  await serve("a", load);
  await serve("a", load);
  assert.equal(calls, 2);
});

test("a failed load is not stored, every waiter sees it, and the next request retries", async () => {
  const serve = createPublicCache();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const load = async () => {
    calls += 1;
    if (calls === 1) {
      await gate;
      throw new Error("boom");
    }
    return loaded({ ok: true });
  };
  const waiting = [serve("a", load), serve("a", load)];
  release();
  const outcomes = await Promise.allSettled(waiting);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ["rejected", "rejected"]);
  assert.equal(calls, 1);
  assert.equal((await serve("a", load)).source, "miss");
  assert.equal(calls, 2);
});

test("only the newest entries are kept", async () => {
  const serve = createPublicCache(2);
  const load = (n) => async () => loaded({ n });
  await serve("a", load(1));
  await serve("b", load(2));
  await serve("c", load(3));
  assert.equal((await serve("c", load(9))).source, "hit");
  assert.equal((await serve("b", load(9))).source, "hit");
  assert.equal((await serve("a", load(9))).source, "miss");
});

test("every public resource has a short, positive lifetime", () => {
  for (const resource of publicResources) {
    const ms = publicResourceTtlMs(resource);
    assert.ok(ms >= 5_000 && ms <= 60_000, `${resource}: ${ms}`);
  }
});
