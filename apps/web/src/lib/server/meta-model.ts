// Server-only: minimal Meta Model API client (Responses protocol), text in, strict JSON out.
//
// A text-only port of services/regional-auditor/src/ai/meta.ts, which was verified
// against https://api.meta.ai/v1 on 2026-11-01. Same rules: reasoning tokens count
// against max_output_tokens (an "incomplete" answer is its own failure), only
// 429/500/503 and network errors are retried, and contributor-mode models (which
// Meta may train on) are refused unless explicitly allowed.
//
// No imports, so `node --test` can load this file directly.

export interface MetaModelSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  dataMode: "standard" | "contributor";
  reasoningEffort: "low" | "medium" | "high";
  maxOutputTokens: number;
  timeoutMs: number;
  maxAttempts: number;
}

export type MetaSettingsResult = { ok: true; settings: MetaModelSettings } | { ok: false; message: string };

export interface MetaJsonRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export type MetaFailureCode = "http_error" | "rate_limited" | "timeout" | "truncated" | "refused" | "malformed_output";

export type MetaJsonResult =
  | { ok: true; json: unknown; usage: { inputTokens: number | null; outputTokens: number | null } }
  | { ok: false; code: MetaFailureCode; message: string; retryable: boolean };

type Env = Record<string, string | undefined>;

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RETRY_AFTER_MS = 10_000;

/** Read the concierge's model settings. The API key is the same MODEL_API_KEY the Regional Auditor uses. */
export function metaModelSettings(env: Env = process.env): MetaSettingsResult {
  const apiKey = env.MODEL_API_KEY?.trim();
  if (!apiKey) return { ok: false, message: "MODEL_API_KEY is not configured." };
  const model = env.CONCIERGE_MODEL?.trim() || "muse-spark-1.3";
  const contributor = /-contributor$/.test(model);
  if (contributor && env.CONCIERGE_ALLOW_CONTRIBUTOR_MODE?.trim() !== "1") {
    return {
      ok: false,
      message: "CONCIERGE_MODEL is a contributor-mode model (Meta may train on buyers' requests). Set CONCIERGE_ALLOW_CONTRIBUTOR_MODE=1 to allow it.",
    };
  }
  const effort = env.CONCIERGE_MODEL_REASONING_EFFORT?.trim() || "low";
  if (effort !== "low" && effort !== "medium" && effort !== "high") {
    return { ok: false, message: "CONCIERGE_MODEL_REASONING_EFFORT must be low, medium or high." };
  }
  return {
    ok: true,
    settings: {
      apiKey,
      baseUrl: (env.CONCIERGE_MODEL_BASE_URL?.trim() || "https://api.meta.ai/v1").replace(/\/$/, ""),
      model,
      dataMode: contributor ? "contributor" : "standard",
      reasoningEffort: effort,
      maxOutputTokens: 4000,
      timeoutMs: 30_000,
      maxAttempts: 2,
    },
  };
}

interface ResponsesBody {
  status?: string;
  error?: { message?: string; type?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

function errorMessage(status: number, model: string): string {
  switch (status) {
    case 401:
      return "The model API rejected the API key.";
    case 402:
      return "The model API reports a billing problem.";
    case 403:
      return `The API key does not have access to model ${model}.`;
    case 404:
      return `Model ${model} was not found.`;
    case 429:
      return "The model API rate limit was reached.";
    case 504:
      return "The model API timed out before finishing.";
    default:
      return `The model API returned HTTP ${status}.`;
  }
}

type Interpreted = { ok: true; text: string } | { ok: false; code: MetaFailureCode; message: string; retryable: boolean };

function interpret(body: ResponsesBody): Interpreted {
  if (body.error?.message) return { ok: false, code: "http_error", message: "The model API reported an error.", retryable: true };
  if (body.status === "incomplete") {
    if (body.incomplete_details?.reason === "content_filter") {
      return { ok: false, code: "refused", message: "The model declined this request.", retryable: false };
    }
    return { ok: false, code: "truncated", message: "The model ran out of output budget before finishing.", retryable: true };
  }
  if (body.status && body.status !== "completed") {
    return { ok: false, code: "http_error", message: "The model response did not complete.", retryable: true };
  }
  const message = body.output?.find((item) => item.type === "message");
  if (message?.content?.some((c) => c.type === "refusal")) {
    return { ok: false, code: "refused", message: "The model declined this request.", retryable: false };
  }
  const text = message?.content?.find((c) => c.type === "output_text")?.text;
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, code: "malformed_output", message: "The model returned no text.", retryable: true };
  }
  return { ok: true, text };
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("model response exceeded the size limit");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One logical request with bounded retries. Never includes the API key or the input in any message. */
export async function requestJson(
  settings: MetaModelSettings,
  req: MetaJsonRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaJsonResult> {
  const payload = JSON.stringify({
    model: settings.model,
    instructions: req.instructions,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: req.input }] }],
    text: { format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.schema } },
    reasoning: { effort: settings.reasoningEffort },
    max_output_tokens: settings.maxOutputTokens,
    store: false,
  });

  let last: MetaJsonResult = { ok: false, code: "http_error", message: "Model request failed.", retryable: true };
  for (let attempt = 1; attempt <= settings.maxAttempts; attempt += 1) {
    let retryAfterMs: number | null = null;
    try {
      const res = await fetchImpl(`${settings.baseUrl}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${settings.apiKey}` },
        body: payload,
        signal: AbortSignal.timeout(settings.timeoutMs),
      });
      const retryHeader = Number(res.headers.get("retry-after") ?? NaN);
      retryAfterMs = Number.isFinite(retryHeader) && retryHeader >= 0 ? Math.min(retryHeader * 1000, MAX_RETRY_AFTER_MS) : null;
      const raw = await readCapped(res, MAX_RESPONSE_BYTES);
      let body: ResponsesBody | null = null;
      try {
        body = JSON.parse(raw) as ResponsesBody;
      } catch {
        body = null;
      }

      if (!res.ok) {
        const retryable = res.status === 429 || res.status === 500 || res.status === 503;
        last = {
          ok: false,
          code: res.status === 429 ? "rate_limited" : res.status === 504 ? "timeout" : "http_error",
          message: errorMessage(res.status, settings.model),
          retryable: retryable || res.status === 504,
        };
        if (!retryable) return last;
      } else if (!body) {
        return { ok: false, code: "malformed_output", message: "The model API returned a body that is not JSON.", retryable: true };
      } else {
        const outcome = interpret(body);
        if (!outcome.ok) return outcome;
        try {
          return {
            ok: true,
            json: JSON.parse(outcome.text) as unknown,
            usage: { inputTokens: count(body.usage?.input_tokens), outputTokens: count(body.usage?.output_tokens) },
          };
        } catch {
          return { ok: false, code: "malformed_output", message: "The model returned text that is not valid JSON.", retryable: true };
        }
      }
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      last = {
        ok: false,
        code: timedOut ? "timeout" : "http_error",
        message: timedOut ? `The model did not answer within ${Math.round(settings.timeoutMs / 1000)}s.` : "Network error calling the model API.",
        retryable: true,
      };
      // Our own timeout is not retried unchanged; transient network errors are.
      if (timedOut) return last;
    }
    if (attempt < settings.maxAttempts) await sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1));
  }
  return last;
}
