// Thin client for the existing ProxyHubb control API (/v1). This MCP server
// wraps the public contract only: session intents, listings/facets, usage and
// session termination. It never funds escrow and never bypasses plan limits —
// a deployment that answers `session_escrow_required` is surfaced as-is.

import type { ProxyHubbConfig } from "./config.ts";

export type FetchFn = typeof fetch;

export class ProxyHubbApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(`ProxyHubb API error ${status}: ${message}`);
    this.name = "ProxyHubbApiError";
    this.status = status;
    this.code = code;
  }
}

export interface CreateIntentPayload {
  type: "rotating" | "sticky";
  target_geo?: string;
  target_isp?: string;
  listing_id?: string;
  bandwidth_limit: number; // bytes
  time_limit_minutes: number;
  rotation_type?: "none" | "per-request" | "time-based";
  rotation_interval_seconds?: number;
  max_price_per_gb?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export class ProxyHubbClient {
  readonly #cfg: ProxyHubbConfig;
  readonly #fetch: FetchFn;

  constructor(cfg: ProxyHubbConfig, fetchFn: FetchFn = fetch) {
    this.#cfg = cfg;
    this.#fetch = fetchFn;
  }

  get hasAccessToken(): boolean {
    return this.#cfg.accessToken.length > 0;
  }

  async #request(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    if (this.#cfg.apiKey) headers["x-api-key"] = this.#cfg.apiKey;
    if (this.#cfg.accessToken) headers.authorization = `Bearer ${this.#cfg.accessToken}`;

    let res: Response;
    try {
      res = await this.#fetch(new URL(path, `${this.#cfg.baseUrl.replace(/\/$/, "")}/`), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#cfg.requestTimeoutMs),
      });
    } catch (err) {
      throw new ProxyHubbApiError(0, `control API unreachable (${err instanceof Error ? err.message : "unknown error"})`);
    }
    if (res.status === 204) return null;
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const rec = (data ?? {}) as Record<string, unknown>;
      const message = typeof rec.error === "string" ? rec.error.slice(0, 300) : res.statusText;
      throw new ProxyHubbApiError(res.status, message, typeof rec.code === "string" ? rec.code : null);
    }
    return data;
  }

  /** GET /v1/listings/facets — countries / proxy types / ISPs / price buckets with listing counts. */
  getListingFacets(): Promise<unknown> {
    return this.#request("GET", "/v1/listings/facets");
  }

  /** GET /v1/listings with the filters the API documents (country, proxy_type, q). */
  searchListings(filters: { country?: string; proxy_type?: string; q?: string }): Promise<unknown> {
    const params = new URLSearchParams();
    if (filters.country) params.set("country", filters.country);
    if (filters.proxy_type) params.set("proxy_type", filters.proxy_type);
    if (filters.q) params.set("q", filters.q);
    const qs = params.toString();
    return this.#request("GET", `/v1/listings${qs ? `?${qs}` : ""}`);
  }

  /** POST /v1/sessions/intent — requires the account JWT. Returns the raw API body. */
  createSessionIntent(payload: CreateIntentPayload): Promise<unknown> {
    return this.#request("POST", "/v1/sessions/intent", payload);
  }

  /** GET /v1/sessions/intents/:id */
  getSessionIntent(intentId: string): Promise<unknown> {
    return this.#request("GET", `/v1/sessions/intents/${encodeURIComponent(intentId)}`);
  }

  /** GET /v1/usage/session/:session_id */
  getSessionUsage(sessionId: string): Promise<unknown> {
    return this.#request("GET", `/v1/usage/session/${encodeURIComponent(sessionId)}`);
  }

  /** GET /v1/usage/me */
  getMyUsage(): Promise<unknown> {
    return this.#request("GET", "/v1/usage/me");
  }

  /** POST /v1/sessions/:id/terminate — real sessions only; intents expire (see tools). */
  terminateSession(sessionId: string): Promise<unknown> {
    return this.#request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/terminate`);
  }
}
