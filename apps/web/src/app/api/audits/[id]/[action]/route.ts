import type { NextRequest } from "next/server";
import { callAuditor, errorJson, relayJson } from "@/lib/server/auditor";
import { prepareLiveSessions, type SessionPick } from "@/lib/server/audit-live-sessions";
import { AUDIT_ID_RE, withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["cancel", "rerun", "replay", "retry-analysis"]);

/**
 * cancel | rerun | replay | retry-analysis
 *  - rerun collects fresh evidence: live audits get new sessions (the old ones are never reused).
 *  - replay and retry-analysis reuse stored evidence and need no session at all.
 */
export function POST(request: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  return withAuditUser(request, async (user) => {
    const { id, action } = await ctx.params;
    if (!AUDIT_ID_RE.test(id) || !ACTIONS.has(action)) return errorJson(404, "not_found", "Not found.");

    if (action !== "rerun") {
      return relayJson(await callAuditor(user.id, "POST", `/internal/v1/audits/${id}/${action}`, {}));
    }

    // Look the audit up first (owner-checked) so a live rerun mints sessions for the same regions.
    const existing = await callAuditor(user.id, "GET", `/internal/v1/audits/${id}`);
    if (!existing.ok) return existing.response;
    if (!existing.response.ok) return relayJson(existing);
    const { audit } = (await existing.response.json()) as {
      audit: { mode: string; request: { regions: string[] }; sessionPlan?: { source?: string; orders?: Record<string, unknown> } | null };
    };
    if (audit.mode !== "live") return relayJson(await callAuditor(user.id, "POST", `/internal/v1/audits/${id}/rerun`, {}));

    // An audit that ran over the user's own orders reruns over the same orders (fresh credentials are
    // fetched, and an order that is no longer active shows up as an unavailable region with the reason).
    const pick: SessionPick =
      audit.sessionPlan?.source === "marketplace_order" && audit.sessionPlan.orders ? { source: "order", orders: audit.sessionPlan.orders } : { source: "intent" };
    const prepared = await prepareLiveSessions(user, audit.request.regions, pick);
    if (!prepared.ok) return prepared.response;
    const { sessions } = prepared;
    return relayJson(
      await callAuditor(user.id, "POST", `/internal/v1/audits/${id}/rerun`, {
        credentials: sessions.credentials,
        unavailable: sessions.unavailable,
        ...(sessions.sessionPlan ? { sessionPlan: sessions.sessionPlan } : {}),
      }),
    );
  });
}
