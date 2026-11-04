import { NextResponse, type NextRequest } from "next/server";
import { resolveAssistantUser } from "@/lib/server/assistant-auth";
import { accountTag, assistantActionsEnabled, executeDraft, getAssistantDraftStore } from "@/lib/server/assistant-actions";
import { readAssistantJson } from "@/lib/server/assistant-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers });

/**
 * Executes ONE Hubbie-prepared draft after the signed-in user pressed
 * Approve in the panel. This endpoint is unreachable by the model: it takes
 * only a draft id (never amounts or targets), the draft is owner-bound,
 * single-use, and re-validated server-side before any mutation runs.
 */
export async function POST(request: NextRequest) {
  if (!assistantActionsEnabled()) return fail(404, "In-chat actions are disabled on this server.");
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail(403, "Cross-origin requests are not allowed.");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== (request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host)) return fail(403, "Cross-origin requests are not allowed.");
    } catch { return fail(403, "Cross-origin requests are not allowed."); }
  }
  const auth = await resolveAssistantUser(request);
  if (!auth.ok) return fail(auth.status, auth.message);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fail(415, "Use application/json for action approval.");
  let body: { draft_id?: unknown } | null;
  try { body = await readAssistantJson(request, 4096) as typeof body; } catch { return fail(400, "Send valid JSON with a draft id."); }
  const draftId = typeof body?.draft_id === "string" ? body.draft_id : "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(draftId)) return fail(400, "Send the draft id from the approval card.");

  const started = Date.now();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(170_000)]);
  const result = await executeDraft({
    bearer: auth.user.bearer,
    apiBase: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080",
    signal, userId: auth.user.id, drafts: getAssistantDraftStore(),
  }, draftId);
  console.info(JSON.stringify({ event: "hubbie.action", account: accountTag(auth.user.id), status: result.status, latencyMs: Date.now() - started }));
  return NextResponse.json(result, { headers });
}
