// Server-only: lets a live audit run over marketplace orders the signed-in user has ALREADY paid for.
//
// This is the alternative to opening new session intents (audit-sessions.ts). On deployments that
// require an escrow-funded session, an intent cannot carry traffic until the user's wallet funds it,
// and the audit never does that. A funded marketplace order, bought through the normal flow, returns
// proxy credentials; this module reads them with the CALLER's own token, so ownership, status and
// expiry are enforced by the control API exactly as on the order page.
//
// What this module does not do: create or fund anything, use another user's order, or trust the order's
// advertised country. The worker still observes the real exit IP and refuses to interpret evidence from
// an exit that does not verify. No relative runtime imports on purpose, so node can test it directly.

import type { MintedSessions, RegionCredentialPayload, RegionUnavailablePayload } from "./audit-sessions";

export interface OrderApiContext {
  base: string;
  bearer: string;
  fetchImpl?: typeof fetch;
}

/** The only fields about an order that ever reach the browser: no seller, wallet, price or credentials. */
export interface AuditOrderOption {
  id: string;
  /** Seller-declared country of the listing (a claim; the audit verifies the real exit). */
  country: string | null;
  title: string;
  city: string | null;
  isp: string | null;
  bandwidthGb: number | null;
  createdAt: string | null;
}

export interface SessionPlanPayload {
  source: "marketplace_order";
  orders: Record<string, string>;
}

export type OrderSessions = MintedSessions & { sessionPlan: SessionPlanPayload | null };

export const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CC = /^[A-Z]{2}$/;
const MAX_ORDERS = 100;

type Fetched = { ok: true; status: number; body: Record<string, unknown> | null } | { ok: false };

async function getJson(ctx: OrderApiContext, path: string): Promise<Fetched> {
  try {
    const res = await (ctx.fetchImpl ?? fetch)(new URL(path, ctx.base), {
      headers: { authorization: `Bearer ${ctx.bearer}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: true, status: res.status, body: body && typeof body === "object" ? body : null };
  } catch {
    return { ok: false };
  }
}

const text = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const reasonOf = (body: Record<string, unknown> | null): string | undefined => text(body?.error, 200) ?? undefined;

function countryOf(listing: Record<string, unknown> | null | undefined): string | null {
  const c = text(listing?.country, 8)?.toUpperCase() ?? null;
  return c && CC.test(c) ? c : null;
}

/** Normalise "http://host:port/" and "host:port" to "host:port" (lower case), or null when there is no port to compare. */
export function gatewayKey(value: unknown): string | null {
  const s = text(value, 200);
  if (!s) return null;
  const m = /^(?:https?:\/\/)?([^/:\s]+):(\d{1,5})\/?$/i.exec(s);
  return m ? `${m[1]!.toLowerCase()}:${Number(m[2])}` : null;
}

// ---------------------------------------------------------------------------
// Which orders can carry an audit?
// ---------------------------------------------------------------------------

export type ListOrdersResult =
  /** `otherStatuses` counts the orders that cannot carry an audit, by status, so "none usable" can say why. */
  | { ok: true; orders: AuditOrderOption[]; otherStatuses: Record<string, number> }
  | { ok: false; status: number; code: string; message: string };

const STATUS_RE = /^[a-z][a-z_]{0,39}$/;

/**
 * The caller's ACTIVE orders. Only active ones: fetching credentials for an order in any other state
 * can make the control API try to re-activate its session, and an audit must not cause that.
 */
export async function listUsableOrders(ctx: OrderApiContext): Promise<ListOrdersResult> {
  const res = await getJson(ctx, `/v1/orders?limit=${MAX_ORDERS}`);
  if (!res.ok) return { ok: false, status: 503, code: "control_api_unreachable", message: "The ProxyHubb control API could not be reached to list your orders." };
  if (res.status === 401) return { ok: false, status: 401, code: "not_authenticated", message: "Your session expired. Sign in again to list your orders." };
  if (res.status !== 200 || !res.body) {
    return { ok: false, status: 502, code: "orders_unreadable", message: reasonOf(res.body) ?? `The control API answered HTTP ${res.status} when listing your orders.` };
  }
  const raw = Array.isArray(res.body.orders) ? (res.body.orders as unknown[]) : [];
  const orders: AuditOrderOption[] = [];
  const otherStatuses: Record<string, number> = {};
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" && ORDER_ID_RE.test(o.id) ? o.id.toLowerCase() : null;
    if (!id) continue;
    if (o.status !== "active") {
      const status = typeof o.status === "string" && STATUS_RE.test(o.status) ? o.status : "unknown";
      otherStatuses[status] = (otherStatuses[status] ?? 0) + 1;
      continue;
    }
    const listing = o.listing && typeof o.listing === "object" ? (o.listing as Record<string, unknown>) : null;
    orders.push({
      id,
      country: countryOf(listing),
      title: text(listing?.title) ?? "Marketplace order",
      city: text(listing?.city, 80),
      isp: text(listing?.isp, 80),
      bandwidthGb: typeof o.bandwidth_gb === "number" && Number.isFinite(o.bandwidth_gb) ? o.bandwidth_gb : null,
      createdAt: text(o.created_at, 40),
    });
  }
  return { ok: true, orders, otherStatuses };
}

// ---------------------------------------------------------------------------
// Turning a selection into per-region credentials
// ---------------------------------------------------------------------------

interface ResolveOne {
  credential?: RegionCredentialPayload;
  unavailable?: RegionUnavailablePayload;
}

const no = (code: string, message: string): ResolveOne => ({ unavailable: { code, message: message.slice(0, 300) } });

async function resolveOne(country: string, orderId: string | undefined, ctx: OrderApiContext, gateway: string | null): Promise<ResolveOne> {
  if (!orderId) return no("no_order_selected", `No marketplace order was selected for ${country}.`);
  if (!ORDER_ID_RE.test(orderId)) return no("invalid_order", `The order selected for ${country} is not a valid order id.`);
  const id = orderId.toLowerCase();

  const order = await getJson(ctx, `/v1/orders/${id}`);
  if (!order.ok) return no("control_api_unreachable", "The ProxyHubb control API could not be reached to read the order.");
  if (order.status === 401) return no("not_authenticated", "Your session expired. Sign in again to run a live audit.");
  if (order.status === 403 || order.status === 404) return no("order_not_found", `The order selected for ${country} was not found in your account.`);
  if (order.status !== 200 || !order.body) return no("order_unreadable", reasonOf(order.body) ?? `The control API answered HTTP ${order.status} for the order selected for ${country}.`);

  const status = text(order.body.status, 40);
  if (status !== "active") return no("order_not_active", `The order selected for ${country} is ${status ?? "in an unknown state"}; only active orders can carry an audit.`);

  const listing = order.body.listing && typeof order.body.listing === "object" ? (order.body.listing as Record<string, unknown>) : null;
  const declared = countryOf(listing);
  if (declared && declared !== country) {
    // Refuse before any traffic: the listing says this order exits somewhere else.
    return no("order_region_mismatch", `The order selected for ${country} is for a ${declared} listing, so it was not used.`);
  }

  const creds = await getJson(ctx, `/v1/orders/${id}/credentials`);
  if (!creds.ok) return no("control_api_unreachable", "The ProxyHubb control API could not be reached to read the order's credentials.");
  if (creds.status === 401) return no("not_authenticated", "Your session expired. Sign in again to run a live audit.");
  if (creds.status === 403 || creds.status === 404) return no("order_not_found", `The order selected for ${country} was not found in your account.`);
  if (creds.status === 409) {
    return no("order_not_ready", reasonOf(creds.body) ? `The order selected for ${country} is not ready: ${reasonOf(creds.body)}.` : `The session for the order selected for ${country} is not ready yet. Retry shortly.`);
  }
  const pc = creds.body?.proxy_credentials && typeof creds.body.proxy_credentials === "object" ? (creds.body.proxy_credentials as Record<string, unknown>) : null;
  if (creds.status !== 200 || !pc) return no("order_credentials_unreadable", reasonOf(creds.body) ?? `The control API answered HTTP ${creds.status} for the order's credentials.`);

  const username = text(pc.username, 120);
  const password = typeof pc.password === "string" && pc.password.length > 0 && pc.password.length <= 4096 ? pc.password : null;
  if (!username || !password) return no("order_credentials_unreadable", "The control API answered without usable proxy credentials for this order.");

  const expiresAt = text(pc.expires_at, 40);
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return no("order_expired", `The session for the order selected for ${country} has expired.`);

  // The browser authenticates with HTTP Basic. A different scheme (e.g. a soak capability token) would just fail.
  const scheme = text(pc.auth_for_endpoint, 24);
  if (scheme && scheme !== "hmac") return no("order_credentials_unsupported", `This order's gateway uses "${scheme}" authentication, which the auditor does not support.`);

  // Do not hand an order's credentials to a different gateway than the one the order is for.
  const orderGateway = (typeof pc.host === "string" && typeof pc.port === "number" ? gatewayKey(`${pc.host}:${pc.port}`) : null) ?? gatewayKey(pc.endpoint);
  if (gateway && orderGateway && orderGateway !== gateway) {
    return no("order_gateway_mismatch", `This order is for the gateway ${orderGateway}, but the auditor is configured for ${gateway}, so its credentials were not sent.`);
  }

  return {
    credential: {
      sessionRef: id,
      source: "marketplace_order",
      username,
      password,
      ...(declared ? { declaredCountry: declared, declaredCountrySource: "ProxyHubb marketplace listing (seller-declared)" } : {}),
    },
  };
}

/**
 * One credential per requested region from the caller's own orders. A region with no usable order is
 * reported as unavailable with the reason; nothing is substituted and nothing is created.
 */
export async function resolveOrderSessions(
  regions: string[],
  selection: Record<string, unknown>,
  ctx: OrderApiContext,
  /** host:port the auditor's gateway is configured as (from its capabilities), when known. */
  gateway: string | null,
): Promise<OrderSessions> {
  const out: OrderSessions = { credentials: {}, unavailable: {}, sessionPlan: null };
  const unique = [...new Set(regions)];
  const chosen: Record<string, string> = {};
  const gw = gatewayKey(gateway);

  const results = await Promise.all(
    unique.map(async (country): Promise<readonly [string, ResolveOne]> => {
      if (!CC.test(country)) return [country, no("invalid_region", "Regions must be two-letter country codes.")];
      const pick = selection[country];
      const orderId = typeof pick === "string" ? pick.trim() : undefined;
      if (orderId && ORDER_ID_RE.test(orderId)) chosen[country] = orderId.toLowerCase();
      return [country, await resolveOne(country, orderId, ctx, gw)];
    }),
  );
  for (const [country, r] of results) {
    if (r.credential) out.credentials[country] = r.credential;
    else if (r.unavailable) out.unavailable[country] = r.unavailable;
  }
  // Remember the selection (identifiers only) so "Rerun and compare" can use the same orders.
  if (Object.keys(chosen).length > 0) out.sessionPlan = { source: "marketplace_order", orders: chosen };
  return out;
}
