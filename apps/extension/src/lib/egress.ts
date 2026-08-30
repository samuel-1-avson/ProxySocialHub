/** Public IP parsers for tab-based verify. Do not fetch from the service worker. */

export const VERIFY_PROTOCOL = 'HTTP CONNECT' as const;

export const EGRESS_CHECK_URLS = [
  'https://api.ipify.org?format=text',
  'https://httpbin.org/ip',
] as const;

export type VerifyPhase = 'baseline' | 'connected' | 'disconnected';

export type VerifySnapshot = {
  healthy: boolean;
  ip?: string;
  baselineIp?: string;
  rttMs?: number;
  protocol: typeof VERIFY_PROTOCOL;
  error?: string;
  at: number;
  phase: VerifyPhase;
  source?: string;
  hairpin?: boolean;
};

const IPV4 = /(?:\d{1,3}\.){3}\d{1,3}/;
const IPV6 = /(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}/i;

export function normalizeIp(value: string): string | null {
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  if (!trimmed) {
    return null;
  }
  if (trimmed === '127.0.0.1' || trimmed === '::1' || trimmed === '0.0.0.0' || trimmed === '::') {
    return null;
  }
  if (IPV4.test(trimmed) && trimmed.includes('.') && !trimmed.includes(':')) {
    const parts = trimmed.split('.');
    if (parts.length === 4 && parts.every((p) => Number(p) >= 0 && Number(p) <= 255)) {
      return trimmed;
    }
    return null;
  }
  if (trimmed.includes(':') && IPV6.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

export function parseEgressIp(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as { ip?: unknown; origin?: unknown };
    if (typeof parsed.ip === 'string') {
      return normalizeIp(parsed.ip);
    }
    if (typeof parsed.origin === 'string') {
      return normalizeIp(parsed.origin.split(',')[0] ?? '');
    }
  } catch {
    // plain text
  }
  const firstLine = trimmed.split(/\r?\n/)[0] ?? '';
  const direct = normalizeIp(firstLine);
  if (direct) {
    return direct;
  }
  const v4 = trimmed.match(IPV4);
  if (v4) {
    return normalizeIp(v4[0]);
  }
  const v6 = trimmed.match(IPV6);
  if (v6) {
    return normalizeIp(v6[0]);
  }
  return null;
}

export function ipsEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const left = normalizeIp(a);
  const right = normalizeIp(b);
  return Boolean(left && right && left === right);
}

/** True when the post-connect IP is a distinct public address from the DIRECT baseline. */
export function egressLooksProxied(baselineIp: string | undefined, currentIp: string | undefined): boolean {
  if (!currentIp || !normalizeIp(currentIp)) {
    return false;
  }
  if (!baselineIp) {
    return true;
  }
  return !ipsEqual(baselineIp, currentIp);
}

/** CONNECT reached a public IP. Same as home is OK when this machine is also the provider. */
export function egressProbeSucceeded(currentIp: string | undefined): boolean {
  return Boolean(currentIp && normalizeIp(currentIp));
}

export function egressIsLocalHairpin(baselineIp: string | undefined, currentIp: string | undefined): boolean {
  return Boolean(baselineIp && currentIp && ipsEqual(baselineIp, currentIp));
}
