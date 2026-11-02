import type { NextRequest } from "next/server";
import { callAuditor, errorJson, relayJson } from "@/lib/server/auditor";
import { readJsonBody, withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

/**
 * Development fixture harness only: GET lists the controlled demo site's
 * versions, POST switches it (for example v1 with seeded defects -> v2 fixed).
 * The worker answers 404 unless the harness is enabled, and it can never
 * be enabled in production.
 */
export function GET(request: NextRequest) {
  return withAuditUser(request, async (user) => relayJson(await callAuditor(user.id, "GET", "/internal/v1/fixture/scenarios")));
}

export function POST(request: NextRequest) {
  return withAuditUser(request, async (user) => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const id = (parsed.body as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) return errorJson(400, "invalid_request", "A scenario id is required.");
    return relayJson(await callAuditor(user.id, "POST", "/internal/v1/fixture/scenario", { id }));
  });
}
