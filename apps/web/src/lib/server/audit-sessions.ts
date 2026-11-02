// Server-only: obtains per-region ProxyHubb sessions for a live audit.
//
// Sessions are requested through the existing control API (/v1/sessions/intent)
// with the CALLER's own token, so plan limits, entitlements, metering and
// escrow rules apply exactly as they do anywhere else. This module never
// creates a session some other way, never funds anything, and never falls back
// to a different region: a region that cannot get a session is reported as
// unavailable with the control API's own reason.

export interface RegionCredentialPayload {
  sessionRef: string;
  /** Defaults to "session_intent" in the worker when omitted. */
  source?: "session_intent" | "marketplace_order";
  username: string;
  password: string;
  declaredCountry?: string;
  declaredCountrySource?: string;
}

export interface RegionUnavailablePayload {
  code: string;
  message: string;
}

export interface MintedSessions {
  credentials: Record<string, RegionCredentialPayload>;
  unavailable: Record<string, RegionUnavailablePayload>;
}

const CC = /^[A-Z]{2}$/;
/** Intent lifetime for an audit: long enough to finish, short enough to be disposable. */
const INTENT_MINUTES = 20;

export function apiBase(): string {
  return process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:18080";
}

function bandwidthLimitBytes(): number {
  const n = Number(process.env.AUDITOR_REGION_BANDWIDTH_BYTES);
  return Number.isInteger(n) && n >= 5_000_000 ? n : 100 * 1024 * 1024;
}

interface MintResult {
  credential?: RegionCredentialPayload;
  unavailable?: RegionUnavailablePayload;
}

async function mintOne(country: string, bearer: string, allowedDomains: string[]): Promise<MintResult> {
  let res: Response;
  try {
    res = await fetch(new URL("/v1/sessions/intent", apiBase()), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({
        type: "sticky", // one exit for the whole capture, so the before/after egress checks are comparable
        target_geo: country,
        bandwidth_limit: bandwidthLimitBytes(),
        time_limit_minutes: INTENT_MINUTES,
        // Gateway-side allow-list: the only place a redirect hop can be refused BEFORE it connects.
        ...(allowedDomains.length > 0 ? { allowed_domains: allowedDomains } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { unavailable: { code: "control_api_unreachable", message: "The ProxyHubb control API could not be reached to open a session." } };
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = typeof body?.error === "string" ? body.error.slice(0, 200) : undefined;

  if (!res.ok) {
    if (res.status === 429) {
      return { unavailable: { code: "session_limit", message: reason ?? "Your concurrent session limit was reached. End a session or wait, then retry." } };
    }
    if (res.status === 403 && body?.code === "plan_bandwidth_quota") {
      return { unavailable: { code: "plan_bandwidth_quota", message: "Your plan's bandwidth quota is exhausted, so no session could be opened." } };
    }
    if (res.status === 401) return { unavailable: { code: "not_authenticated", message: "Your session expired. Sign in again to run a live audit." } };
    return { unavailable: { code: "session_refused", message: reason ?? `The control API refused to open a session (HTTP ${res.status}).` } };
  }

  // Deployments that require escrow return an intent that is not usable until it is funded.
  // The audit must not bypass that: report the region as unavailable instead.
  if (body?.code === "session_escrow_required") {
    return {
      unavailable: {
        code: "session_escrow_required",
        message:
          "This deployment requires an escrow-funded session before traffic can flow, and the audit does not fund one. Run the audit with \"Use my funded orders\" over an active marketplace order you already paid for.",
      },
    };
  }

  const token = typeof body?.token === "string" ? body.token : null;
  const intent = body?.intent as Record<string, unknown> | undefined;
  const intentId = typeof intent?.intent_id === "string" ? intent.intent_id : null;
  if (!token || !intentId) {
    return { unavailable: { code: "session_unreadable", message: "The control API answered without a usable session." } };
  }
  return { credential: { sessionRef: intentId, username: "session-intent", password: token } };
}

export async function mintRegionSessions(regions: string[], bearer: string, allowedDomains: string[] = []): Promise<MintedSessions> {
  const out: MintedSessions = { credentials: {}, unavailable: {} };
  const unique = [...new Set(regions)];
  const results = await Promise.all(
    unique.map(async (country): Promise<readonly [string, MintResult]> => {
      if (!CC.test(country)) return [country, { unavailable: { code: "invalid_region", message: "Regions must be two-letter country codes." } }];
      return [country, await mintOne(country, bearer, allowedDomains)];
    }),
  );
  for (const [country, r] of results) {
    if (r.credential) out.credentials[country] = r.credential;
    else if (r.unavailable) out.unavailable[country] = r.unavailable;
  }
  return out;
}

/**
 * Opt-in hardening (AUDITOR_RESTRICT_INTENT_DOMAINS=1): bind each session to the hosts the audit may
 * contact, so the gateway can refuse a redirect to anywhere else. Returns undefined when not enabled and
 * null when it is enabled but the host list could not be obtained (callers must then refuse to start).
 * How the gateway matches allowed_domains (exact host vs. suffix) has not been verified against a live
 * gateway, which is why this is off by default.
 */
export async function intentAllowedDomains(
  fetchCapabilities: () => Promise<Response | null>,
): Promise<string[] | undefined | null> {
  if (process.env.AUDITOR_RESTRICT_INTENT_DOMAINS?.trim() !== "1") return undefined;
  try {
    const res = await fetchCapabilities();
    if (!res?.ok) return null;
    const caps = (await res.json()) as { modes?: { live?: { allowedHosts?: unknown } } };
    const hosts = caps.modes?.live?.allowedHosts;
    return Array.isArray(hosts) && hosts.every((h) => typeof h === "string") && hosts.length > 0 ? (hosts as string[]) : null;
  } catch {
    return null;
  }
}
