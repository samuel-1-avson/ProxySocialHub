// Internal HTTP API. Authenticated with signed requests from the web server;
// ownership is enforced on every audit and artifact read.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { NonceCache, verifyRequest } from "./auth.ts";
import type { AuditorConfig } from "./config.ts";
import { summarize, type AuditJob } from "./contracts.ts";
import { exportHtml, exportJson } from "./export.ts";
import type { FixtureHarness } from "./fixtures/harness.ts";
import { redactDeep } from "./redact.ts";
import type { AuditRunner } from "./runner.ts";
import { ARTIFACT_ID_RE, StaleRevisionError, type ArtifactStore, type JobStore } from "./store/types.ts";
import { AUDIT_ID_RE, HttpError, errorMessage } from "./util.ts";

export interface AppDeps {
  config: AuditorConfig;
  runner: AuditRunner;
  store: JobStore;
  artifacts: ArtifactStore;
  fixture: FixtureHarness | null;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

/** What a client may see of a job: no owner id, masked session references. */
export function toPublicJob(job: AuditJob) {
  const { ownerId: _owner, ...rest } = job;
  return {
    ...rest,
    captures: job.captures.map((c) => ({
      ...c,
      route: { ...c.route, sessionRef: c.route.sessionRef ? `${c.route.sessionRef.slice(0, 8)}…` : null },
    })),
  };
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > max) throw new HttpError(413, "payload_too_large", `Request body exceeds ${max} bytes.`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(payload);
}

function sendBytes(res: ServerResponse, status: number, type: string, bytes: Buffer | string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(bytes);
}

export function createApp(deps: AppDeps): Server {
  const { config, runner, store, artifacts } = deps;
  const nonces = new NonceCache();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", "http://auditor.local");
    const method = (req.method ?? "GET").toUpperCase();
    let status = 500;
    let ownerTag = "-";
    try {
      if (method === "GET" && url.pathname === "/healthz") {
        status = 200;
        return send(res, 200, { ok: true, service: "regional-auditor" });
      }
      if (!url.pathname.startsWith("/internal/v1/")) throw new HttpError(404, "not_found", "Not found.");
      if (!config.serviceSecret) throw new HttpError(503, "not_configured", "AUDITOR_SERVICE_SECRET is not configured.");

      const body = await readBody(req, config.limits.maxBodyBytes);
      const auth = verifyRequest(config.serviceSecret, req.headers, method, `${url.pathname}${url.search}`, body, nonces);
      if (!auth.ok) throw new HttpError(401, "unauthorized", "Request signature is not valid.");
      const ownerId = auth.ownerId;
      ownerTag = createHash("sha256").update(ownerId).digest("hex").slice(0, 8);

      const json = () => {
        if (body.length === 0) return {};
        try {
          return JSON.parse(body.toString("utf8")) as unknown;
        } catch {
          throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
        }
      };

      const parts = url.pathname.slice("/internal/v1/".length).split("/").filter(Boolean);

      // /capabilities
      if (method === "GET" && parts.length === 1 && parts[0] === "capabilities") {
        status = 200;
        return send(res, 200, runner.capabilities());
      }

      // /fixture/*  (development harness only)
      if (parts[0] === "fixture") {
        if (!deps.fixture) throw new HttpError(404, "not_found", "The fixture harness is not enabled.");
        if (method === "GET" && parts[1] === "scenarios") {
          status = 200;
          return send(res, 200, { current: deps.fixture.scenarioId(), scenarios: deps.fixture.scenarios() });
        }
        if (method === "POST" && parts[1] === "scenario") {
          const id = String((json() as { id?: unknown }).id ?? "");
          try {
            deps.fixture.setScenario(id);
          } catch {
            throw new HttpError(400, "unknown_scenario", "Unknown fixture scenario.");
          }
          status = 200;
          return send(res, 200, { current: deps.fixture.scenarioId() });
        }
        throw new HttpError(404, "not_found", "Not found.");
      }

      if (parts[0] !== "audits") throw new HttpError(404, "not_found", "Not found.");

      // /audits
      if (parts.length === 1) {
        if (method === "GET") {
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));
          const jobs = await store.list(ownerId, limit);
          status = 200;
          return send(res, 200, { audits: jobs.map(summarize) });
        }
        if (method === "POST") {
          const job = await runner.create(ownerId, json());
          status = 202;
          return send(res, 202, { audit: toPublicJob(job) });
        }
        throw new HttpError(405, "method_not_allowed", "Method not allowed.");
      }

      const id = parts[1]!;
      if (!AUDIT_ID_RE.test(id)) throw new HttpError(404, "not_found", "Audit not found.");

      // /audits/:id
      if (parts.length === 2) {
        if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Method not allowed.");
        const job = await store.getOwned(id, ownerId);
        if (!job) throw new HttpError(404, "not_found", "Audit not found.");
        status = 200;
        return send(res, 200, { audit: toPublicJob(job) });
      }

      const action = parts[2]!;
      if (method === "POST" && parts.length === 3) {
        let job: AuditJob;
        if (action === "cancel") job = await runner.cancel(ownerId, id);
        else if (action === "rerun") job = await runner.rerun(ownerId, id, json());
        else if (action === "replay") job = await runner.replay(ownerId, id);
        else if (action === "retry-analysis") job = await runner.retryAnalysis(ownerId, id);
        else throw new HttpError(404, "not_found", "Not found.");
        status = action === "cancel" ? 200 : 202;
        return send(res, status, { audit: toPublicJob(job) });
      }

      if (method === "GET" && action === "artifacts" && parts.length === 4) {
        const artifactId = decodeURIComponent(parts[3]!);
        if (!ARTIFACT_ID_RE.test(artifactId)) throw new HttpError(404, "not_found", "Artifact not found.");
        const job = await store.getOwned(id, ownerId);
        // Only artifacts the job's own evidence references are reachable.
        const referenced = job?.captures.some((c) => c.screenshots.some((s) => s.artifactId === artifactId));
        if (!job || !referenced) throw new HttpError(404, "not_found", "Artifact not found.");
        const bytes = await artifacts.get(id, artifactId);
        if (!bytes) throw new HttpError(404, "not_found", "Artifact not found.");
        status = 200;
        return sendBytes(res, 200, "image/png", bytes, { "content-disposition": `inline; filename="${artifactId}"` });
      }

      if (method === "GET" && action === "export" && parts.length === 3) {
        const job = await store.getOwned(id, ownerId);
        if (!job) throw new HttpError(404, "not_found", "Audit not found.");
        const format = url.searchParams.get("format") ?? "json";
        status = 200;
        if (format === "html") {
          const shots = new Map<string, Buffer>();
          for (const c of job.captures) {
            for (const s of c.screenshots) {
              const bytes = await artifacts.get(job.id, s.artifactId);
              if (bytes) shots.set(s.artifactId, bytes);
            }
          }
          return sendBytes(res, 200, "text/html; charset=utf-8", exportHtml(job, shots), { "content-disposition": `attachment; filename="regional-audit-${job.id}.html"` });
        }
        if (format !== "json") throw new HttpError(400, "invalid_format", "format must be json or html.");
        return sendBytes(res, 200, "application/json; charset=utf-8", JSON.stringify(exportJson(job), null, 2), {
          "content-disposition": `attachment; filename="regional-audit-${job.id}.json"`,
        });
      }

      throw new HttpError(404, "not_found", "Not found.");
    } catch (error) {
      if (error instanceof HttpError) {
        status = error.status;
        // An unread request body must not poison a keep-alive socket: close it after answering.
        const extra: Record<string, string> = error.status === 413 ? { connection: "close" } : {};
        if (error.status === 413) res.on("finish", () => req.destroy());
        send(res, error.status, { error: { code: error.code, message: error.message } }, extra);
      } else if (error instanceof ZodError) {
        status = 400;
        const issue = error.issues[0];
        send(res, 400, { error: { code: "invalid_request", message: `${issue?.path.join(".") || "request"}: ${issue?.message ?? "invalid"}` } });
      } else if (error instanceof StaleRevisionError) {
        status = 409;
        send(res, 409, { error: { code: "conflict", message: "The audit changed while it was being updated; retry." } });
      } else {
        status = 500;
        deps.log?.("unhandled_error", redactDeep({ message: errorMessage(error).slice(0, 300), path: url.pathname }));
        send(res, 500, { error: { code: "internal_error", message: "Internal error." } });
      }
    } finally {
      // Method, route, status, duration and a hashed owner tag only: never bodies or headers.
      deps.log?.("request", { method, path: url.pathname.replace(/aud_[0-9a-f]{12}/g, "aud_*"), status, ms: Date.now() - started, owner: ownerTag });
    }
  };

  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.requestTimeout = 30_000;
  // Keep idle sockets open longer than a pooled client (the web server's fetch) will reuse them,
  // otherwise the first request after a quiet period fails with ECONNRESET.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  return server;
}
