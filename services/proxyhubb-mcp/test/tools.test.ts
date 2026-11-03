import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProxyHubbClient } from "../src/client.ts";
import { loadConfig } from "../src/config.ts";
import type { FetchPageOptions, FetchPageResult } from "../src/fetch.ts";
import { createToolHandlers, ToolError } from "../src/tools.ts";

type Handler = (url: URL, init: RequestInit) => unknown;
type FetchPage = (proxyUrl: string, target: URL, opts: FetchPageOptions) => Promise<FetchPageResult>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const PAGE_OK: FetchPage = async (_proxyUrl, target) => ({
  ok: true,
  finalUrl: target.href,
  redirects: [],
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: Buffer.from("<html><head><title>Shop GH</title></head><body><p>Price: GH₵ 120</p></body></html>"),
  truncated: false,
  bytesReceived: 120,
  elapsedMs: 30,
});

function makeHandlers(
  handler: Handler,
  opts: { withToken?: boolean; apiKey?: string; ownIp?: string; fetchPage?: FetchPage } = {},
) {
  const pageCalls: { proxyUrl: string; target: string }[] = [];
  const calls: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const out = handler(url, init ?? {});
    return out instanceof Response ? out : jsonResponse(out);
  }) as typeof fetch;
  const cfg = loadConfig({
    baseUrl: "http://api.test",
    accessToken: opts.withToken === false ? "" : "jwt-test",
    apiKey: opts.apiKey ?? "",
    proxyEndpoint: "proxy.test:8090",
    echoUrl: "https://echo.test/?format=json",
  });
  const handlers = createToolHandlers({
    cfg,
    client: new ProxyHubbClient(cfg, fetchFn),
    probe: async () => ({ ok: true, ip: "203.0.113.7", targetHost: "echo.test", elapsedMs: 42 }),
    geoLookup: async () => ({ country: "GH", source: "test", lookedUpAt: null, note: null }),
    learnOwnIp: async () => opts.ownIp ?? "198.51.100.9",
    fetchPage: async (proxyUrl, target, fetchOpts) => {
      pageCalls.push({ proxyUrl, target: target.href });
      return (opts.fetchPage ?? PAGE_OK)(proxyUrl, target, fetchOpts);
    },
  });
  return { handlers, calls, pageCalls };
}

const INTENT_OK = {
  token: "tok-secret-1",
  lifecycle_state: "authorized",
  expires_at: "2026-11-02T12:00:00Z",
  intent: { intent_id: "int_1", target_geo: "GH", bandwidth_limit: 104857600, email: "leak@test" },
};

describe("create_agent_session", () => {
  it("maps caps into the signed-intent payload and returns a proxy URL without leaking the raw token elsewhere", async () => {
    const { handlers, calls } = makeHandlers(() => INTENT_OK);
    const out = await handlers.createAgentSession({
      country: "gh",
      session_type: "sticky",
      max_mb: 50,
      time_limit_minutes: 15,
      max_price_per_gb: 3,
      allowed_domains: ["https://Example.com/path"],
    });
    const payload = calls[0]?.body as Record<string, unknown>;
    assert.equal(calls[0]?.method, "POST");
    assert.ok(calls[0]?.url.endsWith("/v1/sessions/intent"));
    assert.equal(payload.type, "sticky");
    assert.equal(payload.target_geo, "GH");
    assert.equal(payload.bandwidth_limit, 50 * 1024 * 1024);
    assert.equal(payload.time_limit_minutes, 15);
    assert.equal(payload.max_price_per_gb, 3);
    assert.equal(payload.rotation_type, "none");
    assert.deepEqual(payload.allowed_domains, ["example.com"]);
    assert.equal(out.status, "ready");
    assert.equal(out.proxy_url, "http://session-intent:tok-secret-1@proxy.test:8090");
    // The echoed policy must not leak PII and must not repeat the token.
    assert.equal(JSON.stringify(out.policy).includes("leak@test"), false);
    assert.equal(JSON.stringify(out.policy).includes("tok-secret-1"), false);
  });

  it("defaults rotating sessions to per-request rotation with disposable caps", async () => {
    const { handlers, calls } = makeHandlers(() => INTENT_OK);
    await handlers.createAgentSession({});
    const payload = calls[0]?.body as Record<string, unknown>;
    assert.equal(payload.type, "rotating");
    assert.equal(payload.rotation_type, "per-request");
    assert.equal(payload.bandwidth_limit, 100 * 1024 * 1024);
    assert.equal(payload.time_limit_minutes, 20);
  });

  it("reports escrow funding instead of bypassing it", async () => {
    const { handlers } = makeHandlers(() => ({
      code: "session_escrow_required",
      next: "POST /v1/sessions/intents/int_9/fund/solana",
      intent: { intent_id: "int_9" },
    }));
    const out = await handlers.createAgentSession({ country: "US" });
    assert.equal(out.status, "funding_required");
    assert.equal(out.proxy_url, null);
    assert.match(String(out.next_step), /fund\/solana/);
  });

  it("refuses to run without an access token and explains why", async () => {
    const { handlers } = makeHandlers(() => INTENT_OK, { withToken: false });
    await assert.rejects(() => handlers.createAgentSession({}), /PROXYHUBB_ACCESS_TOKEN/);
  });

  it("rejects bad countries, hosts and uncapped bandwidth", async () => {
    const { handlers } = makeHandlers(() => INTENT_OK);
    await assert.rejects(() => handlers.createAgentSession({ country: "Ghana" }), ToolError);
    await assert.rejects(() => handlers.createAgentSession({ allowed_domains: ["not a host"] }), ToolError);
    await assert.rejects(() => handlers.createAgentSession({ max_mb: 999_999 }), ToolError);
  });
});

describe("quote_session", () => {
  const LISTINGS = {
    listings: [
      { status: "active", country: "GH", price_per_gb: 0.89 },
      { status: "active", country: "GH", price_per_gb: 0.97 },
      { status: "active", country: "GH", price_per_gb: 1.04 },
      { status: "active", country: "US", price_per_gb: 2.5 },
      { status: "paused", country: "NG", price_per_gb: 0.5 },
    ],
  };

  /** Answers listings for GET and a created intent for POST, so one handler set can quote and then create. */
  const market = (url: URL, init: RequestInit) =>
    init.method === "POST" ? INTENT_OK : url.pathname === "/v1/listings" ? LISTINGS : jsonResponse({ error: "unexpected" }, 500);

  it("prices a session against active listings and creates nothing", async () => {
    const { handlers, calls } = makeHandlers(market);
    const out = await handlers.quoteSession({
      country: "gh",
      session_type: "sticky",
      max_price_per_gb: 1,
      budget_usd: 3,
      allowed_domains: ["https://Shop.Example.com/checkout"],
    });
    assert.equal(out.status, "ok");
    assert.equal(out.created, false);
    assert.equal(out.max_escrow_usd, 3);
    assert.equal(out.matching_listings, 2);
    assert.deepEqual(out.create_args, {
      session_type: "sticky",
      rotation: "none",
      max_mb: 3072,
      time_limit_minutes: 20,
      country: "GH",
      max_price_per_gb: 1,
      allowed_domains: ["shop.example.com"],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "GET");
    assert.equal(new URL(calls[0]?.url ?? "").searchParams.get("limit"), "100");
  });

  it("create_args reproduce exactly the quoted intent", async () => {
    for (const args of [
      { country: "GH", session_type: "sticky" as const, budget_usd: 2.5 },
      { country: "US", rotation_interval_seconds: 120, time_limit_minutes: 45 },
      { max_mb: 777, max_price_per_gb: 1, blocked_domains: ["facebook.com"] },
      {},
    ]) {
      const { handlers, calls } = makeHandlers(market);
      const quote = await handlers.quoteSession(args);
      assert.equal(quote.status, "ok", JSON.stringify(args));
      await handlers.createAgentSession(quote.create_args as Parameters<typeof handlers.createAgentSession>[0]);
      const payload = calls.find((c) => c.method === "POST")?.body;
      assert.deepEqual(payload, quote.intent, JSON.stringify(args));
    }
  });

  it("blocks a country without active listings, never swaps it, and offers no create_args", async () => {
    const { handlers } = makeHandlers(market);
    const out = await handlers.quoteSession({ country: "NG" });
    assert.equal(out.status, "blocked");
    assert.equal(out.create_args, null);
    assert.equal(out.intent.target_geo, "NG");
    assert.ok(out.notes.some((n) => n.level === "blocked" && /NG/.test(n.message)));
  });

  it("clamps out-of-range caps with a note instead of rejecting them", async () => {
    const { handlers } = makeHandlers(market);
    const out = await handlers.quoteSession({ max_mb: 50_000, time_limit_minutes: 999 });
    assert.equal(out.status, "ok");
    assert.equal((out.create_args as Record<string, unknown>).max_mb, 10_240);
    assert.equal((out.create_args as Record<string, unknown>).time_limit_minutes, 240);
    assert.ok(out.notes.some((n) => n.level === "warning" && /10240 MB/.test(n.message)));
  });

  it("needs no access token, because it creates nothing", async () => {
    const { handlers } = makeHandlers(market, { withToken: false });
    const out = await handlers.quoteSession({ country: "US" });
    assert.equal(out.status, "ok");
    assert.equal(out.max_escrow_usd, (100 / 1024) * 2.5);
  });

  it("reports the API failing instead of quoting an empty market", async () => {
    const { handlers } = makeHandlers(() => jsonResponse({ error: "down" }, 503));
    await assert.rejects(() => handlers.quoteSession({ country: "GH" }));
  });
});

describe("verify_exit", () => {
  it("returns verified only when the observed exit's estimate matches", async () => {
    const { handlers } = makeHandlers(() => ({}));
    const out = await handlers.verifyExit({ proxy_url: "http://session-intent:x@proxy.test:8090", expected_country: "gh" });
    assert.equal(out.assurance, "verified");
    assert.equal(out.observed_ip, "203.0.113.7");
    assert.equal(out.geoip_country, "GH");
  });

  it("requires a proxy credential", async () => {
    const { handlers } = makeHandlers(() => ({}));
    await assert.rejects(() => handlers.verifyExit({ expected_country: "GH" }), ToolError);
  });
});

describe("usage and close", () => {
  it("routes usage by session, intent, or account", async () => {
    const { handlers, calls } = makeHandlers((url) =>
      url.pathname.includes("/usage/session/") ? { bytes_used: 5, password: "no" } : { ok: true },
    );
    const out = await handlers.getSessionUsage({ session_id: "sess_1" });
    assert.ok(calls[0]?.url.endsWith("/v1/usage/session/sess_1"));
    assert.equal(JSON.stringify(out).includes('"password"'), false);
    await handlers.getSessionUsage({});
    assert.ok(calls[1]?.url.endsWith("/v1/usage/me"));
  });

  it("terminates real sessions but answers honestly for intents", async () => {
    const { handlers, calls } = makeHandlers((url) =>
      url.pathname.endsWith("/terminate") ? { terminated: true } : { intent: { expires_at: "2026-11-02T13:00:00Z" } },
    );
    const closed = await handlers.closeAgentSession({ session_id: "sess_1" });
    assert.equal(closed.closed, true);
    assert.ok(calls[0]?.url.endsWith("/v1/sessions/sess_1/terminate"));
    const intent = await handlers.closeAgentSession({ intent_id: "int_1" });
    assert.equal(intent.closed, false);
    assert.match(String(intent.reason), /no revocation endpoint/);
  });
});

describe("discovery", () => {
  it("passes facets through and filters listings by max price", async () => {
    const { handlers } = makeHandlers((url) =>
      url.pathname.endsWith("/facets")
        ? { countries: [{ value: "GH", count: 2 }], proxy_types: [], isps: [], price_buckets: [] }
        : {
            listings: [
              { id: "a", price_per_gb: 2 },
              { id: "b", price_per_gb: 9, api_key: "no" },
            ],
          },
    );
    const regions = await handlers.listRegions();
    assert.deepEqual(regions.countries, [{ value: "GH", count: 2 }]);
    const found = await handlers.discoverListings({ country: "GH", max_price_per_gb: 5 });
    assert.equal(found.count, 1);
    assert.equal(JSON.stringify(found).includes('"api_key"'), false);
  });
});

const ORDER_ID = "0b6c1f2e-1111-4222-8333-944455556666";
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: "active",
    bandwidth_gb: 1,
    price_usd: 0.9,
    created_at: "2026-11-02T10:00:00Z",
    listing: { country: "GH", title: "Accra fibre", city: "Accra", isp: "MTN", seller_wallet: "W1-secret", email: "seller@test" },
    ...overrides,
  };
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    proxy_credentials: {
      username: "u-1",
      password: "p@ss/word",
      host: "proxy.test",
      port: 8090,
      endpoint: "http://proxy.test:8090",
      auth_for_endpoint: "hmac",
      expires_at: FUTURE,
      ...overrides,
    },
  };
}

/** Answers GET /v1/orders/:id and /v1/orders/:id/credentials. */
function orderApi(o: unknown, creds: unknown) {
  return (url: URL) => (url.pathname.endsWith("/credentials") ? creds : o);
}

describe("list_my_orders", () => {
  it("lists only active orders, with public listing fields and counts of the rest", async () => {
    const { handlers, calls } = makeHandlers(() => ({
      orders: [
        order(),
        order({ id: "1b6c1f2e-1111-4222-8333-944455556666", listing: { country: "US", title: "Ohio cable" } }),
        order({ id: "2b6c1f2e-1111-4222-8333-944455556666", status: "completed" }),
        order({ id: "3b6c1f2e-1111-4222-8333-944455556666", status: "pending_payment" }),
        order({ id: "not-a-uuid" }),
      ],
    }));
    const out = await handlers.listMyOrders({ country: "gh" });
    assert.ok(calls[0]?.url.endsWith("/v1/orders?limit=100"));
    assert.equal(out.count, 1);
    assert.deepEqual(out.orders[0], {
      order_id: ORDER_ID,
      declared_country: "GH",
      title: "Accra fibre",
      city: "Accra",
      isp: "MTN",
      bandwidth_gb: 1,
      created_at: "2026-11-02T10:00:00Z",
    });
    assert.deepEqual(out.not_active, { completed: 1, pending_payment: 1 });
    const json = JSON.stringify(out);
    for (const leak of ["seller@test", "W1-secret", "price_usd"]) assert.equal(json.includes(leak), false, leak);
  });

  it("needs a token or an API key, and accepts an API key on its own", async () => {
    const none = makeHandlers(() => ({ orders: [] }), { withToken: false });
    await assert.rejects(() => none.handlers.listMyOrders({}), /PROXYHUBB_API_KEY/);

    const keyOnly = makeHandlers(() => ({ orders: [order()] }), { withToken: false, apiKey: "phub_test" });
    const out = await keyOnly.handlers.listMyOrders({});
    assert.equal(out.count, 1);
    assert.equal(keyOnly.calls[0]?.headers["x-api-key"], "phub_test");
    assert.equal(keyOnly.calls[0]?.headers.authorization, undefined);
  });

  it("says what is wrong when the token is a provider node token", async () => {
    const { handlers } = makeHandlers(() =>
      jsonResponse({ error: "provider token cannot call this route", code: "provider_token_scope" }, 403),
    );
    await assert.rejects(
      () => handlers.listMyOrders({}),
      (err: Error) =>
        /403: provider token cannot call this route/.test(err.message) &&
        /provider node token/.test(err.message) &&
        /website session/.test(err.message),
    );
  });
});

describe("use_my_order", () => {
  it("returns a proxy URL on the configured gateway for an active order", async () => {
    const { handlers, calls } = makeHandlers(orderApi(order(), credentials()));
    const out = await handlers.useMyOrder({ order_id: ORDER_ID.toUpperCase(), expected_country: "gh" });
    assert.equal(out.status, "ready");
    assert.equal(out.proxy_url, "http://u-1:p%40ss%2Fword@proxy.test:8090");
    assert.equal(out.declared_country, "GH");
    assert.equal(out.bandwidth_gb, 1);
    assert.deepEqual(
      calls.map((c) => new URL(c.url).pathname),
      [`/v1/orders/${ORDER_ID}`, `/v1/orders/${ORDER_ID}/credentials`],
    );
    assert.equal(calls[1]?.headers.authorization, "Bearer jwt-test");
  });

  it("never asks for the credentials of an order that is not active", async () => {
    const { handlers, calls } = makeHandlers(orderApi(order({ status: "completed" }), credentials()));
    const out = await handlers.useMyOrder({ order_id: ORDER_ID });
    assert.equal(out.status, "unavailable");
    assert.equal(out.code, "order_not_active");
    assert.equal(out.proxy_url, null);
    assert.equal(calls.length, 1);
  });

  it("refuses an order declared for another country before asking for credentials", async () => {
    const { handlers, calls } = makeHandlers(orderApi(order(), credentials()));
    const out = await handlers.useMyOrder({ order_id: ORDER_ID, expected_country: "US" });
    assert.equal(out.code, "order_region_mismatch");
    assert.equal(calls.length, 1);
  });

  it("reports an order whose session is not ready as retryable", async () => {
    const { handlers } = makeHandlers(
      orderApi(order(), jsonResponse({ error: "Proxy credentials are not ready yet", retryable: true }, 409)),
    );
    const out = await handlers.useMyOrder({ order_id: ORDER_ID });
    assert.equal(out.code, "order_not_ready");
    assert.equal(out.retryable, true);
  });

  it("refuses expired, non-hmac and other-gateway credentials", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ expires_at: "2020-01-01T00:00:00Z" }, "order_expired"],
      [{ auth_for_endpoint: "capability" }, "order_credentials_unsupported"],
      [{ host: "other.test", port: 9000, endpoint: "http://other.test:9000" }, "order_gateway_mismatch"],
      [{ password: "" }, "order_credentials_unreadable"],
    ];
    for (const [overrides, code] of cases) {
      const { handlers } = makeHandlers(orderApi(order(), credentials(overrides)));
      const out = await handlers.useMyOrder({ order_id: ORDER_ID });
      assert.equal(out.code, code, code);
      assert.equal(out.proxy_url, null, code);
    }
  });

  it("reports an order that is not in the account, and rejects a malformed id", async () => {
    const { handlers } = makeHandlers(() => jsonResponse({ error: "Order not found" }, 404));
    const out = await handlers.useMyOrder({ order_id: ORDER_ID });
    assert.equal(out.code, "order_not_found");
    await assert.rejects(() => handlers.useMyOrder({ order_id: "../credentials" }), ToolError);
  });
});

/** Answers the order list, the order and its credentials. */
function accountApi(o: Record<string, unknown> = order(), creds: unknown = credentials(), list: unknown[] = [o]) {
  return (url: URL) =>
    url.pathname === "/v1/orders" ? { orders: list } : url.pathname.endsWith("/credentials") ? creds : o;
}

describe("fetch_url", () => {
  it("fetches through a verified order exit and never returns the credential", async () => {
    const { handlers, calls, pageCalls } = makeHandlers(accountApi());
    const out = await handlers.fetchUrl({ url: "https://shop.example/gh", country: "gh" });
    assert.equal(out.status, "fetched");
    assert.equal(out.title, "Shop GH");
    assert.match(String(out.text), /Price: GH₵ 120/);
    assert.equal(out.exit?.assurance, "verified");
    assert.deepEqual(
      calls.map((c) => new URL(c.url).pathname),
      ["/v1/orders", `/v1/orders/${ORDER_ID}`, `/v1/orders/${ORDER_ID}/credentials`],
    );
    assert.equal(pageCalls[0]?.proxyUrl, "http://u-1:p%40ss%2Fword@proxy.test:8090");
    assert.equal(pageCalls[0]?.target, "https://shop.example/gh");
    const json = JSON.stringify(out);
    for (const secret of ["p@ss", "p%40ss", "proxy_url"]) assert.equal(json.includes(secret), false, secret);
  });

  it("does not request the page through an unverified exit by default", async () => {
    // The exit IP equals our own IP: direct_egress.
    const { handlers, pageCalls } = makeHandlers(accountApi(), { ownIp: "203.0.113.7" });
    const out = await handlers.fetchUrl({ url: "https://shop.example/", country: "GH" });
    assert.equal(out.status, "not_fetched");
    assert.equal(out.exit?.assurance, "direct_egress");
    assert.match(String(out.message), /require_verified=false/);
    assert.equal(pageCalls.length, 0);
  });

  it("fetches an unverified exit only when asked, and labels the result", async () => {
    const { handlers, pageCalls } = makeHandlers(accountApi(), { ownIp: "203.0.113.7" });
    const out = await handlers.fetchUrl({ url: "https://shop.example/", country: "GH", require_verified: false });
    assert.equal(out.status, "fetched");
    assert.match(String(out.warnings?.[0]), /NOT verified \(direct_egress\)/);
    assert.equal(pageCalls.length, 1);
  });

  it("says when there is no active order for the country", async () => {
    const { handlers, calls, pageCalls } = makeHandlers(accountApi(order(), credentials(), []));
    const out = await handlers.fetchUrl({ url: "https://shop.example/", country: "US" });
    assert.equal(out.status, "unavailable");
    assert.equal(out.code, "no_active_order");
    assert.equal(calls.length, 1);
    assert.equal(pageCalls.length, 0);
  });

  it("passes an order refusal through without fetching", async () => {
    const o = order({ status: "completed" });
    const { handlers, pageCalls } = makeHandlers(accountApi(o, credentials(), [order()]));
    const out = await handlers.fetchUrl({ url: "https://shop.example/", order_id: ORDER_ID });
    assert.equal(out.status, "unavailable");
    assert.equal(out.code, "order_not_active");
    assert.equal(pageCalls.length, 0);
  });

  it("reports a failed fetch with its stage", async () => {
    const { handlers } = makeHandlers(accountApi(), {
      fetchPage: async () => ({ ok: false, stage: "tls", message: "TLS failed.", redirects: [] }),
    });
    const out = await handlers.fetchUrl({ url: "https://shop.example/", country: "GH" });
    assert.equal(out.status, "failed");
    assert.equal(out.stage, "tls");
  });

  it("refuses non-https and internal targets before any API call", async () => {
    const { handlers, calls } = makeHandlers(accountApi());
    for (const url of ["http://shop.example/", "https://192.168.1.1/", "https://localhost/", "https://router/", "https://shop.example:22/"]) {
      await assert.rejects(() => handlers.fetchUrl({ url, country: "GH" }), ToolError, url);
    }
    await assert.rejects(() => handlers.fetchUrl({ url: "https://shop.example/" }), /country/);
    assert.equal(calls.length, 0);
  });
});
