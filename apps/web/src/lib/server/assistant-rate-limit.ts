// Hubbie rate limiting: per-account + fleet ceilings, in memory by default and
// in Redis when REDIS_URL is set (shared across web replicas). The Redis
// client is a deliberately small dependency-free RESP implementation; any
// Redis failure degrades to the in-memory limiter rather than disabling
// limits or failing requests outright.

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export const RATE_LIMIT_WINDOW_MS = 10 * 60_000;
export const RATE_LIMITS = { perAccount: 12, fleet: 120, concurrent: 16, accounts: 2000 } as const;

export type RateLimitReason = "account_busy" | "account_limit" | "fleet_limit" | "concurrency_limit";
export const RATE_LIMIT_MESSAGES: Record<RateLimitReason, string> = {
  account_busy: "Hubbie is still working on your previous request. Wait for it to finish, or stop it first.",
  account_limit: "You've used your 12 Hubbie requests for this 10-minute window. Please wait before asking again.",
  fleet_limit: "Hubbie has reached its overall usage limit for this 10-minute window. Please try again shortly.",
  concurrency_limit: "Hubbie is at capacity right now. Please try again in a minute.",
};

export type AcquireResult =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; reason: RateLimitReason };
export interface AssistantRateLimiter { acquire: (accountId: string) => Promise<AcquireResult> }

export class MemoryRateLimiter implements AssistantRateLimiter {
  private recent = new Map<string, { started: number; count: number; busy: boolean }>();
  private fleetWindow = 0;
  private fleetCount = 0;
  private concurrent = 0;

  async acquire(accountId: string): Promise<AcquireResult> {
    const now = Date.now();
    for (const [key, value] of this.recent) if (now - value.started >= RATE_LIMIT_WINDOW_MS && !value.busy) this.recent.delete(key);
    let limit = this.recent.get(accountId);
    if (now - this.fleetWindow >= RATE_LIMIT_WINDOW_MS) { this.fleetWindow = now; this.fleetCount = 0; }
    if (limit?.busy) return { ok: false, reason: "account_busy" };
    if (limit && now - limit.started < RATE_LIMIT_WINDOW_MS && limit.count >= RATE_LIMITS.perAccount) return { ok: false, reason: "account_limit" };
    if (!limit && this.recent.size >= RATE_LIMITS.accounts) return { ok: false, reason: "fleet_limit" };
    if (this.fleetCount >= RATE_LIMITS.fleet) return { ok: false, reason: "fleet_limit" };
    if (this.concurrent >= RATE_LIMITS.concurrent) return { ok: false, reason: "concurrency_limit" };
    if (!limit || now - limit.started >= RATE_LIMIT_WINDOW_MS) { limit = { started: now, count: 0, busy: false }; this.recent.set(accountId, limit); }
    limit.count++;
    limit.busy = true;
    this.fleetCount++;
    this.concurrent++;
    const slot = limit;
    let released = false;
    return {
      ok: true,
      release: async () => { if (!released) { released = true; slot.busy = false; this.concurrent--; } },
    };
  }
}

// --- Minimal RESP client (subset: AUTH, SELECT, SET NX PX, INCR, DECR, DEL, PEXPIRE) ---

type RespValue = string | number | null;
type ConnectFn = (options: { host: string; port: number; servername?: string }) => Socket;

function encodeCommand(parts: string[]): string {
  return `*${parts.length}\r\n` + parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join("");
}

class RespConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private waiters: Array<(value: RespValue) => void> = [];
  private failed: ((error: Error) => void) | null = null;

  constructor(private socket: Socket, timeoutMs: number) {
    socket.setTimeout(timeoutMs, () => this.fail(new Error("Redis timed out")));
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("Redis connection closed")));
  }

  private fail(error: Error) {
    this.failed?.(error);
    this.socket.destroy();
  }

  private async ready(): Promise<void> {
    if (!this.socket.connecting) return;
    await new Promise<void>((resolveReady, reject) => {
      this.failed = reject;
      this.socket.once("connect", resolveReady);
      this.socket.once("secureConnect", resolveReady);
    });
  }

  private drain() {
    while (this.waiters.length) {
      const parsed = this.parseOne();
      if (!parsed) return;
      const [value, rest] = parsed;
      this.buffer = rest;
      this.waiters.shift()?.(value);
    }
  }

  private parseOne(): [RespValue, Buffer] | null {
    const buf = this.buffer;
    if (!buf.length) return null;
    const type = String.fromCharCode(buf[0]);
    const lineEnd = buf.indexOf("\r\n");
    if (lineEnd < 0) return null;
    const line = buf.subarray(1, lineEnd).toString("utf8");
    if (type === "+") return [line, buf.subarray(lineEnd + 2)];
    if (type === "-") throw new Error(`Redis error: ${line.slice(0, 80)}`);
    if (type === ":") return [Number(line), buf.subarray(lineEnd + 2)];
    if (type === "$") {
      const length = Number(line);
      if (length < 0) return [null, buf.subarray(lineEnd + 2)];
      if (buf.length < lineEnd + 2 + length + 2) return null;
      return [buf.subarray(lineEnd + 2, lineEnd + 2 + length).toString("utf8"), buf.subarray(lineEnd + 2 + length + 2)];
    }
    throw new Error("Unexpected Redis reply");
  }

  async command(...parts: string[]): Promise<RespValue> {
    await this.ready();
    const reply = new Promise<RespValue>((resolveReply, reject) => {
      this.failed = reject;
      this.waiters.push(resolveReply);
    });
    this.socket.write(encodeCommand(parts));
    this.drain();
    return reply;
  }

  close() { this.socket.destroy(); }
}

interface RedisTarget { host: string; port: number; username?: string; password?: string; database: number; tls: boolean }

function parseRedisUrl(raw: string): RedisTarget | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") return null;
    return {
      host: url.hostname || "localhost",
      port: Number(url.port) || 6379,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      database: Math.max(0, Number(url.pathname.replace("/", "")) || 0),
      tls: url.protocol === "rediss:",
    };
  } catch { return null; }
}

export class RedisRateLimiter implements AssistantRateLimiter {
  private warnedAt = 0;
  constructor(
    private target: RedisTarget,
    private fallback: AssistantRateLimiter,
    private connectFn?: ConnectFn,
    private timeoutMs = 1500,
  ) {}

  private async open(): Promise<RespConnection> {
    const connect: ConnectFn = this.connectFn ?? ((options) => this.target.tls
      ? tlsConnect({ host: options.host, port: options.port, servername: options.servername ?? options.host })
      : netConnect({ host: options.host, port: options.port }));
    const conn = new RespConnection(connect({ host: this.target.host, port: this.target.port }), this.timeoutMs);
    if (this.target.password) {
      const auth = this.target.username
        ? await conn.command("AUTH", this.target.username, this.target.password)
        : await conn.command("AUTH", this.target.password);
      if (auth !== "OK") throw new Error("Redis AUTH refused");
    }
    if (this.target.database > 0 && (await conn.command("SELECT", String(this.target.database))) !== "OK") throw new Error("Redis SELECT refused");
    return conn;
  }

  private async withFallback<T>(work: () => Promise<T>, degraded: () => Promise<T>): Promise<T> {
    try { return await work(); } catch {
      const now = Date.now();
      if (now - this.warnedAt > 60_000) { this.warnedAt = now; console.warn("hubbie: Redis rate limiter unavailable; using in-memory limits for this process"); }
      return degraded();
    }
  }

  async acquire(accountId: string): Promise<AcquireResult> {
    return this.withFallback(async () => {
      const windowId = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
      const busyKey = `hubbie:busy:${accountId}`;
      const accountKey = `hubbie:acct:${accountId}:${windowId}`;
      const fleetKey = `hubbie:fleet:${windowId}`;
      const conn = await this.open();
      try {
        if ((await conn.command("SET", busyKey, "1", "NX", "PX", "120000")) !== "OK") return { ok: false as const, reason: "account_busy" as const };
        const deny = async (reason: RateLimitReason): Promise<AcquireResult> => {
          await conn.command("DEL", busyKey).catch(() => null);
          return { ok: false, reason };
        };
        const accountCount = Number(await conn.command("INCR", accountKey));
        if (accountCount === 1) await conn.command("PEXPIRE", accountKey, String(RATE_LIMIT_WINDOW_MS));
        if (accountCount > RATE_LIMITS.perAccount) return deny("account_limit");
        const fleetCount = Number(await conn.command("INCR", fleetKey));
        if (fleetCount === 1) await conn.command("PEXPIRE", fleetKey, String(RATE_LIMIT_WINDOW_MS));
        if (fleetCount > RATE_LIMITS.fleet) return deny("fleet_limit");
        const concurrent = Number(await conn.command("INCR", "hubbie:conc"));
        await conn.command("PEXPIRE", "hubbie:conc", "300000");
        if (concurrent > RATE_LIMITS.concurrent) {
          await conn.command("DECR", "hubbie:conc").catch(() => null);
          return deny("concurrency_limit");
        }
        let released = false;
        return {
          ok: true as const,
          release: async () => {
            if (released) return;
            released = true;
            await this.withFallback(async () => {
              const releaseConn = await this.open();
              try { await releaseConn.command("DEL", busyKey); await releaseConn.command("DECR", "hubbie:conc"); }
              finally { releaseConn.close(); }
            }, async () => { /* Busy lock expires on its own within 120s. */ });
          },
        };
      } finally { conn.close(); }
    }, () => this.fallback.acquire(accountId));
  }
}

let singleton: AssistantRateLimiter | null = null;
export function getAssistantRateLimiter(env: NodeJS.ProcessEnv = process.env): AssistantRateLimiter {
  if (singleton) return singleton;
  const memory = new MemoryRateLimiter();
  const target = env.REDIS_URL?.trim() ? parseRedisUrl(env.REDIS_URL.trim()) : null;
  singleton = target ? new RedisRateLimiter(target, memory) : memory;
  return singleton;
}
