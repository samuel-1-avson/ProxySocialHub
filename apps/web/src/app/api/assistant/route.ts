import { NextResponse, type NextRequest } from "next/server";
import { assistantGuideReply, type AssistantEvent, type AssistantMessage } from "@/lib/assistant";
import { resolveAssistantUser } from "@/lib/server/assistant-auth";
import { assistantSettings, AssistantError, runAssistant } from "@/lib/server/assistant-agent";
import { readAssistantJson } from "@/lib/server/assistant-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers });
const recent = new Map<string, { started: number; count: number; busy: boolean }>();
const WINDOW = 10 * 60_000;
let fleetWindow = 0;
let fleetCount = 0;
let concurrent = 0;

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

  const now = Date.now();
  for (const [key, value] of recent) if (now - value.started >= WINDOW && !value.busy) recent.delete(key);
  let limit = recent.get(user.id);
  if (now - fleetWindow >= WINDOW) { fleetWindow = now; fleetCount = 0; }
  if (limit?.busy || (limit && now - limit.started < WINDOW && limit.count >= 12) || (!limit && recent.size >= 2000) || fleetCount >= 120 || concurrent >= 16) return fail(429, "Please wait before sending another request. Live assistance allows 12 requests every 10 minutes.");
  if (!limit || now - limit.started >= WINDOW) { limit = { started: now, count: 0, busy: false }; recent.set(user.id, limit); }
  limit.count++;
  limit.busy = true;
  fleetCount++;
  concurrent++;
  const slot = limit;
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
          const reply = await runAssistant({ settings, messages, pathname, context: { bearer: user.bearer, role: user.role, apiBase: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:18080", signal }, emit });
          emit({ type: "reply", reply });
        } catch (error) {
          if (!closed) streamController.enqueue(encoder.encode(JSON.stringify({ type: "error", message: error instanceof AssistantError ? error.message : "The assistant could not finish this request. Try again or contact support." }) + "\n"));
        } finally {
          slot.busy = false;
          concurrent--;
          if (!closed) { closed = true; streamController.close(); }
        }
      })();
    },
    cancel() { closed = true; controller.abort(); },
  });
  return new Response(stream, { headers: { ...headers, "content-type": "application/x-ndjson; charset=utf-8", "x-accel-buffering": "no", "x-content-type-options": "nosniff" } });
}
