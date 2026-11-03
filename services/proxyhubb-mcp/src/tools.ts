// Agent-facing tools over the ProxyHubb control API. Handlers are plain
// functions (transport-free) so they can be unit-tested without MCP; the
// server (server.ts) only registers them with zod schemas.
//
// Safety defaults are the point: every created session is disposable by
// default (100 MB, 20 minutes — mirroring the Regional Auditor's minting),
// price/domain caps pass straight into the signed session intent, and a
// deployment that requires escrow funding is reported, never bypassed.
//
// Where new intents need funding, an agent can instead use a marketplace order
// its owner already paid for (list_my_orders / use_my_order), exactly as the
// Regional Auditor does: active orders only, because asking for an inactive
// order's credentials can make the control API re-activate its session.

import type { ProxyHubbConfig } from "./config.ts";
import { sessionIntentProxyUrl, stripScheme } from "./config.ts";
import { ProxyHubbApiError } from "./client.ts";
import type { CreateIntentPayload, ProxyHubbClient } from "./client.ts";
import type { GeoLookup } from "./geo.ts";
import { evaluateAssurance } from "./geo.ts";
import type { ProbeResult } from "./probe.ts";
import { redact } from "./redact.ts";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolDeps {
  cfg: ProxyHubbConfig;
  client: ProxyHubbClient;
  probe: (proxyUrl: string, target: URL, timeoutMs?: number) => Promise<ProbeResult>;
  geoLookup: GeoLookup;
  learnOwnIp: (echoUrl: string) => Promise<string | null>;
}

const CC = /^[A-Z]{2}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](-*[a-z0-9])*\.)*[a-z0-9](-*[a-z0-9])*$/i;
const MIN_MB = 5;
const MAX_MB = 10_240;
const MB = 1024 * 1024;

function normalizeCountry(country: string | undefined, required: boolean): string | undefined {
  const c = (country ?? "").trim().toUpperCase();
  if (!c) {
    if (required) throw new ToolError("expected_country is required (two-letter code, e.g. GH, US).");
    return undefined;
  }
  if (!CC.test(c)) throw new ToolError(`Invalid country "${country}": use a two-letter code, e.g. GH, US.`);
  return c;
}

function normalizeDomains(domains: string[] | undefined, field: string): string[] | undefined {
  if (!domains || domains.length === 0) return undefined;
  if (domains.length > 50) throw new ToolError(`${field} accepts at most 50 entries.`);
  const out: string[] = [];
  for (const raw of domains) {
    const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0] ?? "";
    if (!HOSTNAME.test(host)) throw new ToolError(`Invalid host in ${field}: "${raw}". Use bare hostnames, e.g. example.com.`);
    out.push(host);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER_STATUS = /^[a-z][a-z_]{0,39}$/;

function text(v: unknown, max = 120): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/** The listing's seller-declared country: a claim that narrows the choice, never proof of the exit. */
function declaredCountry(listing: unknown): string | null {
  const c = text(asRecord(listing).country, 8)?.toUpperCase() ?? null;
  return c && CC.test(c) ? c : null;
}

/** Normalise "http://host:port/" and "host:port" to "host:port" (lower case), or null when there is no port. */
export function gatewayKey(value: unknown): string | null {
  const s = text(value, 200);
  if (!s) return null;
  const m = /^(?:https?:\/\/)?([^/:\s]+):(\d{1,5})\/?$/i.exec(s);
  return m ? `${(m[1] ?? "").toLowerCase()}:${Number(m[2])}` : null;
}

/** use_my_order's answer: a proxy_url when ready, otherwise a code and the reason. */
export type OrderProxyResult = {
  status: "ready" | "unavailable";
  order_id: string;
  proxy_url: string | null;
  code?: string;
  message?: string;
  retryable?: boolean;
  declared_country?: string | null;
  proxy_host?: string;
  expires_at?: string | null;
  bandwidth_gb?: number | null;
  warnings?: string[];
};

function orderAccessProblem(err: unknown): { code: string; message: string } | null {
  if (!(err instanceof ProxyHubbApiError)) return null;
  if (err.status === 404) return { code: "order_not_found", message: "This order was not found in your account." };
  if (err.status === 403) {
    return {
      code: "order_forbidden",
      message: "The control API refused access to this order. Only the buyer's own orders are readable, and an API key needs the orders:create scope.",
    };
  }
  return null;
}

export function createToolHandlers(deps: ToolDeps) {
  const { cfg, client } = deps;

  async function listRegions() {
    const facets = asRecord(redact(await client.getListingFacets()));
    return {
      countries: facets.countries ?? [],
      proxy_types: facets.proxy_types ?? [],
      isps: facets.isps ?? [],
      price_buckets: facets.price_buckets ?? [],
      note: "Counts are active marketplace listings per facet, not a guarantee that a provider node is online right now. Call verify_exit after creating a session to confirm the real exit country.",
    };
  }

  async function discoverListings(args: {
    country?: string;
    proxy_type?: string;
    q?: string;
    max_price_per_gb?: number;
  }) {
    const country = normalizeCountry(args.country, false);
    const raw = await client.searchListings({ country, proxy_type: args.proxy_type, q: args.q });
    const rec = asRecord(raw);
    let listings: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray(rec.listings)
        ? rec.listings
        : Array.isArray(rec.data)
          ? rec.data
          : [];
    if (args.max_price_per_gb !== undefined) {
      listings = listings.filter((l) => {
        const price = asRecord(l).price_per_gb;
        return typeof price !== "number" || price <= (args.max_price_per_gb as number);
      });
    }
    return {
      count: listings.length,
      listings: redact(listings.slice(0, 25)),
      note: "Listing prices are set by providers. Pass listing_id to create_agent_session to target one, or just a country to let ProxyHubb route within your caps.",
    };
  }

  async function createAgentSession(args: {
    country?: string;
    session_type?: "rotating" | "sticky";
    rotation?: "per-request" | "time-based" | "none";
    rotation_interval_seconds?: number;
    max_mb?: number;
    time_limit_minutes?: number;
    max_price_per_gb?: number;
    allowed_domains?: string[];
    blocked_domains?: string[];
    listing_id?: string;
  }) {
    if (!client.hasAccessToken) {
      throw new ToolError(
        "PROXYHUBB_ACCESS_TOKEN is not set. Session intents are minted with the account JWT (plan limits and escrow rules then apply as usual). Set it in this MCP server's environment; an API key alone cannot create sessions.",
      );
    }
    const country = normalizeCountry(args.country, false);
    const sessionType = args.session_type ?? "rotating";
    const maxMb = args.max_mb ?? 100;
    if (!Number.isFinite(maxMb) || maxMb < MIN_MB || maxMb > MAX_MB) {
      throw new ToolError(`max_mb must be between ${MIN_MB} and ${MAX_MB}. Agents get an allowance, not an unlimited wallet.`);
    }
    const minutes = args.time_limit_minutes ?? 20;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw new ToolError("time_limit_minutes must be an integer between 1 and 240.");
    }
    if (args.max_price_per_gb !== undefined && (args.max_price_per_gb < 0 || !Number.isFinite(args.max_price_per_gb))) {
      throw new ToolError("max_price_per_gb must be a non-negative number.");
    }

    const payload: CreateIntentPayload = {
      type: sessionType,
      bandwidth_limit: Math.round(maxMb * MB),
      time_limit_minutes: minutes,
    };
    if (country) payload.target_geo = country;
    if (args.listing_id) payload.listing_id = args.listing_id;
    if (args.max_price_per_gb !== undefined) payload.max_price_per_gb = args.max_price_per_gb;
    const allowed = normalizeDomains(args.allowed_domains, "allowed_domains");
    if (allowed) payload.allowed_domains = allowed;
    const blocked = normalizeDomains(args.blocked_domains, "blocked_domains");
    if (blocked) payload.blocked_domains = blocked;
    if (sessionType === "sticky") {
      payload.rotation_type = args.rotation ?? "none";
    } else if (args.rotation_interval_seconds !== undefined) {
      payload.rotation_type = args.rotation ?? "time-based";
      payload.rotation_interval_seconds = args.rotation_interval_seconds;
    } else {
      payload.rotation_type = args.rotation ?? "per-request";
    }

    const body = asRecord(await client.createSessionIntent(payload));
    const intent = asRecord(body.intent);
    const intentId = typeof intent.intent_id === "string" ? intent.intent_id : null;
    const base = {
      intent_id: intentId,
      lifecycle_state: typeof body.lifecycle_state === "string" ? body.lifecycle_state : null,
      expires_at: typeof body.expires_at === "string" ? body.expires_at : null,
    };

    if (body.code === "session_escrow_required") {
      return {
        status: "funding_required",
        ...base,
        proxy_url: null,
        next_step: typeof body.next === "string" ? body.next : `POST /v1/sessions/intents/${intentId ?? "<intent_id>"}/fund/solana`,
        message:
          "This deployment requires the session intent to be escrow-funded before traffic flows. Fund it through the normal ProxyHubb flow (this MCP server never funds or signs anything), then verify the exit before use.",
      };
    }

    const token = typeof body.token === "string" ? body.token : null;
    if (!token || !intentId) {
      throw new ToolError("The control API answered without a usable session (missing token or intent id).");
    }
    return {
      status: "ready",
      ...base,
      proxy_url: sessionIntentProxyUrl(token, cfg.proxyEndpoint),
      proxy_host: cfg.proxyEndpoint,
      proxy_username: "session-intent",
      policy: redact(intent),
      warnings: [
        "proxy_url contains a credential. Treat it as a secret; do not print it to shared logs.",
        "Country routing is best-effort until proven: call verify_exit and only trust the session when it returns assurance=verified.",
        `This session is capped at ${maxMb} MB and ${minutes} minutes. Create a new one per task instead of raising caps blindly.`,
      ],
    };
  }

  async function verifyExit(args: { proxy_url?: string; token?: string; expected_country: string }) {
    const expected = normalizeCountry(args.expected_country, true) as string;
    const proxyUrl = args.proxy_url?.trim() || (args.token ? sessionIntentProxyUrl(args.token, cfg.proxyEndpoint) : "");
    if (!proxyUrl) throw new ToolError("Provide proxy_url (from create_agent_session) or a session-intent token.");

    let target: URL;
    try {
      target = new URL(cfg.echoUrl);
    } catch {
      throw new ToolError("PROXYHUBB_ECHO_URL is not a valid URL.");
    }

    const probe = await deps.probe(proxyUrl, target, cfg.requestTimeoutMs);
    if (!probe.ok) {
      return {
        assurance: "unavailable",
        expected_country: expected,
        observed_ip: null,
        geoip_country: null,
        stage: probe.stage,
        reason: probe.message,
        note: "An unavailable exit says nothing about any website. Fix the session (funding, expiry, routing) and verify again.",
      };
    }
    const [geoip, ownIp] = await Promise.all([deps.geoLookup(probe.ip), deps.learnOwnIp(cfg.echoUrl)]);
    const verdict = evaluateAssurance({
      requestedCountry: expected,
      observedIp: probe.ip,
      geoip,
      ownDirectIp: ownIp,
    });
    return {
      assurance: verdict.assurance,
      expected_country: expected,
      observed_ip: probe.ip,
      geoip_country: geoip.country,
      geoip_source: geoip.source,
      geoip_note: geoip.note,
      elapsed_ms: probe.elapsedMs,
      reason: verdict.reason,
      note:
        verdict.assurance === "verified"
          ? "GeoIP is an estimate, not proof of physical location — but the observed exit matches the request and was measured through this proxy."
          : "Do not interpret anything fetched through this session as the expected country's behaviour.",
    };
  }

  async function getSessionUsage(args: { session_id?: string; intent_id?: string }) {
    if (args.session_id) {
      return { source: "GET /v1/usage/session/:session_id", usage: redact(await client.getSessionUsage(args.session_id)) };
    }
    if (args.intent_id) {
      return { source: "GET /v1/sessions/intents/:id", intent: redact(await client.getSessionIntent(args.intent_id)) };
    }
    return { source: "GET /v1/usage/me", usage: redact(await client.getMyUsage()) };
  }

  async function closeAgentSession(args: { session_id?: string; intent_id?: string }) {
    if (args.session_id) {
      const result = await client.terminateSession(args.session_id);
      return { closed: true, session_id: args.session_id, result: redact(result) };
    }
    if (args.intent_id) {
      let expiresAt: string | null = null;
      try {
        const intent = asRecord(redact(await client.getSessionIntent(args.intent_id)));
        const inner = asRecord(intent.intent);
        const exp = intent.expires_at ?? inner.expires_at;
        expiresAt = typeof exp === "string" ? exp : null;
      } catch {
        // Expiry is informational here; the honest answer below stands without it.
      }
      return {
        closed: false,
        intent_id: args.intent_id,
        expires_at: expiresAt,
        reason:
          "Session intents have no revocation endpoint in the control API, and this server does not invent one. The credential stops working at expires_at (intents created here live at most 240 minutes). Stop using the proxy URL now; unused escrow/budget follows the normal settlement rules. To hard-stop a live routed session instead, pass its session_id.",
      };
    }
    throw new ToolError("Provide session_id (terminates a live session) or intent_id (reports its expiry).");
  }

  function requireOrderAccess() {
    if (!client.canReadOrders) {
      throw new ToolError(
        "Set PROXYHUBB_ACCESS_TOKEN (your account JWT) or PROXYHUBB_API_KEY (an API key with the orders:create scope) in this MCP server's environment to use your orders.",
      );
    }
  }

  async function listMyOrders(args: { country?: string }) {
    requireOrderAccess();
    const country = normalizeCountry(args.country, false);
    const body = asRecord(await client.listOrders());
    const raw = Array.isArray(body.orders) ? (body.orders as unknown[]) : [];
    const orders: Record<string, unknown>[] = [];
    const notActive: Record<string, number> = {};
    for (const item of raw) {
      const o = asRecord(item);
      const id = typeof o.id === "string" && ORDER_ID.test(o.id) ? o.id.toLowerCase() : null;
      if (!id) continue;
      if (o.status !== "active") {
        const status = typeof o.status === "string" && ORDER_STATUS.test(o.status) ? o.status : "unknown";
        notActive[status] = (notActive[status] ?? 0) + 1;
        continue;
      }
      const listing = asRecord(o.listing);
      const declared = declaredCountry(listing);
      if (country && declared !== country) continue;
      // Identifiers and the listing's public description only: no seller, wallet, price or credentials.
      orders.push({
        order_id: id,
        declared_country: declared,
        title: text(listing.title) ?? "Marketplace order",
        city: text(listing.city, 80),
        isp: text(listing.isp, 80),
        bandwidth_gb: typeof o.bandwidth_gb === "number" && Number.isFinite(o.bandwidth_gb) ? o.bandwidth_gb : null,
        created_at: text(o.created_at, 40),
      });
    }
    return {
      count: orders.length,
      orders,
      not_active: notActive,
      note: "Only active, already-paid orders are listed: they can carry traffic now. declared_country is the seller's claim. Call use_my_order for a proxy_url, then verify_exit. Nothing here buys, pays for or funds anything.",
    };
  }

  async function useMyOrder(args: { order_id: string; expected_country?: string }): Promise<OrderProxyResult> {
    requireOrderAccess();
    const id = (args.order_id ?? "").trim().toLowerCase();
    if (!ORDER_ID.test(id)) throw new ToolError("order_id must be an order id from list_my_orders.");
    const expected = normalizeCountry(args.expected_country, false);
    const unavailable = (code: string, message: string, extra: Partial<OrderProxyResult> = {}): OrderProxyResult => ({
      status: "unavailable",
      order_id: id,
      code,
      message,
      proxy_url: null,
      ...extra,
    });

    let order: Record<string, unknown>;
    try {
      order = asRecord(await client.getOrder(id));
    } catch (err) {
      const problem = orderAccessProblem(err);
      if (problem) return unavailable(problem.code, problem.message);
      throw err;
    }

    // Checked before credentials are requested: for an order in any other state the control API may
    // try to re-activate its session, and an agent must not cause that.
    const status = text(order.status, 40);
    if (status !== "active") {
      return unavailable("order_not_active", `This order is ${status ?? "in an unknown state"}; only active orders can carry traffic.`);
    }
    const declared = declaredCountry(order.listing);
    if (expected && declared && declared !== expected) {
      return unavailable("order_region_mismatch", `This order is for a ${declared} listing, not ${expected}, so its credentials were not requested.`, {
        declared_country: declared,
      });
    }

    let creds: Record<string, unknown>;
    try {
      creds = asRecord(await client.getOrderCredentials(id));
    } catch (err) {
      if (err instanceof ProxyHubbApiError && err.status === 409) {
        return unavailable("order_not_ready", `The order's session is not ready yet (${err.message}). Retry in a minute.`, { retryable: true });
      }
      const problem = orderAccessProblem(err);
      if (problem) return unavailable(problem.code, problem.message);
      throw err;
    }

    const pc = asRecord(creds.proxy_credentials);
    const username = text(pc.username, 120);
    const password = typeof pc.password === "string" && pc.password.length > 0 && pc.password.length <= 4096 ? pc.password : null;
    if (!username || !password) {
      return unavailable("order_credentials_unreadable", "The control API answered without usable proxy credentials for this order.");
    }
    const expiresAt = text(pc.expires_at, 40) ?? text(creds.expires_at, 40);
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      return unavailable("order_expired", "This order's session has expired.", { expires_at: expiresAt });
    }
    const scheme = text(pc.auth_for_endpoint, 24);
    if (scheme && scheme !== "hmac") {
      return unavailable("order_credentials_unsupported", `This order's gateway uses "${scheme}" authentication; only HTTP proxy (hmac) credentials are supported.`);
    }
    // Never hand an order's credentials to a different gateway than the one the order is for.
    const configured = gatewayKey(cfg.proxyEndpoint);
    const orderGateway =
      (typeof pc.host === "string" && typeof pc.port === "number" ? gatewayKey(`${pc.host}:${pc.port}`) : null) ?? gatewayKey(pc.endpoint);
    if (configured && orderGateway && orderGateway !== configured) {
      return unavailable(
        "order_gateway_mismatch",
        `This order is for the gateway ${orderGateway}, but this server is configured for ${configured} (PROXYHUBB_PROXY_ENDPOINT), so its credentials were not used.`,
      );
    }

    const host = stripScheme(cfg.proxyEndpoint);
    return {
      status: "ready",
      order_id: id,
      declared_country: declared,
      proxy_url: `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}`,
      proxy_host: host,
      expires_at: expiresAt,
      bandwidth_gb: typeof order.bandwidth_gb === "number" && Number.isFinite(order.bandwidth_gb) ? order.bandwidth_gb : null,
      warnings: [
        "proxy_url contains the order's credentials. Treat it as a secret; do not print it to shared logs.",
        `The country is the seller's claim until proven: call verify_exit with expected_country=${expected ?? declared ?? "<two-letter code>"} and only trust the session when it returns assurance=verified.`,
        "Traffic counts against this order's prepaid bandwidth. This server cannot set a smaller cap on an order; for a hard per-task cap, use create_agent_session where the deployment allows it.",
      ],
    };
  }

  return {
    listRegions,
    discoverListings,
    createAgentSession,
    verifyExit,
    getSessionUsage,
    closeAgentSession,
    listMyOrders,
    useMyOrder,
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
