import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { MetaClient, summarizeUsage, toStrictSchema } from "../src/ai/meta.ts";
import { loadConfig } from "../src/config.ts";
import { jsonResponse, responsesBody, testConfig } from "./helpers.ts";

const schema = toStrictSchema(z.toJSONSchema(z.object({ ok: z.boolean(), note: z.string().nullable() })) as Record<string, unknown>);
const req = (signal?: AbortSignal) => ({
  stage: "analyze" as const,
  instructions: "i",
  content: [{ type: "input_text" as const, text: "t" }],
  schemaName: "x",
  jsonSchema: schema,
  signal,
});

function client(responses: Array<Response | Error>, over: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift() ?? jsonResponse(500, { error: { message: "exhausted" } });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const cfg = testConfig({ AUDITOR_MODEL_TIMEOUT_MS: "5000", ...over });
  return { client: new MetaClient(cfg.model, fetchImpl), calls, cfg };
}

describe("MetaClient", () => {
  it("sends the documented Responses request and returns parsed JSON with usage", async () => {
    const { client: c, calls } = client([jsonResponse(200, responsesBody({ ok: true, note: null }))]);
    const r = await c.respond(req());
    assert.ok(r.ok);
    assert.deepEqual(r.json, { ok: true, note: null });
    assert.equal(r.calls[0]!.inputTokens, 1000);
    assert.equal(r.calls[0]!.cachedTokens, 200);
    assert.equal(r.calls[0]!.reasoningTokens, 150);
    assert.equal(r.calls[0]!.responseId, "resp_test_1");

    assert.equal(calls[0]!.url, "https://api.meta.ai/v1/responses");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.equal(body.model, "muse-spark-1.3");
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.required, ["ok", "note"]);
    assert.equal(body.input[0].type, "message");
  });

  it("reports a missing key as its own state without calling the network", async () => {
    const cfg = loadConfig({ NODE_ENV: "test" });
    let called = false;
    const c = new MetaClient(cfg.model, (async () => {
      called = true;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch);
    const r = await c.respond(req());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "missing_key");
    assert.equal(called, false);
    assert.equal(c.configured, false);
  });

  it("retries 429 honoring Retry-After, then succeeds", async () => {
    const { client: c, calls } = client([
      jsonResponse(429, { error: { message: "slow down", type: "rate_limit_error" } }, { "retry-after": "0" }),
      jsonResponse(200, responsesBody({ ok: true, note: null })),
    ]);
    const r = await c.respond(req());
    assert.ok(r.ok);
    assert.equal(calls.length, 2);
    assert.deepEqual(r.calls.map((x) => x.outcome), ["retryable_error", "ok"]);
  });

  it("gives up after the configured number of retries and says it was rate limited", async () => {
    const { client: c, calls } = client(
      [jsonResponse(429, {}, { "retry-after": "0" }), jsonResponse(429, {}, { "retry-after": "0" }), jsonResponse(429, {}, { "retry-after": "0" })],
      { AUDITOR_MODEL_MAX_RETRIES: "2" },
    );
    const r = await c.respond(req());
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "rate_limited");
    assert.equal(!r.ok && r.retryable, true);
    assert.equal(calls.length, 3);
  });

  it("does not retry 401/402/403/404/413/400 and never echoes the API key", async () => {
    for (const status of [400, 401, 402, 403, 404, 413]) {
      const { client: c, calls, cfg } = client([jsonResponse(status, { error: { message: `bad key ${"test-key-do-not-use-0000"}`, type: "authentication_error" } })]);
      const r = await c.respond(req());
      assert.equal(r.ok, false, String(status));
      assert.equal(calls.length, 1, `no retry for ${status}`);
      if (!r.ok) {
        assert.equal(r.retryable, false);
        assert.doesNotMatch(JSON.stringify(r), new RegExp(cfg.model.apiKey!));
      }
    }
  });

  it("does not retry a 504 unchanged", async () => {
    const { client: c, calls } = client([jsonResponse(504, { error: { message: "gateway timeout" } })]);
    const r = await c.respond(req());
    assert.equal(!r.ok && r.code, "timeout");
    assert.equal(calls.length, 1);
  });

  it("surfaces an exhausted output budget as 'truncated' (reasoning counts against it)", async () => {
    const { client: c } = client([jsonResponse(200, responsesBody("", { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }] }))]);
    const r = await c.respond(req());
    assert.equal(!r.ok && r.code, "truncated");
    assert.equal(!r.ok && r.retryable, true);
    assert.equal(!r.ok && r.calls[0]!.outputTokens, 400, "usage is still recorded");
  });

  it("surfaces refusals and content-filter stops as 'refused'", async () => {
    const refusal = responsesBody("", { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
    const a = await client([jsonResponse(200, refusal)]).client.respond(req());
    assert.equal(!a.ok && a.code, "refused");
    const filtered = responsesBody("", { status: "incomplete", incomplete_details: { reason: "content_filter" } });
    const b = await client([jsonResponse(200, filtered)]).client.respond(req());
    assert.equal(!b.ok && b.code, "refused");
  });

  it("rejects non-JSON model text as malformed output", async () => {
    const { client: c } = client([jsonResponse(200, responsesBody("here is your report: {oops"))]);
    const r = await c.respond(req());
    assert.equal(!r.ok && r.code, "malformed_output");
  });

  it("treats a client-side timeout as a timeout and does not retry it unchanged", async () => {
    const { client: c, calls } = client([Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })]);
    const r = await c.respond(req());
    assert.equal(!r.ok && r.code, "timeout");
    assert.equal(calls.length, 1);
  });

  it("stops immediately when the audit is cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const { client: c } = client([Object.assign(new Error("aborted"), { name: "AbortError" })]);
    const r = await c.respond(req(controller.signal));
    assert.equal(!r.ok && r.code, "timeout");
    assert.equal(!r.ok && r.retryable, false);
  });

  it("refuses contributor-mode models unless explicitly allowed", () => {
    assert.throws(() => loadConfig({ NODE_ENV: "test", AUDITOR_MODEL: "muse-spark-1.3-contributor" }), /contributor/i);
    const ok = loadConfig({ NODE_ENV: "test", AUDITOR_MODEL: "muse-spark-1.3-contributor", AUDITOR_ALLOW_CONTRIBUTOR_MODE: "1" });
    assert.equal(ok.model.dataMode, "contributor");
    assert.equal(loadConfig({ NODE_ENV: "test" }).model.dataMode, "standard");
  });

  it("prices each mode from its own documented list, and operator prices win over both", () => {
    const standard = loadConfig({ NODE_ENV: "test" }).model.pricing!;
    const contributor = loadConfig({ NODE_ENV: "test", AUDITOR_MODEL: "muse-spark-1.3-contributor", AUDITOR_ALLOW_CONTRIBUTOR_MODE: "1" }).model.pricing!;
    assert.deepEqual([standard.inputPerMTok, standard.outputPerMTok], [1.25, 4.25]);
    assert.deepEqual([contributor.inputPerMTok, contributor.cachedPerMTok, contributor.outputPerMTok], [0.1, 0.002, 0.2]);
    assert.match(contributor.source, /contributor mode/);
    const own = loadConfig({ NODE_ENV: "test", AUDITOR_MODEL: "muse-spark-1.3-contributor", AUDITOR_ALLOW_CONTRIBUTOR_MODE: "1", AUDITOR_PRICE_INPUT_PER_MTOK_USD: "0.5", AUDITOR_PRICE_OUTPUT_PER_MTOK_USD: "1" }).model.pricing!;
    assert.equal(own.inputPerMTok, 0.5);
    // An unknown model id gets no invented price.
    assert.equal(loadConfig({ NODE_ENV: "test", AUDITOR_MODEL: "muse-spark-1.2" }).model.pricing, null);
  });
});

describe("summarizeUsage", () => {
  const pricing = { inputPerMTok: 1.25, cachedPerMTok: 0.15, outputPerMTok: 4.25, source: "test price list" };
  const call = (i: number | null, o: number | null, cached: number | null) => ({
    stage: "analyze" as const, model: "m", inputTokens: i, outputTokens: o, cachedTokens: cached, reasoningTokens: null, latencyMs: 1, httpStatus: 200, responseId: null, outcome: "ok" as const,
  });

  it("estimates cost from provider-reported tokens and labels it an estimate", () => {
    const u = summarizeUsage([call(1_000_000, 100_000, 200_000)], pricing);
    assert.equal(u.totalInputTokens, 1_000_000);
    // 800k * 1.25 + 200k * 0.15 + 100k * 4.25, per million
    assert.equal(u.costEstimate?.usd, 1.455);
    assert.equal(u.costEstimate?.label, "estimate");
    assert.equal(u.costEstimate?.priceSource, "test price list");
  });

  it("never invents a cost when usage was not reported or no price is configured", () => {
    assert.equal(summarizeUsage([call(null, null, null)], pricing).costEstimate, null);
    assert.equal(summarizeUsage([call(10, 10, 0)], null).costEstimate, null);
  });
});
