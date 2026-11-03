import { NextResponse, type NextRequest } from "next/server";
import { checkRulesDraft } from "@/lib/provider-rules";
import { errorJson } from "@/lib/server/auditor";
import { readJsonBody, withAuditUser } from "@/lib/server/audit-route";
import { createRateLimiter } from "@/lib/server/concierge-draft";
import { metaModelSettings, requestJson } from "@/lib/server/meta-model";
import { runRulesDraft } from "@/lib/server/provider-rules-draft";

export const dynamic = "force-dynamic";

const SIGN_IN = "Sign in, or connect this computer to an account, to draft rules.";
const perUser = createRateLimiter(20, 60 * 60_000);
const everyone = createRateLimiter(300, 60 * 60_000);

/**
 * Draft a change to a node's blocked sites from the provider's own words. Called by the node
 * (`provider-node rules draft`) with its provider token, or from a signed-in browser. Changes
 * nothing: the provider approves the plan and the provider app writes it to the node.
 */
export function POST(request: NextRequest) {
  return withAuditUser(
    request,
    async (user) => {
      const model = metaModelSettings();
      if (!model.ok) {
        return errorJson(503, "rules_assistant_not_configured", "The rules assistant is not set up on this server. Edit the list yourself.");
      }
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return parsed.response;

      for (const [limiter, key] of [[everyone, "*"], [perUser, user.id]] as const) {
        const taken = limiter.take(key);
        if (!taken.ok) {
          return errorJson(429, "rate_limited", "Too many drafts for now. Try again later, or edit the list yourself.", {
            "retry-after": String(taken.retryAfterSeconds),
          });
        }
      }

      const body = parsed.body as { request?: unknown; current?: unknown } | null;
      const outcome = await runRulesDraft(body?.request, body?.current ?? [], {
        callModel: (req) => requestJson(model.settings, req),
        check: checkRulesDraft,
      });
      if (!outcome.ok) return errorJson(outcome.status, outcome.code, outcome.message);
      return NextResponse.json(
        { plan: outcome.plan, draft: outcome.draft, model: { id: model.settings.model, dataMode: model.settings.dataMode } },
        { headers: { "cache-control": "no-store" } },
      );
    },
    SIGN_IN,
  );
}
