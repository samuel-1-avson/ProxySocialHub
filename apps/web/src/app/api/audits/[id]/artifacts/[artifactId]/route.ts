import type { NextRequest } from "next/server";
import { callAuditor, errorJson, relayFile } from "@/lib/server/auditor";
import { ARTIFACT_ID_RE, AUDIT_ID_RE, withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

/** A screenshot. Served only through the owner check; there is no public static folder. */
export function GET(request: NextRequest, ctx: { params: Promise<{ id: string; artifactId: string }> }) {
  return withAuditUser(request, async (user) => {
    const { id, artifactId } = await ctx.params;
    if (!AUDIT_ID_RE.test(id) || !ARTIFACT_ID_RE.test(artifactId)) return errorJson(404, "not_found", "Not found.");
    return relayFile(await callAuditor(user.id, "GET", `/internal/v1/audits/${id}/artifacts/${encodeURIComponent(artifactId)}`));
  });
}
