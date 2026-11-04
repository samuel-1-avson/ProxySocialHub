// Shared bounded control-API access for Hubbie tools and actions.
// Only fixed caller-scoped paths are ever passed in by callers; responses are
// size-capped and parsed defensively, and raw upstream bodies never surface.
import { redactAssistantSecrets } from "../assistant";

export interface PlatformContext {
  bearer: string;
  apiBase: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}
export interface PlatformResult { ok: boolean; status: number; body: Record<string, unknown> }

export const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const str = (v: unknown, max = 160): string | null => typeof v === "string" ? redactAssistantSecrets(v.slice(0, max)) : null;
export const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
export const id = (v: unknown): string | null => typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v) ? v : null;
export const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.slice(0, 10).map(obj) : [];
/** Allowlisted upstream error code (e.g. insufficient_balance), never raw bodies. */
export const errorCode = (body: Record<string, unknown>): string | null => {
  const code = str(body.code, 60);
  return code && /^[a-z0-9_]+$/.test(code) ? code : null;
};

async function readBounded(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 512 * 1024) { await reader.cancel(); return {}; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return obj(JSON.parse(raw));
  } catch {
    return {};
  } finally { reader.releaseLock(); }
}

export async function platformGet(ctx: PlatformContext, path: string, authenticated = true, timeoutMs = 10_000): Promise<PlatformResult> {
  try {
    const response = await (ctx.fetchImpl ?? fetch)(new URL(path, ctx.apiBase), {
      method: "GET", cache: "no-store", redirect: "error",
      headers: { accept: "application/json", ...(authenticated ? { authorization: `Bearer ${ctx.bearer}` } : {}) },
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
    });
    return { ok: response.ok, status: response.status, body: await readBounded(response) };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

/** Authenticated POST. Status 0 means the outcome is unknown (network/abort). */
export async function platformPost(ctx: PlatformContext, path: string, payload: unknown, options: { timeoutMs?: number; idempotencyKey?: string } = {}): Promise<PlatformResult> {
  try {
    const response = await (ctx.fetchImpl ?? fetch)(new URL(path, ctx.apiBase), {
      method: "POST", cache: "no-store", redirect: "error",
      headers: {
        accept: "application/json", "content-type": "application/json",
        authorization: `Bearer ${ctx.bearer}`,
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]),
    });
    return { ok: response.ok, status: response.status, body: await readBounded(response) };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}
