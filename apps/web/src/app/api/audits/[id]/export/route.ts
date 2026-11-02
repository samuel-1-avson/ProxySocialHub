import type { NextRequest } from "next/server";
import { callAuditor, errorJson, relayFile } from "@/lib/server/auditor";
import { AUDIT_ID_RE, withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

/** Sanitized export (?format=json|html). Public sharing is intentionally not offered: exports stay behind ownership. */
export function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withAuditUser(request, async (user) => {
    const { id } = await ctx.params;
    if (!AUDIT_ID_RE.test(id)) return errorJson(404, "not_found", "Not found.");
    const format = new URL(request.url).searchParams.get("format") === "html" ? "html" : "json";
    return relayFile(await callAuditor(user.id, "GET", `/internal/v1/audits/${id}/export?format=${format}`));
  });
}
