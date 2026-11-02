// Authentication between the web server and this worker.
//
// The browser never talks to this service. The web server authenticates the
// end user through the existing control API session, then calls here with an
// HMAC-signed request that binds the owner id, method, path, body hash,
// timestamp and a one-time nonce. A leaked request cannot be replayed on a
// different path or after the freshness window, and the shared secret never
// leaves the two servers.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_HEADERS = {
  owner: "x-auditor-owner",
  timestamp: "x-auditor-ts",
  nonce: "x-auditor-nonce",
  signature: "x-auditor-sig",
} as const;

export const OWNER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_SKEW_MS = 60_000;

export interface SigningInput {
  method: string;
  /** Path including the query string, exactly as sent. */
  pathWithQuery: string;
  owner: string;
  body: Buffer | string;
  timestamp: number;
  nonce: string;
}

export function signRequest(secret: string, input: SigningInput): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const payload = [input.timestamp, input.nonce, input.method.toUpperCase(), input.pathWithQuery, input.owner, bodyHash].join("\n");
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export class NonceCache {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  constructor(ttlMs = MAX_SKEW_MS * 2) {
    this.ttlMs = ttlMs;
  }

  /** Returns false when the nonce was already used. */
  claim(nonce: string, now = Date.now()): boolean {
    for (const [key, at] of this.seen) {
      if (now - at > this.ttlMs) this.seen.delete(key);
      else break; // Map preserves insertion order, so the rest are newer.
    }
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}

export type AuthResult = { ok: true; ownerId: string } | { ok: false; reason: string };

export function verifyRequest(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  method: string,
  pathWithQuery: string,
  body: Buffer,
  nonces: NonceCache,
  now = Date.now(),
): AuthResult {
  const one = (name: string) => {
    const v = headers[name];
    return typeof v === "string" ? v : undefined;
  };
  const owner = one(AUTH_HEADERS.owner);
  const ts = Number(one(AUTH_HEADERS.timestamp));
  const nonce = one(AUTH_HEADERS.nonce);
  const sig = one(AUTH_HEADERS.signature);
  if (!owner || !nonce || !sig || !Number.isFinite(ts)) return { ok: false, reason: "missing signature headers" };
  if (!OWNER_ID_RE.test(owner)) return { ok: false, reason: "invalid owner" };
  if (nonce.length < 12 || nonce.length > 80) return { ok: false, reason: "invalid nonce" };
  if (Math.abs(now - ts) > MAX_SKEW_MS) return { ok: false, reason: "stale request" };

  const expected = signRequest(secret, { method, pathWithQuery, owner, body, timestamp: ts, nonce });
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(sig, "hex");
  } catch {
    return { ok: false, reason: "bad signature" };
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  // Only claim the nonce after the signature is valid, so unauthenticated callers cannot exhaust the cache.
  if (!nonces.claim(nonce, now)) return { ok: false, reason: "replayed request" };
  return { ok: true, ownerId: owner };
}
