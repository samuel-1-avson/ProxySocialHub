// Egress evidence and assurance.
//
// Three different things are kept apart and shown with their source:
//   * provider-declared country  - a claim made by the provider/listing
//   * observed egress IP         - measured through the same browser/proxy path
//   * GeoIP country              - an estimate for that IP, not proof of location
// A region is "verified" only when the GeoIP estimate for the observed IP
// matches the requested country and nothing contradicts it.

import { isIP } from "node:net";
import type { AssuranceStatus } from "./contracts.ts";
import { nowIso } from "./util.ts";

export interface GeoIpResult {
  country: string | null;
  source: string;
  lookedUpAt: string | null;
  note: string | null;
  /** The IP's network as the provider names it, e.g. "Google LLC (AS15169)". Null when unknown. */
  network?: string | null;
  /** True when that network is a satellite operator, whose addresses GeoIP cannot place reliably. */
  satellite?: boolean;
}

// Satellite operators assign addresses by ground station or registration, not by where the
// terminal is, so their GeoIP country says nothing about the exit's real location (a Ghana
// Starlink dish has geolocated to the US). Names are the main signal; the ASN list is a small,
// known set (14593 = SpaceX Starlink).
const SATELLITE_NAME = /\b(starlink|spacex|space exploration technologies|viasat|hughes ?net|hughes network|oneweb|inmarsat|project kuiper)\b/i;
const SATELLITE_ASNS = new Set([14593]);

export interface NetworkInfo {
  asn?: number | null;
  isp?: string | null;
  org?: string | null;
}

export function isSatelliteNetwork(info: NetworkInfo | null | undefined): boolean {
  if (!info) return false;
  if (typeof info.asn === "number" && SATELLITE_ASNS.has(info.asn)) return true;
  return [info.isp, info.org].some((name) => typeof name === "string" && SATELLITE_NAME.test(name));
}

export function describeNetwork(info: NetworkInfo | null | undefined): string | null {
  if (!info) return null;
  const name = (info.isp || info.org || "").trim().slice(0, 120);
  const asn = typeof info.asn === "number" ? `AS${info.asn}` : "";
  if (!name && !asn) return null;
  return name && asn ? `${name} (${asn})` : name || asn;
}

export interface GeoIpProvider {
  lookup(ip: string, signal?: AbortSignal): Promise<GeoIpResult>;
}

export class NoGeoIpProvider implements GeoIpProvider {
  async lookup(): Promise<GeoIpResult> {
    return { country: null, source: "none", lookedUpAt: null, note: "GeoIP lookup is disabled (AUDITOR_GEOIP_PROVIDER=none)." };
  }
}

/** Fixed table for the development fixture harness and tests. Always labelled as such. */
export class StaticGeoIpProvider implements GeoIpProvider {
  private readonly table: ReadonlyMap<string, string>;
  private readonly source: string;
  constructor(table: Record<string, string>, source = "fixture-static-table (synthetic, not a real lookup)") {
    this.table = new Map(Object.entries(table));
    this.source = source;
  }
  async lookup(ip: string): Promise<GeoIpResult> {
    const country = this.table.get(ip) ?? null;
    return {
      country,
      source: this.source,
      lookedUpAt: nowIso(),
      note: country ? null : "IP not present in the static table.",
    };
  }
}

/** ipwho.is public endpoint (no key). An estimate; rate limited by the provider. */
export class IpWhoIsProvider implements GeoIpProvider {
  private readonly cache = new Map<string, { at: number; value: GeoIpResult }>();
  private readonly ttlMs = 60 * 60 * 1000;

  async lookup(ip: string, signal?: AbortSignal): Promise<GeoIpResult> {
    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.value;

    const source = "ipwho.is (GeoIP estimate)";
    try {
      const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code,message,connection`, {
        signal: signal ?? AbortSignal.timeout(6000),
        headers: { accept: "application/json" },
      });
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; country_code?: string; message?: string; connection?: NetworkInfo }
        | null;
      let value: GeoIpResult;
      if (res.ok && body?.success && typeof body.country_code === "string" && /^[A-Za-z]{2}$/.test(body.country_code)) {
        value = {
          country: body.country_code.toUpperCase(),
          source,
          lookedUpAt: nowIso(),
          note: null,
          network: describeNetwork(body.connection),
          satellite: isSatelliteNetwork(body.connection),
        };
      } else {
        value = {
          country: null,
          source,
          lookedUpAt: nowIso(),
          note: `Lookup returned no country (HTTP ${res.status}${body?.message ? `: ${String(body.message).slice(0, 80)}` : ""}).`,
        };
      }
      // Only cache definitive answers; transient failures should be retried.
      if (value.country) this.cache.set(ip, { at: Date.now(), value });
      return value;
    } catch (error) {
      return {
        country: null,
        source,
        lookedUpAt: nowIso(),
        note: `Lookup failed: ${error instanceof Error ? error.message.slice(0, 100) : "unknown error"}.`,
      };
    }
  }
}

/** Extract an IP address from an echo service response (JSON or plain text). */
export function parseEchoIp(body: string): string | null {
  const text = body.trim();
  if (!text || text.length > 2000) return null;
  const candidates: string[] = [];
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["ip", "origin", "query", "address", "ipAddress"]) {
      const v = json[key];
      if (typeof v === "string") candidates.push(v);
    }
  } catch {
    candidates.push(text);
  }
  for (const c of candidates) {
    // httpbin's "origin" can be a comma-separated list; the first entry is the client.
    const first = c.split(",")[0]?.trim() ?? "";
    if (isIP(first) !== 0) return first;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Assurance
// ---------------------------------------------------------------------------

const SEVERITY: Record<AssuranceStatus, number> = {
  verified: 0,
  unverified: 1,
  unavailable: 2,
  mismatch: 3,
  direct_egress: 4,
};

export function worseAssurance(a: AssuranceStatus, b: AssuranceStatus): AssuranceStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export interface EgressSample {
  ip: string | null;
  geoip: GeoIpResult | null;
}

export interface AssuranceInput {
  requested: string;
  declaredCountry: string | null;
  samples: EgressSample[];
  /** The worker's own public IP when it could be learned (used to detect proxy bypass). */
  workerDirectIp: string | null;
}

export interface AssuranceResult {
  assurance: AssuranceStatus;
  reason: string;
  matchesWorkerDirectIp: boolean | null;
}

function evaluateSample(input: AssuranceInput, sample: EgressSample): { assurance: AssuranceStatus; reason: string } {
  const { requested, declaredCountry, workerDirectIp } = input;
  if (!sample.ip) {
    return { assurance: "unavailable", reason: "The browser could not observe its egress IP through the proxy." };
  }
  if (workerDirectIp && sample.ip === workerDirectIp) {
    return {
      assurance: "direct_egress",
      reason: "The observed egress IP equals the worker's own direct IP, so traffic did not leave through a regional exit.",
    };
  }
  const country = sample.geoip?.country ?? null;
  if (!country) {
    const why = sample.geoip?.note ? ` ${sample.geoip.note}` : "";
    return {
      assurance: "unverified",
      reason: `The egress IP was observed but its country could not be estimated.${why}`,
    };
  }
  if (country !== requested) {
    return {
      assurance: "mismatch",
      reason: `The observed egress IP geolocates to ${country}, not the requested ${requested}.`,
    };
  }
  if (sample.geoip?.satellite) {
    return {
      assurance: "unverified",
      reason: `The exit is on a satellite network (${sample.geoip.network ?? "unknown operator"}). GeoIP places such addresses by the operator's ground station or registration, not where the terminal is, so the ${country} estimate does not confirm the exit's location.`,
    };
  }
  if (declaredCountry && declaredCountry !== requested) {
    return {
      assurance: "unverified",
      reason: `GeoIP estimates ${country} but the provider declares ${declaredCountry}; the sources conflict.`,
    };
  }
  return {
    assurance: "verified",
    reason: declaredCountry
      ? `GeoIP estimate (${country}) and the provider-declared country agree with the request.`
      : `GeoIP estimate (${country}) matches the request; no provider-declared country was available to compare.`,
  };
}

/**
 * Combine the egress samples taken before and after capture. The result is the
 * worst individual outcome, so a mid-run route change cannot hide a mismatch.
 */
export function evaluateAssurance(input: AssuranceInput): AssuranceResult {
  if (input.samples.length === 0) {
    return { assurance: "unavailable", reason: "No egress observation was made.", matchesWorkerDirectIp: null };
  }
  let worst = evaluateSample(input, input.samples[0]!);
  for (const sample of input.samples.slice(1)) {
    const next = evaluateSample(input, sample);
    if (SEVERITY[next.assurance] > SEVERITY[worst.assurance]) worst = next;
  }
  const ips = new Set(input.samples.map((s) => s.ip).filter((ip): ip is string => !!ip));
  let reason = worst.reason;
  if (ips.size > 1) reason += " The egress IP changed during capture.";
  const matches = input.workerDirectIp ? input.samples.some((s) => s.ip === input.workerDirectIp) : null;
  return { assurance: worst.assurance, reason, matchesWorkerDirectIp: matches };
}

/** Evidence from an unverified or mismatched region must not be interpreted as regional behaviour. */
export function isInterpretable(assurance: AssuranceStatus | null | undefined): boolean {
  return assurance === "verified";
}
