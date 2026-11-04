// Server-side allowlist. No arbitrary URL, SQL, credential, or mutation tool is exposed.
import { ASSISTANT_DESTINATIONS, redactAssistantSecrets, searchAssistantGuides, type AssistantSource } from "../assistant";

export interface AssistantToolContext {
  bearer: string;
  role?: string;
  apiBase: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
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
  { type: "function", name: "get_my_nodes", description: "Read up to ten provider nodes owned by the signed-in caller. Provider role required. Does not reveal private IPs or node keys.", strict: true, parameters: schema({}) },
  { type: "function", name: "check_api_health", description: "Check control API reachability. This is NOT an end-to-end proxy, provider, uptime, or regional exit test.", strict: true, parameters: schema({}) },
  { type: "function", name: "suggest_page", description: "Offer a reviewed link to a ProxyHubb workflow. This prepares a next step; it does not navigate, spend funds, or change anything.", strict: true, parameters: schema({ destination: { type: "string", enum: Object.keys(ASSISTANT_DESTINATIONS) } }) },
] as const;

const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown, max = 160): string | null => typeof v === "string" ? redactAssistantSecrets(v.slice(0, max)) : null;
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const id = (v: unknown): string | null => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v) ? v : null;
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.slice(0, 10).map(obj) : [];
const no = (label: string, error: string): AssistantToolResult => ({ ok: false, label, data: { error }, sources: [] });

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
      case "suggest_page": {
        if (typeof args.destination !== "string" || !Object.hasOwn(ASSISTANT_DESTINATIONS, args.destination)) return no("Prepare next step", "Unknown destination.");
        const source = ASSISTANT_DESTINATIONS[args.destination as keyof typeof ASSISTANT_DESTINATIONS];
        return { ok: true, label: "Prepared a next step", data: { ...source, action: "Link only. The user must open and review this workflow." }, sources: [source] };
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
        const orders = rows(res.body.orders).filter((r) => id(r.id)).map((r) => ({ id: id(r.id), title: str(obj(r.listing).title), status: str(r.status, 40), bandwidth_gb: number(r.bandwidth_gb), created_at: str(r.created_at, 40), escrow_status: str(r.escrow_status, 40) }));
        return { ok: true, label: `Read your recent orders (${orders.length})`, data: { orders, sampled: true, checked_at: new Date().toISOString() }, sources: [ASSISTANT_DESTINATIONS.orders, ...orders.slice(0, 3).map((r) => ({ title: r.title || "Review order", href: `/marketplace/orders/${r.id}` }))] };
      }
      case "get_my_nodes": {
        if (!["provider", "both", "admin"].includes(ctx.role || "")) return no("Read provider nodes", "Provider access is required. Use the provider application to get started.");
        const res = await get(ctx, "/v1/provider/nodes");
        if (!res.ok || !Array.isArray(res.body.nodes)) return no("Read provider nodes", "Your provider nodes could not be read.");
        const nodes = rows(res.body.nodes).map((r) => ({ id: id(r.id), name: str(r.name), country: str(r.country, 2), status: str(r.status, 40) }));
        return { ok: true, label: `Read your provider nodes (${nodes.length})`, data: { nodes, sampled: true, checked_at: new Date().toISOString() }, sources: [ASSISTANT_DESTINATIONS.nodes] };
      }
      case "check_api_health": {
        const res = await get(ctx, "/health", false);
        return { ok: res.ok, label: res.ok ? "Control API answered" : "Control API check failed", data: { reachable: res.ok, http_status: res.status, proxy_verified: false, note: "Only control API reachability was checked. No gateway traffic or provider was tested." }, sources: [ASSISTANT_DESTINATIONS.connections] };
      }
      default: return no("Unsupported action", "This tool is not available. No action was performed.");
    }
  } catch {
    return no("Platform check failed", "The platform API could not be read. No availability, payment, or status conclusion can be drawn.");
  }
}
