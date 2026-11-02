// Client for the Meta Model API (Responses protocol).
//
// Verified against https://api.meta.ai/v1 on 2026-11-01:
//   POST /responses { model, instructions, input:[{type:"message",role,content:[
//     {type:"input_text"},{type:"input_image",image_url:"data:..."}]}],
//     text:{format:{type:"json_schema",name,strict,schema}}, reasoning:{effort},
//     max_output_tokens, store }
//   -> { id, status:"completed"|"incomplete", output:[{type:"reasoning"},
//        {type:"message",content:[{type:"output_text",text}|{type:"refusal"}]}],
//        usage:{input_tokens,output_tokens,input_tokens_details:{cached_tokens},
//               output_tokens_details:{reasoning_tokens}} }
// Reasoning tokens count against max_output_tokens, so an undersized budget
// yields status "incomplete"; that is surfaced as its own failure code.

import type { AuditorConfig } from "../config.ts";
import type { AiFailureCode, UsageCall } from "../contracts.ts";
import { redactKnown, redactSecrets } from "../redact.ts";
import { sleep, truncate } from "../util.ts";

export type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export interface ModelRequest {
  stage: "plan" | "analyze";
  instructions: string;
  content: InputPart[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  signal?: AbortSignal;
  /** Hard cap on HTTP attempts for this request (the job's remaining model-call budget). */
  maxAttempts?: number;
}

export interface ModelSuccess {
  ok: true;
  json: unknown;
  calls: UsageCall[];
}

export interface ModelFailure {
  ok: false;
  code: AiFailureCode;
  message: string;
  retryable: boolean;
  calls: UsageCall[];
  attempts: number;
}

export type ModelResult = ModelSuccess | ModelFailure;

type FetchLike = typeof fetch;

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 30_000;

interface ResponsesBody {
  id?: string;
  status?: string;
  error?: { message?: string; type?: string; code?: string | null } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** Make a JSON schema acceptable to the strict-mode subset without changing its meaning. */
export function toStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  delete clone.$schema;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties as object);
    }
    Object.values(obj).forEach(walk);
  };
  walk(clone);
  return clone;
}

export class MetaClient {
  private readonly config: AuditorConfig["model"];
  private readonly fetchImpl: FetchLike;
  private readonly secrets: string[];

  constructor(config: AuditorConfig["model"], fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.secrets = config.apiKey ? [config.apiKey] : [];
  }

  get configured(): boolean {
    return this.config.apiKey !== null;
  }

  get modelId(): string {
    return this.config.id;
  }

  /**
   * One logical model request with bounded retries. Only 429/500/503 and
   * network errors are retried (per the provider's error-handling guidance);
   * a 504 or our own timeout is not retried unchanged.
   */
  async respond(req: ModelRequest): Promise<ModelResult> {
    const calls: UsageCall[] = [];
    if (!this.config.apiKey) {
      return { ok: false, code: "missing_key", message: "MODEL_API_KEY is not configured.", retryable: false, calls, attempts: 0 };
    }

    const body = {
      model: this.config.id,
      instructions: req.instructions,
      input: [{ type: "message", role: "user", content: req.content }],
      text: {
        format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.jsonSchema },
      },
      reasoning: { effort: this.config.reasoningEffort },
      max_output_tokens: this.config.maxOutputTokens,
      store: false,
    };
    const payload = JSON.stringify(body);

    let attempts = 0;
    let last: ModelFailure | null = null;
    const maxAttempts = Math.max(1, Math.min(this.config.maxRetries + 1, req.maxAttempts ?? Number.MAX_SAFE_INTEGER));

    while (attempts < maxAttempts) {
      attempts += 1;
      const started = Date.now();
      const attemptSignal = AbortSignal.any([
        AbortSignal.timeout(this.config.timeoutMs),
        ...(req.signal ? [req.signal] : []),
      ]);

      let httpStatus: number | null = null;
      let retryAfterMs: number | null = null;
      try {
        const res = await this.fetchImpl(`${this.config.baseUrl}/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
          body: payload,
          signal: attemptSignal,
        });
        httpStatus = res.status;
        const retryRaw = res.headers.get("retry-after");
        const retryHeader = retryRaw === null ? NaN : Number(retryRaw);
        retryAfterMs = Number.isFinite(retryHeader) && retryHeader >= 0 ? Math.min(retryHeader * 1000, MAX_RETRY_AFTER_MS) : null;

        const raw = await readCapped(res, MAX_RESPONSE_BYTES);
        let parsed: ResponsesBody | null = null;
        try {
          parsed = JSON.parse(raw) as ResponsesBody;
        } catch {
          parsed = null;
        }
        const latencyMs = Date.now() - started;
        const usage = parsed?.usage;
        const call = (outcome: UsageCall["outcome"]): UsageCall => ({
          stage: req.stage,
          model: this.config.id,
          inputTokens: num(usage?.input_tokens),
          outputTokens: num(usage?.output_tokens),
          cachedTokens: num(usage?.input_tokens_details?.cached_tokens),
          reasoningTokens: num(usage?.output_tokens_details?.reasoning_tokens),
          latencyMs,
          httpStatus,
          responseId: typeof parsed?.id === "string" ? truncate(parsed.id, 80) : null,
          outcome,
        });

        if (!res.ok) {
          const message = this.errorMessage(res.status, parsed);
          const retryable = res.status === 429 || res.status === 500 || res.status === 503;
          calls.push(call(retryable ? "retryable_error" : "fatal_error"));
          last = {
            ok: false,
            code: res.status === 429 ? "rate_limited" : res.status === 504 ? "timeout" : "http_error",
            message,
            retryable: retryable || res.status === 504,
            calls,
            attempts,
          };
          if (!retryable) return last;
        } else if (!parsed) {
          calls.push(call("fatal_error"));
          return { ok: false, code: "malformed_output", message: "The model API returned a body that is not JSON.", retryable: true, calls, attempts };
        } else {
          const outcome = interpret(parsed);
          if (!outcome.ok) {
            calls.push(call("fatal_error"));
            return { ok: false, code: outcome.code, message: outcome.message, retryable: outcome.retryable, calls, attempts };
          }
          calls.push(call("ok"));
          let json: unknown;
          try {
            json = JSON.parse(outcome.text);
          } catch {
            return {
              ok: false,
              code: "malformed_output",
              message: "The model returned text that is not valid JSON.",
              retryable: true,
              calls,
              attempts,
            };
          }
          return { ok: true, json, calls };
        }
      } catch (error) {
        const aborted = req.signal?.aborted;
        if (aborted) {
          calls.push(this.networkCall(req.stage, started, httpStatus, "fatal_error"));
          return { ok: false, code: "timeout", message: "The audit was cancelled during a model call.", retryable: false, calls, attempts };
        }
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        calls.push(this.networkCall(req.stage, started, httpStatus, timedOut ? "fatal_error" : "retryable_error"));
        last = {
          ok: false,
          code: timedOut ? "timeout" : "http_error",
          message: timedOut
            ? `The model did not answer within ${Math.round(this.config.timeoutMs / 1000)}s.`
            : `Network error calling the model API: ${redactKnown(error instanceof Error ? error.message : "unknown", this.secrets).slice(0, 160)}`,
          retryable: true,
          calls,
          attempts,
        };
        // A client-side timeout is not retried unchanged; transient network errors are.
        if (timedOut) return last;
      }

      if (attempts < maxAttempts) {
        const backoff = retryAfterMs ?? Math.min(500 * 2 ** (attempts - 1), 8000) + Math.floor(Math.random() * 1000);
        try {
          await sleep(backoff, req.signal);
        } catch {
          return { ok: false, code: "timeout", message: "The audit was cancelled while waiting to retry.", retryable: false, calls, attempts };
        }
      }
    }
    return last ?? { ok: false, code: "http_error", message: "Model request failed.", retryable: true, calls, attempts };
  }

  private networkCall(stage: UsageCall["stage"], started: number, httpStatus: number | null, outcome: UsageCall["outcome"]): UsageCall {
    return {
      stage,
      model: this.config.id,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      latencyMs: Date.now() - started,
      httpStatus,
      responseId: null,
      outcome,
    };
  }

  private errorMessage(status: number, body: ResponsesBody | null): string {
    const detail = body?.error?.message ? redactKnown(redactSecrets(String(body.error.message)), this.secrets).slice(0, 200) : "";
    const type = body?.error?.type ? ` (${String(body.error.type).slice(0, 40)})` : "";
    switch (status) {
      case 401:
        return `The model API rejected the API key${type}.`;
      case 402:
        return `The model API reports a billing problem${type}.`;
      case 403:
        return `The API key does not have access to model ${this.config.id}${type}.`;
      case 404:
        return `Model ${this.config.id} was not found${type}.`;
      case 413:
        return "The request was too large for the model API.";
      case 429:
        return "The model API rate limit was reached.";
      case 504:
        return "The model API timed out before finishing; reduce the evidence size or retry.";
      default:
        return `The model API returned HTTP ${status}${type}${detail ? `: ${detail}` : ""}.`;
    }
  }
}

type Interpreted = { ok: true; text: string } | { ok: false; code: AiFailureCode; message: string; retryable: boolean };

function interpret(body: ResponsesBody): Interpreted {
  if (body.error?.message) {
    return { ok: false, code: "http_error", message: `The model API reported an error: ${String(body.error.message).slice(0, 200)}`, retryable: true };
  }
  const reason = body.incomplete_details?.reason;
  if (body.status === "incomplete") {
    if (reason === "content_filter") {
      return { ok: false, code: "refused", message: "The model declined to analyze this evidence (content filter).", retryable: false };
    }
    return {
      ok: false,
      code: "truncated",
      message: "The model ran out of output budget before finishing (reasoning counts against it). Retry, or raise AUDITOR_MODEL_MAX_OUTPUT_TOKENS.",
      retryable: true,
    };
  }
  if (body.status && body.status !== "completed") {
    return { ok: false, code: "http_error", message: `The model response ended with status "${String(body.status).slice(0, 40)}".`, retryable: true };
  }
  const message = body.output?.find((item) => item.type === "message");
  const refusal = message?.content?.find((c) => c.type === "refusal");
  if (refusal) {
    return { ok: false, code: "refused", message: "The model refused to answer.", retryable: false };
  }
  const text = message?.content?.find((c) => c.type === "output_text")?.text;
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, code: "malformed_output", message: "The model returned no text output.", retryable: true };
  }
  if (text.length > 400_000) {
    return { ok: false, code: "malformed_output", message: "The model output exceeded the size limit.", retryable: false };
  }
  return { ok: true, text };
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("model response exceeded the size limit");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Sum provider-reported usage and apply the configured (estimated) price. */
export function summarizeUsage(
  calls: UsageCall[],
  pricing: AuditorConfig["model"]["pricing"],
): { totalInputTokens: number; totalOutputTokens: number; costEstimate: { usd: number; label: "estimate"; priceSource: string } | null } {
  let input = 0;
  let output = 0;
  let cached = 0;
  let sawUsage = false;
  for (const c of calls) {
    if (c.inputTokens !== null) {
      input += c.inputTokens;
      sawUsage = true;
    }
    if (c.outputTokens !== null) output += c.outputTokens;
    if (c.cachedTokens !== null) cached += c.cachedTokens;
  }
  if (!pricing || !sawUsage) return { totalInputTokens: input, totalOutputTokens: output, costEstimate: null };
  const billableInput = Math.max(0, input - cached);
  const usd =
    (billableInput * pricing.inputPerMTok + cached * pricing.cachedPerMTok + output * pricing.outputPerMTok) / 1_000_000;
  return {
    totalInputTokens: input,
    totalOutputTokens: output,
    costEstimate: { usd: Math.round(usd * 1_000_000) / 1_000_000, label: "estimate", priceSource: pricing.source },
  };
}
