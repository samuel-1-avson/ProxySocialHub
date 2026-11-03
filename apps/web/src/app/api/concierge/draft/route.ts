import { NextResponse, type NextRequest } from "next/server";
import { checkDraft, marketFromListings, type MarketListing } from "@/lib/concierge-plan";
import { errorJson } from "@/lib/server/auditor";
import { readJsonBody, withAuditUser } from "@/lib/server/audit-route";
import { apiBase } from "@/lib/server/audit-sessions";
import { createRateLimiter, runConciergeDraft } from "@/lib/server/concierge-draft";
import { metaModelSettings, requestJson } from "@/lib/server/meta-model";

export const dynamic = "force-dynamic";

const SIGN_IN = "Sign in to use the session assistant.";
const perUser = createRateLimiter(20, 60 * 60_000);
const everyone = createRateLimiter(300, 60 * 60_000);

async function listMarket(): Promise<MarketListing[] | null> {
  try {
    const res = await fetch(new URL("/v1/listings?limit=100", apiBase()), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return marketFromListings(await res.json());
  } catch {
    return null;
  }
}

/** Draft a session plan from the buyer's own words. Creates nothing: the buyer approves the plan in the browser. */
export function POST(request: NextRequest) {
  return withAuditUser(
    request,
    async (user) => {
      const model = metaModelSettings();
      if (!model.ok) {
        return errorJson(503, "concierge_not_configured", "The session assistant is not set up on this server. Fill in the session form yourself.");
      }
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return parsed.response;

      for (const [limiter, key] of [[everyone, "*"], [perUser, user.id]] as const) {
        const taken = limiter.take(key);
        if (!taken.ok) {
          return errorJson(429, "rate_limited", "Too many drafts for now. Try again later, or fill in the session form yourself.", {
            "retry-after": String(taken.retryAfterSeconds),
          });
        }
      }

      const body = parsed.body as { request?: unknown } | null;
      const outcome = await runConciergeDraft(body?.request, {
        listMarket,
        callModel: (req) => requestJson(model.settings, req),
        check: checkDraft,
      });
      if (!outcome.ok) return errorJson(outcome.status, outcome.code, outcome.message);
      return NextResponse.json(
        {
          plan: outcome.plan,
          draft: outcome.draft,
          market: outcome.market,
          model: { id: model.settings.model, dataMode: model.settings.dataMode },
        },
        { headers: { "cache-control": "no-store" } },
      );
    },
    SIGN_IN,
  );
}
