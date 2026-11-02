import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import worker, { visitorRegion } from "../demo-site/worker.ts";
import { startDemoTarget, type DemoTarget } from "../src/fixtures/demoTarget.ts";

const call = (path: string, country: string | null, scenario: string | undefined, init: RequestInit = {}) =>
  worker.fetch(new Request(`https://demo.example.workers.dev${path}`, { ...init, headers: country ? { "cf-ipcountry": country } : {} }), { SCENARIO: scenario });

describe("deployable demo site (edge worker)", () => {
  it("takes the country from Cloudflare and never invents one", () => {
    const req = (c: string | null) => new Request("https://x.test/", { headers: c ? { "cf-ipcountry": c } : {} });
    assert.equal(visitorRegion(req("gh")), "GH");
    assert.equal(visitorRegion(req("US")), "US");
    for (const bad of [null, "XX", "T1", "", "USA", "1", "<script>"]) assert.equal(visitorRegion(req(bad)), "XX", String(bad));
    const withCf = new Request("https://x.test/") as Request & { cf?: { country: string } };
    withCf.cf = { country: "DE" };
    assert.equal(visitorRegion(withCf), "DE", "request.cf.country wins when present");
  });

  it("demo-v1 seeds exactly the documented defects, per country", async () => {
    const ghPage = await (await call("/", "GH", "demo-v1")).text();
    assert.match(ghPage, /class="consent"/, "GH: signup is covered by the cookie banner");
    assert.match(ghPage, /id="signup"/, "the button exists; it is covered, not missing");
    const usPage = await (await call("/", "US", "demo-v1")).text();
    assert.doesNotMatch(usPage, /class="consent"/);
    assert.match(await (await call("/assets/pricing.js", "GH", "demo-v1")).text(), /GH₵ 149\.00 \(GHS\)/, "GH sees its own price");
    assert.match(await (await call("/assets/pricing.js", "US", "demo-v1")).text(), /GH₵ 149\.00 \(GHS\)/, "the defect: US sees the Ghana price");
    assert.match(await (await call("/assets/pricing.js", "XX", "demo-v1")).text(), /\$ 9\.99 \(USD\)/, "unknown visitors get the default, healthy price");
  });

  it("demo-v2 is the fixed site everywhere", async () => {
    for (const c of ["GH", "US", "DE", "XX"]) assert.doesNotMatch(await (await call("/", c, "demo-v2")).text(), /class="consent"/, c);
    assert.match(await (await call("/assets/pricing.js", "US", "demo-v2")).text(), /\$ 9\.99 \(USD\)/);
  });

  it("fails loudly on a missing, mistyped or non-public scenario instead of serving something", async () => {
    for (const s of [undefined, "", "demo-v3", "server-error-gh", "prompt-injection"]) {
      const res = await call("/", "GH", s);
      assert.equal(res.status, 500, String(s));
      assert.match(await res.text(), /SCENARIO must be one of: demo-v1, demo-v2/);
    }
  });

  it("is read-only, never cached across regions, not indexable, and says it is synthetic", async () => {
    const post = await call("/", "GH", "demo-v1", { method: "POST", body: "x" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    const head = await call("/", "GH", "demo-v1", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const path of ["/", "/assets/pricing.js", "/pricing", "/robots.txt", "/nope"]) {
      const res = await call(path, "GH", "demo-v1");
      assert.equal(res.headers.get("cache-control"), "no-store", path);
      assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/, path);
    }
    assert.equal((await call("/nope", "GH", "demo-v1")).status, 404);
    assert.match(await (await call("/", "GH", "demo-v1")).text(), /Synthetic content/);
    assert.match(await (await call("/robots.txt", null, "demo-v1")).text(), /Disallow: \//);
  });
});

describe("the deployed page is identical to what the local fixture serves", () => {
  let local: DemoTarget;
  before(async () => {
    local = await startDemoTarget();
  });
  after(async () => local.close());

  for (const scenario of ["demo-v1", "demo-v2"]) {
    for (const region of ["GH", "US", "DE"]) {
      it(`${scenario} / ${region}: page and pricing script match byte for byte`, async () => {
        local.setScenario(scenario);
        for (const path of ["/", "/assets/pricing.js"]) {
          const fromLocal = await (await fetch(`${local.origin}${path}`, { headers: { "x-fixture-region": region } })).text();
          const fromEdge = await (await call(path, region, scenario)).text();
          assert.equal(fromEdge, fromLocal, `${path} differs`);
        }
      });
    }
  }
});
