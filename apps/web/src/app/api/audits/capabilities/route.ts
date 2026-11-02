import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { callAuditor } from "@/lib/server/auditor";
import { withAuditUser } from "@/lib/server/audit-route";

export const dynamic = "force-dynamic";

interface FacetBucket {
  value: string;
  count: number;
}

/**
 * What can this server do right now? Combines the worker's own capabilities
 * with the countries that active marketplace listings declare. Listing-declared
 * countries are provider claims: they say where supply is advertised, not that
 * a verified exit exists. The audit itself verifies each exit.
 */
export function GET(request: NextRequest) {
  return withAuditUser(request, async (user) => {
    const [auditor, regions] = await Promise.all([callAuditor(user.id, "GET", "/internal/v1/capabilities"), listingRegions()]);
    let capabilities: unknown = null;
    let auditorProblem: { code: string; message: string } | null = null;
    if (auditor.ok && auditor.response.ok) {
      capabilities = await auditor.response.json().catch(() => null);
    } else if (auditor.ok) {
      auditorProblem = { code: "auditor_error", message: `The Regional Auditor service answered HTTP ${auditor.response.status}.` };
    } else {
      const body = (await auditor.response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      auditorProblem = body?.error ?? { code: "auditor_unreachable", message: "The Regional Auditor service could not be reached." };
    }
    return NextResponse.json({ auditor: capabilities, auditorProblem, listingRegions: regions }, { headers: { "cache-control": "no-store" } });
  });
}

async function listingRegions(): Promise<{ available: boolean; regions: Array<{ code: string; listings: number }>; source: string; message?: string }> {
  const base = process.env.API_URL?.trim() || process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:18080";
  const source = "Active marketplace listings (provider-declared countries)";
  try {
    const res = await fetch(new URL("/v1/listings/facets", base), { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { available: false, regions: [], source, message: `The marketplace answered HTTP ${res.status}.` };
    const facets = (await res.json()) as { countries?: FacetBucket[] };
    const regions = (facets.countries ?? [])
      .filter((b) => typeof b.value === "string" && /^[A-Za-z]{2}$/.test(b.value) && Number.isFinite(b.count))
      .map((b) => ({ code: b.value.toUpperCase(), listings: b.count }))
      .sort((a, b) => b.listings - a.listings || a.code.localeCompare(b.code));
    return { available: true, regions, source };
  } catch {
    return { available: false, regions: [], source, message: "The marketplace could not be reached, so the live region list is unavailable." };
  }
}

