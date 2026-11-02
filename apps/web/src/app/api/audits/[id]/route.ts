import type { NextRequest } from "next/server";
import { callAuditor, errorJson, relayJson } from "@/lib/server/auditor";
import { AUDIT_ID_RE, withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

/** One audit, owner-checked by the worker. Another user's audit id answers 404, never 403. */
export function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuditUser(request, async (user) => {
    const { id } = await ctx.params;
    if (!AUDIT_ID_RE.test(id)) return errorJson(404, "not_found", "Audit not found.");
    return relayJson(await callAuditor(user.id, "GET", `/internal/v1/audits/${id}`));
  });
}
