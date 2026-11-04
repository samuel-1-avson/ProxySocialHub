import { NextResponse, type NextRequest } from "next/server";
import { checkDoctorDraft, failedChecks, meaningFor, parseDoctorChecks } from "@/lib/provider-doctor";
import { errorJson } from "@/lib/server/auditor";
import { readJsonBody, withAuditUser } from "@/lib/server/audit-route";
import { createRateLimiter } from "@/lib/server/concierge-draft";
import { metaModelSettings, requestJson } from "@/lib/server/meta-model";
import { runDoctorDraft } from "@/lib/server/provider-doctor-draft";

export const dynamic = "force-dynamic";

const SIGN_IN = "Sign in, or connect this computer to an account, to ask the doctor.";
const perUser = createRateLimiter(20, 60 * 60_000);
const everyone = createRateLimiter(300, 60 * 60_000);

/**
 * Explain a node's doctor report in plain words. Called by the node (`provider-node doctor
 * --explain`) with its provider token, or from a signed-in browser. The body carries only
 * check ids, severities and codes plus the provider's optional words: no doctor message text
 * (it can hold file paths) and no credential ever reach the model. Changes nothing.
 */
export function POST(request: NextRequest) {
  return withAuditUser(
    request,
    async (user) => {
      const model = metaModelSettings();
      if (!model.ok) {
        return errorJson(503, "doctor_not_configured", "The doctor assistant is not set up on this server. The check results still stand on their own.");
      }
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return parsed.response;

      for (const [limiter, key] of [[everyone, "*"], [perUser, user.id]] as const) {
        const taken = limiter.take(key);
        if (!taken.ok) {
          return errorJson(429, "rate_limited", "Too many explanations for now. Try again later; the check results still stand.", {
            "retry-after": String(taken.retryAfterSeconds),
          });
        }
      }

      const body = parsed.body as { request?: unknown; checks?: unknown } | null;
      const outcome = await runDoctorDraft(body?.request, body?.checks, {
        callModel: (req) => requestJson(model.settings, req),
        parseChecks: parseDoctorChecks,
        failedOf: failedChecks,
        meaningOf: meaningFor,
        check: checkDoctorDraft,
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
