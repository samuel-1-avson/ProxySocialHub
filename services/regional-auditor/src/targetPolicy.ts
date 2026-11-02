// Network and target policy for audits.
//
// Live targets are limited to explicitly configured HTTPS origins. Private,
// loopback, link-local, metadata and IPv4-mapped IPv6 destinations are
// rejected. This module is a first line of defence only: the proxy resolves
// DNS itself, so the gateway/provider destination protections remain the
// authoritative boundary (documented as a residual limitation).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type PolicyResult<T = URL> = { ok: true; url: T } | { ok: false; code: PolicyCode; message: string };

export type PolicyCode =
  | "invalid_url"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "port_not_allowed"
  | "blocked_host"
  | "blocked_ip"
  | "origin_not_authorized"
  | "resolves_to_blocked_ip"
  | "too_many_redirects"
  | "method_not_allowed";

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function parseIPv6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);

  let tailBytes: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  if (lastColon >= 0 && ip.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    tailBytes = v4;
    ip = `${ip.slice(0, lastColon + 1)}0:0`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (tailBytes.length === 4) {
    bytes[12] = tailBytes[0]!;
    bytes[13] = tailBytes[1]!;
    bytes[14] = tailBytes[2]!;
    bytes[15] = tailBytes[3]!;
  }
  return bytes.length === 16 ? bytes : null;
}

function isBlockedIPv4(b: number[]): boolean {
  const [a, c] = [b[0]!, b[1]!];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && c >= 64 && c <= 127) return true; // CGNAT
  if (a === 169 && c === 254) return true; // link-local + cloud metadata
  if (a === 172 && c >= 16 && c <= 31) return true;
  if (a === 192 && c === 168) return true;
  if (a === 192 && c === 0 && b[2] === 0) return true;
  if (a === 192 && c === 0 && b[2] === 2) return true;
  if (a === 198 && (c === 18 || c === 19)) return true;
  if (a === 198 && c === 51 && b[2] === 100) return true;
  if (a === 203 && c === 0 && b[2] === 113) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** True when the address must never be an audit destination. Unparseable input is blocked. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip.startsWith("[") ? ip.slice(1, -1) : ip);
  if (kind === 4) {
    const b = parseIPv4(ip);
    return !b || isBlockedIPv4(b);
  }
  if (kind === 6 || ip.includes(":")) {
    const b = parseIPv6(ip);
    if (!b) return true;
    const allZeroPrefix = (n: number) => b.slice(0, n).every((x) => x === 0);
    if (allZeroPrefix(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
    if (allZeroPrefix(10) && b[10] === 0xff && b[11] === 0xff) return isBlockedIPv4(b.slice(12)); // ::ffff:a.b.c.d
    if (allZeroPrefix(12)) return true; // deprecated IPv4-compatible
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
      return isBlockedIPv4(b.slice(12)); // 64:ff9b::/96 NAT64
    }
    if (b[0] === 0x20 && b[1] === 0x02) return isBlockedIPv4(b.slice(2, 6)); // 6to4
    if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local
    if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
    if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true; // fec0::/10 site-local
    if (b[0] === 0xff) return true; // multicast
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
    if (b[0] === 0x01 && b.slice(1, 8).every((x) => x === 0)) return true; // 100::/64 discard
    return false;
  }
  return true;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".lan", ".intranet", ".corp"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data"]);

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (!host.includes(".") && !host.includes(":")) return true; // single-label names resolve via search domains
  return false;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export interface TargetPolicyOptions {
  /** https origins a live audit may target. */
  allowedOrigins: readonly string[];
  /** Explicit development-only fixture origins (plain http on loopback). Empty outside fixture mode. */
  fixtureOrigins?: readonly string[];
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Validate the user-supplied target URL. */
export function validateTargetUrl(raw: string, options: TargetPolicyOptions): PolicyResult {
  const url = parseUrl(raw);
  if (!url) return { ok: false, code: "invalid_url", message: "Target is not a valid URL." };
  if (url.username || url.password) {
    return { ok: false, code: "credentials_in_url", message: "Target URL must not contain credentials." };
  }

  if (options.fixtureOrigins?.includes(url.origin)) return { ok: true, url };

  if (url.protocol !== "https:") {
    return { ok: false, code: "scheme_not_allowed", message: "Only HTTPS targets are allowed." };
  }
  if (isBlockedHostname(url.hostname)) {
    return { ok: false, code: "blocked_host", message: "That host name is not allowed as an audit target." };
  }
  const bare = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(bare) !== 0 && isBlockedIp(bare)) {
    return { ok: false, code: "blocked_ip", message: "Private, loopback, link-local and metadata addresses are not allowed." };
  }
  if (!options.allowedOrigins.includes(url.origin)) {
    return {
      ok: false,
      code: "origin_not_authorized",
      message: "This origin is not on the authorized list for audits. Ask an operator to add it to AUDITOR_ALLOWED_TARGET_ORIGINS.",
    };
  }
  return { ok: true, url };
}

export interface RequestPolicyContext {
  /** Origins the page may navigate to / load (target origin(s) plus approved subresource origins). */
  allowedOrigins: ReadonlySet<string>;
  fixtureOrigins?: ReadonlySet<string>;
  allowNonReadOnly: boolean;
}

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Per-request decision applied to every request the browser attempts,
 * including redirects, subresources and iframes.
 */
export function evaluateRequest(rawUrl: string, method: string, ctx: RequestPolicyContext): PolicyResult {
  const url = parseUrl(rawUrl);
  if (!url) return { ok: false, code: "invalid_url", message: "unparseable request URL" };
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return { ok: true, url };
  if (url.username || url.password) return { ok: false, code: "credentials_in_url", message: "credentials in URL" };

  if (!ctx.fixtureOrigins?.has(url.origin)) {
    if (url.protocol !== "https:") return { ok: false, code: "scheme_not_allowed", message: `scheme ${url.protocol} not allowed` };
    if (isBlockedHostname(url.hostname)) return { ok: false, code: "blocked_host", message: "blocked host name" };
    const bare = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    if (isIP(bare) !== 0 && isBlockedIp(bare)) return { ok: false, code: "blocked_ip", message: "blocked IP address" };
  }
  if (!ctx.allowedOrigins.has(url.origin) && !ctx.fixtureOrigins?.has(url.origin)) {
    return { ok: false, code: "origin_not_authorized", message: `origin ${url.origin} is not approved for this audit` };
  }
  if (!ctx.allowNonReadOnly && !READ_ONLY_METHODS.has(method.toUpperCase())) {
    return { ok: false, code: "method_not_allowed", message: `${method.toUpperCase()} requests are not allowed (read-only audit)` };
  }
  return { ok: true, url };
}

/**
 * Best-effort local DNS check: refuse a host that resolves to a blocked
 * address. The proxy performs its own resolution, so this cannot be the only
 * control (DNS rebinding and split-horizon answers are not covered).
 */
export async function assertHostResolvesPublic(hostname: string): Promise<PolicyResult<void>> {
  const bare = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (isIP(bare) !== 0) {
    return isBlockedIp(bare) ? { ok: false, code: "blocked_ip", message: "blocked IP address" } : { ok: true, url: undefined };
  }
  try {
    const records = await lookup(bare, { all: true });
    const bad = records.find((r) => isBlockedIp(r.address));
    if (bad) return { ok: false, code: "resolves_to_blocked_ip", message: "Host resolves to a private or reserved address." };
  } catch {
    // Resolution failure locally is not authoritative (the gateway resolves independently).
  }
  return { ok: true, url: undefined };
}
