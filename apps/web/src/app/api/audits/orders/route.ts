import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { listUsableOrders } from "@/lib/server/audit-orders";
import { apiBase } from "@/lib/server/audit-sessions";
import { errorJson } from "@/lib/server/auditor";
import { withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's ACTIVE marketplace orders, reduced to what a region picker needs. The listing's
 * country is the seller's claim: it narrows the choice, it does not prove where the exit is. No credentials,
 * wallet, seller or price information is returned.
 */
export function GET(request: NextRequest) {
  return withAuditUser(request, async (user) => {
    const result = await listUsableOrders({ base: apiBase(), bearer: user.bearer });
    if (!result.ok) return errorJson(result.status, result.code, result.message);
    // Counts only (no ids, titles or credentials), so an operator can see why a user has nothing to audit through.
    console.info(
      `[audits] orders for ${user.id.slice(0, 8)}: ${result.orders.length} active (${result.orders.filter((o) => o.country).length} with a declared country); not active: ${JSON.stringify(result.otherStatuses)}`,
    );
    return NextResponse.json(
      { orders: result.orders, otherStatuses: result.otherStatuses, source: "Your active ProxyHubb marketplace orders" },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
