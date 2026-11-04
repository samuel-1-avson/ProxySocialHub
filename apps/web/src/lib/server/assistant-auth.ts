import type { NextRequest } from "next/server";
import { verifyJwt } from "./audit-auth";
import { readAssistantJson } from "./assistant-json";

export interface AssistantUser { id: string; role: string; bearer: string }
type AuthResult = { ok: true; user: AssistantUser } | { ok: false; status: 401 | 503; message: string };
const denied = (): AuthResult => ({ ok: false, status: 401, message: "Sign in to your account to use Hubbie." });

/** Browser sessions only: cookies, scoped node/extension tokens and MFA challenges cannot authorize AI. */
export async function resolveAssistantUser(request: NextRequest, fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<AuthResult> {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(header) || header.length > 8192) return denied();
  const bearer = header.replace(/^Bearer\s+/i, "");
  let claims: Record<string, unknown> | null;
  try {
    const segments = bearer.split(".");
    if (segments.length !== 3) return denied();
    claims = env.JWT_SECRET?.trim() ? verifyJwt(bearer, env.JWT_SECRET.trim()) : JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch { return denied(); }
  const now = Date.now() / 1000;
  if (!claims || typeof claims !== "object" || Array.isArray(claims) || claims.iss !== "proxyhubb-control-api" || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now)) || (claims.knd !== undefined && claims.knd !== "") || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(claims.sub)) return denied();

  // Always validate the live session with the control API, including revocation and current role.
  // JWT signature checks alone cannot observe logout, disabled users, or role changes.
  try {
    const response = await fetchImpl(new URL("/v1/auth/me", env.API_URL || "http://localhost:18080"), {
      method: "GET", headers: { authorization: `Bearer ${bearer}`, accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
    });
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return denied(); }
    if (!response.ok) { await response.body?.cancel(); throw new Error("Session service unavailable"); }
    const me = await readAssistantJson(response, 16 * 1024) as Record<string, unknown> | null;
    if (!me || me.id !== claims.sub || typeof me.role !== "string" || !["buyer", "provider", "both", "admin", "moderator", "superadmin"].includes(me.role)) return denied();
    return { ok: true, user: { id: me.id as string, role: me.role, bearer } };
  } catch {
    return { ok: false, status: 503, message: "Your account session could not be verified. Please try again shortly." };
  }
}
