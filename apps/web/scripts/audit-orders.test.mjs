// Tests for using marketplace orders as the session source of a live audit.
// Run: node --test scripts/audit-orders.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { gatewayKey, listUsableOrders, resolveOrderSessions } from "../src/lib/server/audit-orders.ts";

const O_GH = "6f1c2d3e-0000-4000-8000-00000000a001";
const O_US = "6f1c2d3e-0000-4000-8000-00000000a002";
const O_OLD = "6f1c2d3e-0000-4000-8000-00000000a003";
const BEARER = "user-bearer-token-0000000000";

/** A stand-in control API: path -> { status, body }. Records every call so tests can assert what was NOT requested. */
function fakeApi(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname + u.search, auth: init?.headers?.authorization });
    const hit = routes[u.pathname];
    if (!hit) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    return new Response(JSON.stringify(hit.body ?? null), { status: hit.status ?? 200 });
  };
  return { fetchImpl, calls, ctx: { base: "https://api.example.test", bearer: BEARER, fetchImpl } };
}
const creds = (over = {}) => ({
  proxy_credentials: { username: "sess-user-1", password: "hmac-pass-1", host: "proxy.example.test", port: 8090, endpoint: "proxy.example.test:8090", auth_for_endpoint: "hmac", ...over },
});
const order = (id, country, over = {}) => ({
  id,
  status: "active",
  bandwidth_gb: 0.5,
  created_at: "2026-11-02T08:00:00Z",
  listing: { title: `${country} mobile`, country, city: "Accra", isp: "Example ISP" },
  ...over,
});

test("only the caller's active orders are listed, and only harmless fields reach the browser", async () => {
  const api = fakeApi({
    "/v1/orders": {
      body: {
        orders: [
          { ...order(O_GH, "gh"), buyer_wallet: "WALLET1111", seller: { id: "s", email: "seller@example.test" }, tx_signature: "SIG", price_total: 3 },
          order(O_OLD, "US", { status: "completed" }),
          order("not-a-uuid", "US"),
          order(O_US, "US", { listing: undefined }),
        ],
      },
    },
  });
  const res = await listUsableOrders(api.ctx);
  assert.equal(res.ok, true);
  assert.deepEqual(res.orders.map((o) => o.id), [O_GH, O_US]);
  assert.equal(res.orders[0].country, "GH", "country is normalised to upper case");
  assert.equal(res.orders[1].country, null);
  assert.equal(res.orders[1].title, "Marketplace order");
  const shown = JSON.stringify(res.orders);
  for (const secret of ["WALLET1111", "seller@example.test", "SIG"]) assert.ok(!shown.includes(secret), `${secret} must not be passed on`);
  assert.deepEqual(api.calls.map((c) => c.auth), [`Bearer ${BEARER}`], "the caller's own token is used");
  assert.deepEqual(res.otherStatuses, { completed: 1 }, "orders that cannot carry an audit are counted by status, not listed");
});

test("explains an empty list by counting the account's other orders, without passing on odd status text", async () => {
  const api = fakeApi({
    "/v1/orders": {
      body: {
        orders: [
          order(O_GH, "GH", { status: "pending_payment" }),
          order(O_US, "US", { status: "pending_payment" }),
          order(O_OLD, "US", { status: "<script>alert(1)</script>" }),
        ],
      },
    },
  });
  const res = await listUsableOrders(api.ctx);
  assert.deepEqual(res.orders, []);
  assert.deepEqual(res.otherStatuses, { pending_payment: 2, unknown: 1 });
});

test("listing failures are reported with a stable code", async () => {
  assert.equal((await listUsableOrders(fakeApi({ "/v1/orders": { status: 401, body: {} } }).ctx)).code, "not_authenticated");
  assert.equal((await listUsableOrders(fakeApi({ "/v1/orders": { status: 500, body: { error: "boom" } } }).ctx)).code, "orders_unreadable");
  const down = await listUsableOrders({ base: "https://api.example.test", bearer: BEARER, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(down.code, "control_api_unreachable");
});

test("selected orders become per-region credentials, with the listing's country kept as a claim", async () => {
  const api = fakeApi({
    [`/v1/orders/${O_GH}`]: { body: order(O_GH, "GH") },
    [`/v1/orders/${O_GH}/credentials`]: { body: creds() },
    [`/v1/orders/${O_US}`]: { body: order(O_US, "US") },
    [`/v1/orders/${O_US}/credentials`]: { body: creds({ username: "sess-user-2", password: "hmac-pass-2" }) },
  });
  const out = await resolveOrderSessions(["GH", "US"], { GH: O_GH, US: O_US.toUpperCase() }, api.ctx, "proxy.example.test:8090");
  assert.deepEqual(out.unavailable, {});
  assert.deepEqual(out.credentials.GH, {
    sessionRef: O_GH,
    source: "marketplace_order",
    username: "sess-user-1",
    password: "hmac-pass-1",
    declaredCountry: "GH",
    declaredCountrySource: "ProxyHubb marketplace listing (seller-declared)",
  });
  assert.equal(out.credentials.US.sessionRef, O_US, "ids are normalised to lower case");
  assert.deepEqual(out.sessionPlan, { source: "marketplace_order", orders: { GH: O_GH, US: O_US } });
  assert.ok(api.calls.every((c) => c.auth === `Bearer ${BEARER}`));
  assert.ok(!JSON.stringify(out.sessionPlan).includes("hmac-pass"), "the remembered plan holds identifiers, never credentials");
});

test("an order for a different country is refused before its credentials are ever requested", async () => {
  const api = fakeApi({ [`/v1/orders/${O_US}`]: { body: order(O_US, "US") }, [`/v1/orders/${O_US}/credentials`]: { body: creds() } });
  const out = await resolveOrderSessions(["GH"], { GH: O_US }, api.ctx, null);
  assert.deepEqual(out.credentials, {});
  assert.equal(out.unavailable.GH.code, "order_region_mismatch");
  assert.ok(!api.calls.some((c) => c.path.endsWith("/credentials")), "no credentials were fetched for the wrong region");
});

test("an unlabelled listing is allowed (the worker still verifies the exit) but declares no country", async () => {
  const api = fakeApi({
    [`/v1/orders/${O_GH}`]: { body: order(O_GH, "GH", { listing: { title: "No country" } }) },
    [`/v1/orders/${O_GH}/credentials`]: { body: creds() },
  });
  const out = await resolveOrderSessions(["GH"], { GH: O_GH }, api.ctx, null);
  assert.equal(out.credentials.GH.declaredCountry, undefined);
  assert.equal(out.credentials.GH.declaredCountrySource, undefined);
});

test("every way an order can be unusable becomes a clear unavailable region, never a substitute route", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const gh = { [`/v1/orders/${O_GH}`]: { body: order(O_GH, "GH") } };
  const withCreds = (body, status) => ({ ...gh, [`/v1/orders/${O_GH}/credentials`]: { status, body } });
  const cases = [
    ["no order picked", {}, {}, "no_order_selected"],
    ["not a uuid", { GH: "../../etc/passwd" }, {}, "invalid_order"],
    ["someone else's order", { GH: O_GH }, { [`/v1/orders/${O_GH}`]: { status: 403, body: { error: "Access denied" } } }, "order_not_found"],
    ["order not active", { GH: O_GH }, { [`/v1/orders/${O_GH}`]: { body: order(O_GH, "GH", { status: "pending" }) } }, "order_not_active"],
    ["session not ready", { GH: O_GH }, withCreds({ error: "Proxy credentials are not ready yet" }, 409), "order_not_ready"],
    ["session expired", { GH: O_GH }, withCreds(creds({ expires_at: past })), "order_expired"],
    ["soak capability auth", { GH: O_GH }, withCreds(creds({ auth_for_endpoint: "capability" })), "order_credentials_unsupported"],
    ["different gateway", { GH: O_GH }, withCreds(creds({ host: "other.example.test", port: 9999 })), "order_gateway_mismatch"],
    ["credentials without a password", { GH: O_GH }, withCreds(creds({ password: "" })), "order_credentials_unreadable"],
  ];
  for (const [name, selection, routes, code] of cases) {
    const out = await resolveOrderSessions(["GH"], selection, fakeApi(routes).ctx, "proxy.example.test:8090");
    assert.deepEqual(out.credentials, {}, `${name}: no credentials`);
    assert.equal(out.unavailable.GH?.code, code, name);
    assert.ok(out.unavailable.GH.message.length <= 300, `${name}: fits the worker's message limit`);
  }
});

test("a region without a valid selection is not recorded in the remembered plan", async () => {
  const out = await resolveOrderSessions(["GH"], { GH: "nope" }, fakeApi({}).ctx, null);
  assert.equal(out.sessionPlan, null);
});

test("what the web server sends for an order-based audit is accepted by the worker's own contract", async () => {
  const { CreateAuditBody, RerunBody } = await import("../../../services/regional-auditor/src/contracts.ts");
  const api = fakeApi({
    [`/v1/orders/${O_GH}`]: { body: order(O_GH, "GH") },
    [`/v1/orders/${O_GH}/credentials`]: { body: creds() },
  });
  const out = await resolveOrderSessions(["GH", "US"], { GH: O_GH }, api.ctx, "proxy.example.test:8090");
  const request = { targetUrl: "https://shop.example.test/", regions: ["GH", "US"], expectations: "Check that signup is usable.", mode: "live" };
  const body = { request, credentials: out.credentials, unavailable: out.unavailable, sessionPlan: out.sessionPlan };

  const parsed = CreateAuditBody.parse(body);
  assert.equal(parsed.credentials.GH.source, "marketplace_order");
  assert.deepEqual(parsed.sessionPlan, { source: "marketplace_order", orders: { GH: O_GH } });
  assert.equal(parsed.unavailable.US.code, "no_order_selected");
  assert.deepEqual(RerunBody.parse({ credentials: out.credentials, unavailable: out.unavailable, sessionPlan: out.sessionPlan }).sessionPlan, parsed.sessionPlan);
  // Opened sessions (no source field) still parse and default to a session intent.
  assert.equal(CreateAuditBody.parse({ request, credentials: { GH: { sessionRef: "x", username: "session-intent", password: "p" } } }).credentials.GH.source, "session_intent");
});

test("gateway comparison ignores scheme, case and trailing slash, and skips when a port is missing", () => {
  assert.equal(gatewayKey("http://Proxy.Example.test:8090/"), "proxy.example.test:8090");
  assert.equal(gatewayKey("proxy.example.test:08090"), "proxy.example.test:8090");
  assert.equal(gatewayKey("proxy.example.test"), null);
  assert.equal(gatewayKey(undefined), null);
});
