// Server-only client for the Regional Auditor worker (services/regional-auditor).
//
// The browser never reaches the worker. Route handlers authenticate the user,
// then call the worker with an HMAC-signed request binding the owner id,
// method, path, body hash, timestamp and a one-time nonce. The shared secret
// is read from AUDITOR_SERVICE_SECRET and never leaves the server.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { signAuditorRequest } from "./audit-signature";

export interface AuditorSettings {
  baseUrl: string;
  secret: string;
}

export function auditorSettings(): AuditorSettings | null {
  const secret = process.env.AUDITOR_SERVICE_SECRET?.trim();
  if (!secret) return null;
  const baseUrl = (process.env.AUDITOR_URL?.trim() || "http://127.0.0.1:4021").replace(/\/$/, "");
  return { baseUrl, secret };
}

export function errorJson(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export type AuditorResult = { ok: true; response: Response } | { ok: false; response: NextResponse };

export async function callAuditor(ownerId: string, method: string, pathWithQuery: string, body?: unknown): Promise<AuditorResult> {
  const settings = auditorSettings();
  if (!settings) {
    return {
      ok: false,
      response: errorJson(503, "auditor_not_configured", "The Regional Auditor service is not configured on this server (AUDITOR_SERVICE_SECRET)."),
    };
  }
  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Date.now();
  const nonce = randomBytes(12).toString("hex");
  const signature = signAuditorRequest(settings.secret, { method, pathWithQuery, owner: ownerId, body: payload, timestamp, nonce });
  try {
    const response = await fetch(`${settings.baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-auditor-owner": ownerId,
        "x-auditor-ts": String(timestamp),
        "x-auditor-nonce": nonce,
        "x-auditor-sig": signature,
      },
      body: payload || undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    return { ok: true, response };
  } catch {
    return { ok: false, response: errorJson(503, "auditor_unreachable", "The Regional Auditor service could not be reached. Try again shortly.") };
  }
}

/** Pass a worker JSON answer through to the browser, keeping its status and error shape. */
export async function relayJson(result: AuditorResult): Promise<NextResponse> {
  if (!result.ok) return result.response;
  const text = await result.response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorJson(502, "bad_gateway", "The Regional Auditor service returned an unreadable answer.");
  }
  return NextResponse.json(json, { status: result.response.status, headers: { "cache-control": "no-store" } });
}

/** Stream a worker file (screenshot / export) to the browser without exposing worker headers. */
export async function relayFile(result: AuditorResult): Promise<Response> {
  if (!result.ok) return result.response;
  const res = result.response;
  if (!res.ok) return relayJson({ ok: true, response: res });
  const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
  const type = res.headers.get("content-type");
  const disposition = res.headers.get("content-disposition");
  if (type) headers.set("content-type", type);
  if (disposition) headers.set("content-disposition", disposition);
  // Exports can contain page content; keep them out of any shared caches and sandboxed when opened inline.
  headers.set("content-security-policy", "sandbox; default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'");
  return new Response(res.body, { status: 200, headers });
}
