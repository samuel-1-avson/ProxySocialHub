// Redaction for anything that leaves the capture boundary: visible text that
// is sent to the model, evidence stored in reports, exports and logs.

import { truncate } from "./util.ts";

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|credential|api[-_]?key|session[-_]?id|cookie|signature/i;
const SENSITIVE_PARAM = /^(pass(word)?|pwd|secret|token|access_token|id_token|refresh_token|auth|authorization|api[-_]?key|key|sig|signature|session|sid|code|state|jwt)$/i;

const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[private-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[jwt]"],
  [/\bsession-intent[:=][^\s@"']{8,}/gi, "session-intent:[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[aws-key]"],
  [/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g, "[api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[api-key]"],
  [/\b(api[-_]?key|secret|token|password|passwd)\s*[:=]\s*["']?(?!\[redacted\])[^\s"',;&]{6,}/gi, "$1=[redacted]"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[email]"],
  // Card-like digit runs (13-19 digits, optionally separated).
  [/\b(?:\d[ -]?){13,19}\b/g, "[number]"],
  // Long opaque hex / base64-ish blobs.
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$|["'])/g, "[opaque]"],
];

/** Remove credential-shaped material from free text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Also remove exact known secret values (e.g. this run's proxy password, API key). */
export function redactKnown(text: string, secrets: Iterable<string | null | undefined>): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue;
    out = out.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.split(encoded).join("[redacted]");
  }
  return out;
}

/** Visible page text prepared for storage and for the model: normalized, redacted, bounded. */
export function sanitizeVisibleText(text: string, maxChars: number, known: Iterable<string | null | undefined> = []): string {
  const normalized = text.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return truncate(redactKnown(redactSecrets(normalized), known), maxChars);
}

/** Single-line message safe for evidence fields. */
export function sanitizeLine(text: string, maxChars: number, known: Iterable<string | null | undefined> = []): string {
  return truncate(redactKnown(redactSecrets(text.replace(/\s+/g, " ").trim()), known), maxChars);
}

/**
 * URLs recorded as evidence: userinfo and fragment dropped, sensitive query
 * values masked, length bounded. Query keys are kept because they are useful
 * for diagnosing failed requests.
 */
export function sanitizeUrl(raw: string, maxChars = 300): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) ?? "";
      if (SENSITIVE_PARAM.test(key) || value.length > 40) url.searchParams.set(key, "[redacted]");
    }
    return truncate(redactSecrets(url.toString()), maxChars);
  } catch {
    return truncate(redactSecrets(raw), maxChars);
  }
}

/** Deep copy with credential-like keys masked; for logs and error payloads. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return "[truncated]" as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactDeep(v, depth + 1);
    }
    return out as T;
  }
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  return value;
}
