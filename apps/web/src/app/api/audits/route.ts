import type { NextRequest } from "next/server";
import { callAuditor, errorJson, relayJson } from "@/lib/server/auditor";
import { prepareLiveSessions, type SessionPick } from "@/lib/server/audit-live-sessions";
import { readJsonBody, withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

/** List the signed-in user's audits (newest first). */
export function GET(request: NextRequest) {
  return withAuditUser(request, async (user) => {
    const limit = new URL(request.url).searchParams.get("limit");
    const query = limit && /^\d{1,3}$/.test(limit) ? `?limit=${limit}` : "";
    return relayJson(await callAuditor(user.id, "GET", `/internal/v1/audits${query}`));
  });
}

/** Start an audit. Live audits obtain one ProxyHubb session per region on the caller's behalf. */
export function POST(request: NextRequest) {
  return withAuditUser(request, async (user) => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const input = parsed.body as { targetUrl?: unknown; regions?: unknown; expectations?: unknown; mode?: unknown; sessionSource?: unknown; orders?: unknown } | null;
    if (!input || typeof input !== "object") return errorJson(400, "invalid_request", "A request body is required.");
    const { targetUrl, regions, expectations, mode } = input;
    if (typeof targetUrl !== "string" || typeof expectations !== "string" || !Array.isArray(regions) || (mode !== "live" && mode !== "fixture")) {
      return errorJson(400, "invalid_request", "targetUrl, regions, expectations and mode (live or fixture) are required.");
    }
    if (input.sessionSource !== undefined && input.sessionSource !== "intent" && input.sessionSource !== "order") {
      return errorJson(400, "invalid_request", 'sessionSource must be "intent" or "order".');
    }
    const countries = regions.filter((r): r is string => typeof r === "string").map((r) => r.trim().toUpperCase());
    const request_ = { targetUrl: targetUrl.trim(), regions: countries, expectations: expectations.trim(), mode };

    if (mode === "fixture") {
      if (input.sessionSource === "order") return errorJson(400, "invalid_request", "Marketplace orders can only be used for live audits.");
      return relayJson(await callAuditor(user.id, "POST", "/internal/v1/audits", { request: request_ }));
    }
    // Live: one set of credentials per requested region, either from sessions opened with the caller's own
    // token or from orders they already paid for. A region without any is recorded as unavailable; nothing
    // is substituted.
    let pick: SessionPick = { source: "intent" };
    if (input.sessionSource === "order") {
      const orders = input.orders;
      if (!orders || typeof orders !== "object" || Array.isArray(orders) || Object.keys(orders).length > 8) {
        return errorJson(400, "invalid_request", "orders must map each region to one of your order ids.");
      }
      pick = { source: "order", orders: orders as Record<string, unknown> };
    }
    const prepared = await prepareLiveSessions(user, countries, pick);
    if (!prepared.ok) return prepared.response;
    const { sessions } = prepared;
    return relayJson(
      await callAuditor(user.id, "POST", "/internal/v1/audits", {
        request: request_,
        credentials: sessions.credentials,
        unavailable: sessions.unavailable,
        ...(sessions.sessionPlan ? { sessionPlan: sessions.sessionPlan } : {}),
      }),
    );
  });
}
