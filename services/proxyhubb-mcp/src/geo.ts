// Egress assurance, mirroring the Regional Auditor's contract
// (services/regional-auditor/src/geo.ts): three different things are kept
// apart — the requested country, the OBSERVED egress IP (measured through
// the proxy), and a GeoIP ESTIMATE for that IP (never proof of location).
// A session is "verified" only when the estimate matches the request.
// Silence is never treated as a match, so a gateway fallback to another
// country shows up as "mismatch" instead of a false success.

export type AssuranceStatus = "verified" | "unverified" | "mismatch" | "direct_egress" | "unavailable";

export interface GeoIpResult {
  country: string | null;
  source: string;
  lookedUpAt: string | null;
  note: string | null;
  /** The IP's network ("Google LLC (AS15169)"), when the lookup returned one. */
  network?: string | null;
  /** A satellite operator: its GeoIP country cannot confirm where the exit is. */
  satellite?: boolean;
}

// Same rule as the auditor: satellite operators assign addresses by ground station or
// registration, so a Ghana Starlink dish can geolocate to the US. 14593 = SpaceX Starlink.
const SATELLITE_NAME = /\b(starlink|spacex|space exploration technologies|viasat|hughes ?net|hughes network|oneweb|inmarsat|project kuiper)\b/i;
const SATELLITE_ASNS = new Set([14593]);

interface NetworkInfo {
  asn?: number | null;
  isp?: string | null;
  org?: string | null;
}

export function isSatelliteNetwork(info: NetworkInfo | null | undefined): boolean {
  if (!info) return false;
  if (typeof info.asn === "number" && SATELLITE_ASNS.has(info.asn)) return true;
  return [info.isp, info.org].some((name) => typeof name === "string" && SATELLITE_NAME.test(name));
}

function describeNetwork(info: NetworkInfo | null | undefined): string | null {
  if (!info) return null;
  const name = (info.isp || info.org || "").trim().slice(0, 120);
  const asn = typeof info.asn === "number" ? `AS${info.asn}` : "";
  if (!name && !asn) return null;
  return name && asn ? `${name} (${asn})` : name || asn;
}

export type GeoLookup = (ip: string) => Promise<GeoIpResult>;

/** ipwho.is public endpoint (no key). An estimate; definitive answers cached 1h. */
export function createIpWhoIsLookup(fetchFn: typeof fetch = fetch): GeoLookup {
  const cache = new Map<string, { at: number; value: GeoIpResult }>();
  return async (ip) => {
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
    const source = "ipwho.is (GeoIP estimate)";
    try {
      const res = await fetchFn(
        `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,message,connection`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) },
      );
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; country_code?: string; message?: string; connection?: NetworkInfo }
        | null;
      let value: GeoIpResult;
      if (res.ok && body?.success && typeof body.country_code === "string" && /^[A-Za-z]{2}$/.test(body.country_code)) {
        value = {
          country: body.country_code.toUpperCase(),
          source,
          lookedUpAt: new Date().toISOString(),
          note: null,
          network: describeNetwork(body.connection),
          satellite: isSatelliteNetwork(body.connection),
        };
      } else {
        value = {
          country: null,
          source,
          lookedUpAt: new Date().toISOString(),
          note: `Lookup returned no country (HTTP ${res.status}).`,
        };
      }
      if (value.country) cache.set(ip, { at: Date.now(), value });
      return value;
    } catch (err) {
      return {
        country: null,
        source,
        lookedUpAt: new Date().toISOString(),
        note: `Lookup failed: ${err instanceof Error ? err.message.slice(0, 100) : "unknown error"}.`,
      };
    }
  };
}

export interface AssuranceResult {
  assurance: AssuranceStatus;
  reason: string;
}

export function evaluateAssurance(input: {
  requestedCountry: string;
  observedIp: string | null;
  geoip: GeoIpResult | null;
  /** This process's own direct egress IP, when learnable — detects proxy bypass. */
  ownDirectIp?: string | null;
}): AssuranceResult {
  const requested = input.requestedCountry.toUpperCase();
  if (!input.observedIp) {
    return { assurance: "unavailable", reason: "No egress IP could be observed through the proxy." };
  }
  if (input.ownDirectIp && input.observedIp === input.ownDirectIp) {
    return {
      assurance: "direct_egress",
      reason:
        "The observed egress IP equals this machine's own direct IP. Either traffic bypassed the regional exit, or the exit node is on this machine's own internet connection (for example your own node on your own line); from here the two look the same, so the exit is not trusted. If this IP is your connection's, run the node and this agent on different connections.",
    };
  }
  const country = input.geoip?.country ?? null;
  if (!country) {
    return {
      assurance: "unverified",
      reason: `Egress IP observed, but its country could not be estimated.${input.geoip?.note ? ` ${input.geoip.note}` : ""}`,
    };
  }
  if (country !== requested) {
    return {
      assurance: "mismatch",
      reason: `Observed egress IP geolocates to ${country}, not the requested ${requested}. Do not interpret results as ${requested} behaviour.`,
    };
  }
  if (input.geoip?.satellite) {
    return {
      assurance: "unverified",
      reason: `The exit is on a satellite network (${input.geoip.network ?? "unknown operator"}). GeoIP places such addresses by the operator's ground station or registration, so the ${country} estimate does not confirm where the exit is.`,
    };
  }
  return { assurance: "verified", reason: `GeoIP estimate (${country}) matches the requested country.` };
}
