// Server-only: decides where a live audit's per-region credentials come from, for a new audit and for a rerun.
//
//  - "intent": open one session intent per region with the caller's own token (audit-sessions.ts)
//  - "order":  use marketplace orders the caller already paid for (audit-orders.ts)
//
// Either way nothing is created or funded on the user's behalf beyond the intent request, and a region
// that cannot get credentials is reported as unavailable instead of being replaced by another route.

import type { AuditUser } from "./audit-auth";
import { resolveOrderSessions, type SessionPlanPayload } from "./audit-orders";
import { apiBase, intentAllowedDomains, mintRegionSessions, type MintedSessions } from "./audit-sessions";
import { callAuditor, errorJson } from "./auditor";

export type SessionPick = { source: "intent" } | { source: "order"; orders: Record<string, unknown> };

export interface PreparedSessions extends MintedSessions {
  sessionPlan?: SessionPlanPayload;
}

export async function prepareLiveSessions(
  user: AuditUser,
  regions: string[],
  pick: SessionPick,
): Promise<{ ok: true; sessions: PreparedSessions } | { ok: false; response: Response }> {
  if (pick.source === "order") {
    // Gateway-side host restriction can only be bound to a session intent, never to an existing order.
    if (process.env.AUDITOR_RESTRICT_INTENT_DOMAINS?.trim() === "1") {
      return {
        ok: false,
        response: errorJson(
          409,
          "orders_cannot_restrict_domains",
          "AUDITOR_RESTRICT_INTENT_DOMAINS is on, but a marketplace order cannot be limited to the approved hosts. Turn it off to use orders, or let the audit open sessions.",
        ),
      };
    }
    const caps = await callAuditor(user.id, "GET", "/internal/v1/capabilities");
    const body = caps.ok && caps.response.ok ? ((await caps.response.json().catch(() => null)) as { modes?: { live?: { proxyEndpoint?: unknown } } } | null) : null;
    const endpoint = body?.modes?.live?.proxyEndpoint;
    const s = await resolveOrderSessions(regions, pick.orders, { base: apiBase(), bearer: user.bearer }, typeof endpoint === "string" ? endpoint : null);
    return { ok: true, sessions: { credentials: s.credentials, unavailable: s.unavailable, ...(s.sessionPlan ? { sessionPlan: s.sessionPlan } : {}) } };
  }

  const domains = await intentAllowedDomains(async () => {
    const caps = await callAuditor(user.id, "GET", "/internal/v1/capabilities");
    return caps.ok ? caps.response : null;
  });
  if (domains === null) {
    return {
      ok: false,
      response: errorJson(503, "allowed_domains_unavailable", "AUDITOR_RESTRICT_INTENT_DOMAINS is on but the approved host list could not be read from the auditor, so no session was opened."),
    };
  }
  return { ok: true, sessions: await mintRegionSessions(regions, user.bearer, domains ?? []) };
}
