import { createHash, randomBytes } from "node:crypto";

export const nowIso = (): string => new Date().toISOString();

export function newAuditId(): string {
  return `aud_${randomBytes(6).toString("hex")}`;
}

export const AUDIT_ID_RE = /^aud_[0-9a-f]{12}$/;

/** Stable evidence id derived from the audit id and requested country. */
export function evidenceIdFor(auditId: string, country: string): string {
  return `ev-${auditId.slice(4, 12)}-${country}`;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error("aborted");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Counting semaphore; waiting callers are released in order and can be aborted. */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<{ grant: () => void; cancel: () => void }> = [];

  constructor(max: number) {
    this.available = max;
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const next = this.waiters.shift();
        if (next) next.grant();
        else this.available += 1;
      };
      const onAbort = () => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(abortError(signal));
      };
      const entry = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(release);
        },
        cancel: onAbort,
      };
      if (this.available > 0) {
        this.available -= 1;
        resolve(release);
      } else {
        this.waiters.push(entry);
        signal?.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  get waiting(): number {
    return this.waiters.length;
  }
}

/** Run `fn` with a timeout that also aborts the supplied signal's child controller. */
export async function withTimeout<T>(ms: number, label: string, fn: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(abortError(parent));
  parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${ms}ms`)), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}
