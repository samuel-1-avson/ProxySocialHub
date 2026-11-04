// Server-side allowlist. No arbitrary URL, SQL, credential, or mutation tool is exposed.
import { ASSISTANT_DESTINATIONS, redactAssistantSecrets, searchAssistantGuides, type AssistantSource } from "../assistant";
import { gatewayEndpoint, probeGatewayAdmission, type GatewayProbeResult } from "./assistant-gateway-probe";

export interface AssistantToolContext {
  bearer: string;
  role?: string;
  apiBase: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Test hook for the credential-free gateway admission probe. */
  gatewayProbeImpl?: (endpoint: string) => Promise<GatewayProbeResult>;
}
export interface AssistantToolResult {
  ok: boolean;
  label: string;
  data: unknown;
  sources: AssistantSource[];
}
const schema = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: "string" };
export const ASSISTANT_TOOLS = [
  { type: "function", name: "search_help", description: "Search reviewed ProxyHubb product guides. Use for setup, escrow, troubleshooting, provider onboarding, and platform questions.", strict: true, parameters: schema({ query: string }) },
  { type: "function", name: "find_listings", description: "Read up to five live marketplace listings. Country is an ISO two-letter code or empty for all countries. Prices are USD per GB. Empty proxy_type means any type.", strict: true, parameters: schema({ country: string, proxy_type: { type: "string", enum: ["", "residential", "mobile", "datacenter", "rotating", "sticky", "both"] }, max_price: { type: ["number", "null"] } }) },
  { type: "function", name: "get_my_orders", description: "Read up to ten of the signed-in caller's most recent orders and their status. No proxy credentials or payment signing. Never claim this covers every order.", strict: true, parameters: schema({}) },
  { type: "function", name: "get_my_order_detail", description: "Read one of the caller's own orders by the id returned from get_my_orders: escrow expiry, price paid, amount locked, and status. Ownership is enforced by the API. Metered bandwidth usage is not stored on the order and is never returned.", strict: true, parameters: schema({ order_id: string }) },
  { type: "function", name: "get_my_wallet", description: "Read the caller's wallet balance summary: platform balance, on-chain SOL when a wallet is linked, and payable earnings. No addresses, transactions, or signing.", strict: true, parameters: schema({}) },
  { type: "function", name: "get_my_nodes", description: "Read up to ten provider nodes owned by the signed-in caller. Provider role required. Does not reveal private IPs or node keys.", strict: true, parameters: schema({}) },
  { type: "function", name: "get_my_earnings", description: "Read the caller's provider earnings summary in SOL: total, pending, paid, payable now, and last 7/30 days. Provider role required.", strict: true, parameters: schema({}) },
  { type: "function", name: "check_api_health", description: "Check control API reachability. This is NOT an end-to-end proxy, provider, uptime, or regional exit test.", strict: true, parameters: schema({}) },
  { type: "function", name: "check_proxy_gateway", description: "Check that the buyer proxy gateway answers and demands authentication (HTTP 407), using no credentials. This does NOT test the caller's session, any provider, or an exit location.", strict: true, parameters: schema({}) },
] as const;

const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown, max = 160): string | null => typeof v === "string" ? redactAssistantSecrets(v.slice(0, max)) : null;
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const id = (v: unknown): string | null => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v) ? v : null;
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.slice(0, 10).map(obj) : [];
const no = (label: string, error: string): AssistantToolResult => ({ ok: false, label, data: { error }, sources: [] });
const unixIso = (v: unknown): string | null => typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v * 1000).toISOString() : null;
const isProvider = (ctx: AssistantToolContext) => ["provider", "both", "admin"].includes(ctx.role || "");

async function get(ctx: AssistantToolContext, path: string, authenticated = true): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await (ctx.fetchImpl ?? fetch)(new URL(path, ctx.apiBase), {
    method: "GET", cache: "no-store", redirect: "error",
    headers: { accept: "application/json", ...(authenticated ? { authorization: `Bearer ${ctx.bearer}` } : {}) },
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]),
  });
  // A bounded read avoids forwarding arbitrarily large upstream payloads to a model.
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, status: response.status, body: {} };
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512 * 1024) { await reader.cancel(); return { ok: false, status: 502, body: {} }; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return { ok: response.ok, status: response.status, body: obj(JSON.parse(raw)) };
  } finally { reader.releaseLock(); }
}

export async function executeAssistantTool(name: string, raw: unknown, ctx: AssistantToolContext): Promise<AssistantToolResult> {
  const args = obj(raw);
  try {
    switch (name) {
      case "search_help": {
        if (typeof args.query !== "string" || args.query.length > 500) return no("Search help", "Use a query of at most 500 characters.");
        const guides = searchAssistantGuides(args.query);
        return { ok: true, label: "Searched ProxyHubb help guides", data: guides, sources: guides.map(({ title, href }) => ({ title, href })) };
      }
      case "find_listings": {
        if (typeof args.country !== "string" || (args.country !== "" && !/^[A-Za-z]{2}$/.test(args.country))) return no("Search listings", "country must be a two-letter ISO code or empty.");
        if (typeof args.proxy_type !== "string" || !["", "residential", "mobile", "datacenter", "rotating", "sticky", "both"].includes(args.proxy_type)) return no("Search listings", "Unsupported proxy type.");
        if (args.max_price !== null && (typeof args.max_price !== "number" || !Number.isFinite(args.max_price) || args.max_price < 0 || args.max_price > 100000)) return no("Search listings", "Invalid maximum price.");
        const query = new URLSearchParams({ limit: "5", page: "1", sort_by: "price_asc" });
        if (args.country) query.set("country", args.country.toUpperCase());
        if (args.proxy_type) query.set("proxy_type", args.proxy_type);
        if (args.max_price !== null) query.set("max_price", String(args.max_price));
        const res = await get(ctx, `/v1/listings?${query}`, false);
        if (!res.ok || !Array.isArray(res.body.listings)) return no("Search listings", "Live listings could not be read. Do not infer availability.");
        const listings = rows(res.body.listings).slice(0, 5).filter((r) => id(r.id)).map((r) => ({
          id: id(r.id), title: str(r.title), country: str(r.country, 2), proxy_type: str(r.proxy_type, 30), protocol: str(r.protocol, 40), status: str(r.status, 40),
          price_usd_per_gb: number(r.price_per_gb), available_bandwidth_gb: number(r.available_bandwidth_gb), min_purchase_gb: number(r.min_purchase_gb),
          measurement_source: str(r.sla_source, 30), location_note: "Seller-declared country; not verified exit evidence.",
        }));
        return { ok: true, label: `Checked live marketplace (${listings.length} results)`, data: { listings, sampled: true, checked_at: new Date().toISOString() }, sources: [ASSISTANT_DESTINATIONS.marketplace, ...listings.map((r) => ({ title: r.title || "View listing", href: `/marketplace/${r.id}` }))] };
      }
      case "get_my_orders": {
        const res = await get(ctx, "/v1/orders?limit=10&page=1");
        if (!res.ok || !Array.isArray(res.body.orders)) return no("Read your orders", res.status === 401 ? "Your session expired. Sign in again." : "Your orders could not be read.");
        const orders = rows(res.body.orders).filter((r) => id(r.id)).map((r) => ({ id: id(r.id), title: str(obj(r.listing).title), status: str(r.status, 40), bandwidth_gb: number(r.bandwidth_gb), created_at: str(r.created_at, 40), escrow_status: str(r.escrow_status, 40), escrow_expires_at: unixIso(r.escrow_expires_at) }));
        return { ok: true, label: `Read your recent orders (${orders.length})`, data: { orders, sampled: true, checked_at: new Date().toISOString() }, sources: [ASSISTANT_DESTINATIONS.orders, ...orders.slice(0, 3).map((r) => ({ title: r.title || "Review order", href: `/marketplace/orders/${r.id}` }))] };
      }
      case "get_my_order_detail": {
        const orderId = id(args.order_id);
        if (!orderId) return no("Read order detail", "Use an order id returned by get_my_orders.");
        const res = await get(ctx, `/v1/orders/${orderId}`);
        // 403/404 are deliberately indistinguishable here: Hubbie never confirms
        // whether an order id outside the caller's account exists.
        if (!res.ok || !id(res.body.id)) return no("Read order detail", res.status === 401 ? "Your session expired. Sign in again." : "That order could not be read for your account.");
        const r = res.body;
        const order = {
          id: id(r.id), title: str(obj(r.listing).title), status: str(r.status, 40),
          bandwidth_gb: number(r.bandwidth_gb), price_per_gb: number(r.price_per_gb), total_price: number(r.total_price),
          amount_locked_sol: number(r.amount_locked_sol), payment_method: str(r.payment_method, 30),
          escrow_expires_at: unixIso(r.escrow_expires_at), created_at: str(r.created_at, 40), updated_at: str(r.updated_at, 40),
          has_proxy_session: typeof r.session_id === "string" && r.session_id.length > 0,
          bandwidth_used_gb: null,
          usage_note: "Metered usage settles per session and is not stored on the order record, so used/remaining bandwidth cannot be read here.",
        };
        return { ok: true, label: "Read your order detail", data: { order, checked_at: new Date().toISOString() }, sources: [{ title: order.title || "Review order", href: `/marketplace/orders/${order.id}` }, ASSISTANT_DESTINATIONS.connections] };
      }
      case "get_my_wallet": {
        const res = await get(ctx, "/v1/wallet?limit=1");
        if (res.status === 404) return { ok: true, label: "Checked your wallet", data: { wallet_initialized: false, note: "No platform wallet has been initialized for this account yet." }, sources: [ASSISTANT_DESTINATIONS.wallet] };
        const w = obj(res.body.wallet);
        if (!res.ok || !Object.keys(w).length) return no("Read wallet balance", res.status === 401 ? "Your session expired. Sign in again." : "Your wallet balance could not be read.");
        return {
          ok: true, label: "Read your wallet balance",
          data: {
            wallet_initialized: true, balance_sol: number(w.balance_sol), on_chain_sol: number(w.on_chain_sol),
            available_sol: number(w.available_sol), earnings_payable_sol: number(w.earnings_payable_sol),
            solana_network: str(w.solana_network, 20), checked_at: new Date().toISOString(),
            note: "on_chain_sol is null when no external Solana wallet is linked or the chain balance could not be read; never present null as zero.",
          },
          sources: [ASSISTANT_DESTINATIONS.wallet],
        };
      }
      case "get_my_nodes": {
        if (!isProvider(ctx)) return no("Read provider nodes", "Provider access is required. Use the provider application to get started.");
        const res = await get(ctx, "/v1/provider/nodes");
        if (!res.ok || !Array.isArray(res.body.nodes)) return no("Read provider nodes", "Your provider nodes could not be read.");
        const nodes = rows(res.body.nodes).map((r) => ({ id: id(r.id), name: str(r.name), country: str(r.country, 2), status: str(r.status, 40) }));
        return { ok: true, label: `Read your provider nodes (${nodes.length})`, data: { nodes, sampled: true, checked_at: new Date().toISOString() }, sources: [ASSISTANT_DESTINATIONS.nodes, ASSISTANT_DESTINATIONS.listings, ASSISTANT_DESTINATIONS.earnings] };
      }
      case "get_my_earnings": {
        if (!isProvider(ctx)) return no("Read provider earnings", "Provider access is required. Use the provider application to get started.");
        const res = await get(ctx, "/v1/provider/earnings/summary");
        if (!res.ok) return no("Read provider earnings", "Your provider earnings could not be read.");
        const r = res.body;
        return {
          ok: true, label: "Read your provider earnings",
          data: {
            currency: "SOL", total_earned_sol: number(r.total_earned_sol), pending_sol: number(r.pending_sol), paid_sol: number(r.paid_sol),
            payable_sol: number(r.payable_sol), last_7_days_sol: number(r.last_7_days_sol), last_30_days_sol: number(r.last_30_days_sol),
            total_sessions: number(r.total_sessions), total_bandwidth_gb: number(r.total_bandwidth_gb), checked_at: new Date().toISOString(),
          },
          sources: [ASSISTANT_DESTINATIONS.earnings],
        };
      }
      case "check_api_health": {
        const res = await get(ctx, "/health", false);
        return { ok: res.ok, label: res.ok ? "Control API answered" : "Control API check failed", data: { reachable: res.ok, http_status: res.status, proxy_verified: false, note: "Only control API reachability was checked. No gateway traffic or provider was tested." }, sources: [ASSISTANT_DESTINATIONS.connections] };
      }
      case "check_proxy_gateway": {
        const endpoint = gatewayEndpoint();
        const probe = await (ctx.gatewayProbeImpl ?? ((ep: string) => probeGatewayAdmission(ep, { signal: ctx.signal })))(endpoint);
        return {
          ok: probe.reachable && probe.authRequired,
          label: probe.reachable ? (probe.authRequired ? "Proxy gateway answered and requires auth" : "Proxy gateway answered unexpectedly") : "Proxy gateway check failed",
          data: {
            gateway_reachable: probe.reachable, http_status: probe.httpStatus, auth_required: probe.authRequired, elapsed_ms: probe.elapsedMs,
            session_verified: false, provider_verified: false,
            note: "An unauthenticated CONNECT was sent; HTTP 407 means the gateway is up and correctly demands session credentials. This does not test the caller's credentials, any provider, or an exit location. If auth_required is false with a 200 status, the gateway answered without demanding auth, which is unexpected and should be reported to support.",
          },
          sources: [ASSISTANT_DESTINATIONS.connections],
        };
      }
      default: return no("Unsupported action", "This tool is not available. No action was performed.");
    }
  } catch {
    return no("Platform check failed", "The platform API could not be read. No availability, payment, or status conclusion can be drawn.");
  }
}
