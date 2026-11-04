import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, CATEGORY_IDS, MAX_BLOCKED_SITES, checkRulesDraft, normalizeSite } from "../src/lib/provider-rules.ts";

function draft(overrides = {}) {
  return { block_sites: [], block_categories: [], unblock_sites: [], unblock_categories: [], assumptions: [], cannot_do: [], ...overrides };
}

const hosts = (changes) => changes.map((c) => c.host);

test("site names follow the node's rules (same cases as blocked_sites.rs)", () => {
  assert.equal(normalizeSite("https://Shop.Example.com/path?q=1"), "shop.example.com");
  assert.equal(normalizeSite("bet365.com:443"), "bet365.com");
  assert.equal(normalizeSite("example.org."), "example.org");
  for (const bad of ["10.0.0.1", "*.example.com", "localhost", "not a host", "", "-x.com", "a..b", "example.123", "[::1]", 42]) {
    assert.equal(normalizeSite(bad), null, String(bad));
  }
});

test("every curated category site is a valid, unique site name", () => {
  for (const id of CATEGORY_IDS) {
    const sites = CATEGORIES[id].sites;
    assert.ok(sites.length >= 10, id);
    assert.equal(new Set(sites).size, sites.length, `${id} has duplicates`);
    for (const s of sites) assert.equal(normalizeSite(s), s, `${id}: ${s}`);
  }
});

test("named sites and categories are added after the current list, each with its source", () => {
  const plan = checkRulesDraft(draft({ block_sites: ["https://Facebook.com/home"], block_categories: ["gambling"] }), ["old.example"]);
  assert.equal(plan.refused, false);
  assert.equal(plan.blocked[0], "old.example");
  assert.deepEqual(plan.added[0], { host: "facebook.com", source: "named" });
  assert.ok(plan.added.some((c) => c.host === "sportybet.com" && c.source === "category:gambling"));
  assert.equal(plan.blocked.length, 1 + 1 + CATEGORIES.gambling.sites.length);
  assert.deepEqual(plan.categories, [{ id: "gambling", label: "Gambling and betting", sites: CATEGORIES.gambling.sites.length, action: "block" }]);
  assert.ok(plan.notes.some((n) => /short list of major sites/.test(n.message)));
});

test("a site already on the list is not added twice", () => {
  const plan = checkRulesDraft(draft({ block_sites: ["bet365.com"], block_categories: ["gambling"] }), ["bet365.com"]);
  assert.equal(plan.blocked.filter((h) => h === "bet365.com").length, 1);
  assert.ok(!hosts(plan.added).includes("bet365.com"));
});

test("unblocking removes named sites and whole categories from the current list", () => {
  const current = ["facebook.com", "instagram.com", "keep.example", "bet365.com"];
  const plan = checkRulesDraft(draft({ unblock_sites: ["bet365.com", "never-there.example"], unblock_categories: ["social_media"] }), current);
  assert.deepEqual(plan.blocked, ["keep.example"]);
  assert.deepEqual(plan.removed, [
    { host: "facebook.com", source: "category:social_media" },
    { host: "instagram.com", source: "category:social_media" },
    { host: "bet365.com", source: "named" },
  ]);
  assert.ok(plan.notes.some((n) => /never-there.example was not on the list/.test(n.message)));
});

test("a site both blocked and unblocked ends unblocked; a category both ways is blocked", () => {
  const plan = checkRulesDraft(draft({ block_sites: ["x.com"], unblock_sites: ["x.com"], block_categories: ["dating"], unblock_categories: ["dating"] }), ["x.com"]);
  assert.ok(!plan.blocked.includes("x.com"));
  assert.ok(plan.blocked.includes("tinder.com"));
  assert.deepEqual(plan.categories.map((c) => c.action), ["block"]);
});

test("junk sites are reported, unknown categories ignored", () => {
  const plan = checkRulesDraft(draft({ block_sites: ["10.0.0.1", "*.bad.com", "ok.example"], block_categories: ["weapons", "adult"] }), []);
  assert.deepEqual(plan.rejected, ["10.0.0.1", "*.bad.com"]);
  assert.ok(plan.notes.some((n) => n.level === "warning" && /10.0.0.1/.test(n.message)));
  assert.deepEqual(plan.categories.map((c) => c.id), ["adult"]);
  assert.ok(plan.blocked.includes("ok.example"));
});

test("old text rules on the list are kept and explained", () => {
  const plan = checkRulesDraft(draft({ block_sites: ["new.example"] }), ["facebook", "facebook"]);
  assert.deepEqual(plan.blocked, ["facebook", "new.example"]);
  assert.ok(plan.notes.some((n) => /old text rules/.test(n.message)));
});

test("the list is capped at the node's maximum", () => {
  const current = Array.from({ length: MAX_BLOCKED_SITES - 5 }, (_, i) => `site${i}.example.com`);
  const plan = checkRulesDraft(draft({ block_categories: ["gambling"] }), current);
  assert.equal(plan.blocked.length, MAX_BLOCKED_SITES);
  assert.equal(plan.added.length, 5);
  assert.ok(plan.notes.some((n) => n.level === "warning" && /at most 1000/.test(n.message)));
});

test("an unreadable draft changes nothing", () => {
  for (const raw of [null, "block facebook", [1], 3]) {
    const plan = checkRulesDraft(raw, ["keep.example"]);
    assert.equal(plan.refused, true);
    assert.equal(plan.unchanged, true);
    assert.deepEqual(plan.blocked, ["keep.example"]);
    assert.deepEqual(plan.added, []);
  }
});

test("no change is reported as such", () => {
  const plan = checkRulesDraft(draft({ block_sites: ["a.example"] }), ["a.example"]);
  assert.equal(plan.unchanged, true);
  assert.ok(plan.notes.some((n) => n.message === "Nothing would change."));
});

test("guesses and limits are trimmed and capped", () => {
  const plan = checkRulesDraft(draft({ assumptions: ["  Facebook means facebook.com  ", "", 5, "x".repeat(400), ...Array(20).fill("more")], cannot_do: "nope" }), []);
  assert.equal(plan.assumptions[0], "Facebook means facebook.com");
  assert.equal(plan.assumptions[1].length, 200);
  assert.equal(plan.assumptions.length, 8);
  assert.deepEqual(plan.cannotDo, []);
});
