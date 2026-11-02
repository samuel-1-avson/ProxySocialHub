// Server-only: resolves the signed-in user for Regional Auditor route handlers.
//
// Mirrors src/middleware.ts so the audit API has exactly the same trust model
// as the pages: when JWT_SECRET is configured the token is verified locally,
// otherwise the control API is asked (/v1/auth/me). API routes are excluded
// from the middleware matcher, so every handler must call this itself.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const ACCESS_COOKIE = "proxyhubb_token";
const ISSUER = "proxyhubb-control-api";
/** Must match the auditor's OWNER_ID_RE. */
const OWNER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export interface AuditUser {
  id: string;
  role: string | undefined;
  /** The caller's own bearer token, used only to ask the control API for sessions on their behalf. */
  bearer: string;
}

function bearerFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return request.cookies.get(ACCESS_COOKIE)?.value?.trim() || null;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Exported for tests. */
export function verifyJwt(token: string, secret: string, now = Date.now()): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodeSegment(h);
  const payload = decodeSegment(p);
  if (!header || !payload || header.alg !== "HS256") return null;
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(s, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (typeof payload.iss === "string" && payload.iss !== ISSUER) return null;
  if (typeof payload.exp === "number" && now >= payload.exp * 1000) return null;
  return payload;
}

function idFrom(claims: Record<string, unknown>): string | null {
  for (const key of ["sub", "user_id", "id"]) {
    const v = claims[key];
    if (typeof v === "string" && OWNER_ID_RE.test(v)) return v;
  }
  return null;
}

export async function resolveAuditUser(request: NextRequest): Promise<AuditUser | null> {
  const bearer = bearerFrom(request);
  if (!bearer) return null;

  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    const claims = verifyJwt(bearer, secret);
    const id = claims ? idFrom(claims) : null;
    if (!claims || !id) return null;
    return { id, role: typeof claims.role === "string" ? claims.role : undefined, bearer };
  }

  const apiBase = process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:18080";
  try {
    const res = await fetch(new URL("/v1/auth/me", apiBase), {
      headers: { authorization: `Bearer ${bearer}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const me = (await res.json()) as Record<string, unknown>;
    const id = idFrom(me);
    if (!id) return null;
    return { id, role: typeof me.role === "string" ? me.role : undefined, bearer };
  } catch {
    return null;
  }
}
