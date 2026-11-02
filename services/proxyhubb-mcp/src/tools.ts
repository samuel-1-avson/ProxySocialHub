// Agent-facing tools over the ProxyHubb control API. Handlers are plain
// functions (transport-free) so they can be unit-tested without MCP; the
// server (server.ts) only registers them with zod schemas.
//
// Safety defaults are the point: every created session is disposable by
// default (100 MB, 20 minutes — mirroring the Regional Auditor's minting),
// price/domain caps pass straight into the signed session intent, and a
// deployment that requires escrow funding is reported, never bypassed.

import type { ProxyHubbConfig } from "./config.ts";
import { sessionIntentProxyUrl } from "./config.ts";
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

  return { listRegions, discoverListings, createAgentSession, verifyExit, getSessionUsage, closeAgentSession };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;
