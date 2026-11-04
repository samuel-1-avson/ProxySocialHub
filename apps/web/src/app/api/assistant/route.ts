import { NextResponse, type NextRequest } from "next/server";
import { assistantGuideReply, type AssistantEvent, type AssistantMessage } from "@/lib/assistant";
import { resolveAssistantUser } from "@/lib/server/assistant-auth";
import { assistantSettings, AssistantError, runAssistant, type AssistantUsageRecord } from "@/lib/server/assistant-agent";
import { readAssistantJson } from "@/lib/server/assistant-json";
import { getAssistantRateLimiter, RATE_LIMIT_MESSAGES } from "@/lib/server/assistant-rate-limit";
import { accountTag, assistantActionsEnabled, getAssistantDraftStore } from "@/lib/server/assistant-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const fail = (status: number, message: string, extra?: Record<string, string>) => NextResponse.json({ error: message, ...extra }, { status, headers });


/** One JSON line per turn: cost/latency/tool outcomes only, never content. */
function logUsage(accountId: string, record: AssistantUsageRecord) {
  console.info(JSON.stringify({ event: "hubbie.usage", account: accountTag(accountId), ...record }));
}

/** No account or model secrets are exposed by the capability endpoint. */
export async function GET(request: NextRequest) {
  const auth = await resolveAssistantUser(request);
  if (!auth.ok) return fail(auth.status, auth.message);
  const settings = assistantSettings();
  return NextResponse.json({ mode: settings ? "ai" : "guides", provider: "meta", model: settings?.model ?? null }, { headers });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return fail(403, "Cross-origin requests are not allowed.");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== (request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host)) return fail(403, "Cross-origin requests are not allowed.");
    } catch { return fail(403, "Cross-origin requests are not allowed."); }
  }
  const auth = await resolveAssistantUser(request);
  if (!auth.ok) return fail(auth.status, auth.message);
  const { user } = auth;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return fail(415, "Use application/json for assistant requests.");
  let body: { messages?: unknown; pathname?: unknown } | null;
  try { body = await readAssistantJson(request, 32768) as typeof body; } catch { return fail(400, "Send valid JSON smaller than 32 KB."); }
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) return fail(400, "Send between 1 and 20 messages.");
  let total = 0;
  const messages: AssistantMessage[] = [];
  for (const item of body.messages) {
    if (!item || typeof item !== "object" || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || !item.content.trim() || item.content.length > 4000) return fail(400, "Each message must contain a user or assistant role and 1–4,000 characters.");
    total += item.content.length;
    messages.push({ role: item.role, content: item.content.trim() });
  }
  if (total > 20000 || messages[messages.length - 1].role !== "user") return fail(400, "Keep conversation context under 20,000 characters and end with your request.");
  const pathname = typeof body.pathname === "string" && /^\/[A-Za-z0-9/_-]{0,160}$/.test(body.pathname) ? body.pathname : "/";
  const settings = assistantSettings();
  if (!settings) return NextResponse.json(assistantGuideReply(messages[messages.length - 1].content), { headers });

  const acquired = await getAssistantRateLimiter().acquire(user.id);
  if (!acquired.ok) return fail(429, RATE_LIMIT_MESSAGES[acquired.reason], { reason: acquired.reason });
  let released = false;
  const release = () => { if (!released) { released = true; void acquired.release(); } };
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(90_000)]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      void (async () => {
        const emit = (event: AssistantEvent) => {
          if (!closed && !signal.aborted) streamController.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          const reply = await runAssistant({
            settings, messages, pathname,
            context: { bearer: user.bearer, role: user.role, userId: user.id, actionsEnabled: assistantActionsEnabled(), drafts: getAssistantDraftStore(), apiBase: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080", signal },
            emit, onUsage: (record) => logUsage(user.id, record),
          });
          emit({ type: "reply", reply });
        } catch (error) {
          if (!closed) streamController.enqueue(encoder.encode(JSON.stringify({ type: "error", message: error instanceof AssistantError ? error.message : "The assistant could not finish this request. Try again or contact support." }) + "\n"));
        } finally {
          release();
          if (!closed) { closed = true; streamController.close(); }
        }
      })();
    },
    cancel() { closed = true; controller.abort(); release(); },
  });
  return new Response(stream, { headers: { ...headers, "content-type": "application/x-ndjson; charset=utf-8", "x-accel-buffering": "no", "x-content-type-options": "nosniff" } });
}
