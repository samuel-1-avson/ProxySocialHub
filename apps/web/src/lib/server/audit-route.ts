// Server-only helpers shared by the /api/audits route handlers.

import type { NextRequest } from "next/server";
import { resolveAuditUser, type AuditUser } from "./audit-auth";
import { errorJson } from "./auditor";

export const AUDIT_ID_RE = /^aud_[0-9a-f]{12}$/;
export const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Authenticate the caller. Anything that changes state must carry the bearer
 * token in a header (a cookie alone is not enough, so another site cannot make
 * the browser start an audit on the user's behalf) and must come from this origin.
 */
export async function withAuditUser(
  request: NextRequest,
  handler: (user: AuditUser) => Promise<Response>,
  signInMessage = "Sign in to use audits.",
): Promise<Response> {
  const mutating = !["GET", "HEAD"].includes(request.method.toUpperCase());
  if (mutating) {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
      if (!originHost || originHost !== host) return errorJson(403, "cross_origin", "Cross-origin requests are not allowed.");
    }
    if (!request.headers.get("authorization")?.toLowerCase().startsWith("bearer ")) {
      return errorJson(401, "unauthorized", signInMessage);
    }
  }
  const user = await resolveAuditUser(request);
  if (!user) return errorJson(401, "unauthorized", signInMessage);
  return handler(user);
}

export async function readJsonBody(request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return { ok: false, response: errorJson(413, "payload_too_large", "Request body is too large.") };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: errorJson(413, "payload_too_large", "Request body is too large.") };
  if (!text) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: errorJson(400, "invalid_json", "Request body is not valid JSON.") };
  }
}
