// Server-only: a real end-to-end proxy check.
//
// Opens an HTTP CONNECT tunnel through the buyer gateway with a session-intent
// token, performs a TLS handshake with certificate verification, requests the
// target and returns what it observed. Deliberately dependency-free (relative
// imports only) so it can be unit-tested with fake gateways.

import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { connect as tlsConnect, type ConnectionOptions } from "node:tls";

export type ProbeStage = "proxy_connect" | "proxy_auth" | "tunnel" | "tls" | "response";
export type ProbeResult =
  | { ok: true; ip: string; target: string; elapsedMs: number }
  | { ok: false; stage: ProbeStage; message: string };

export function parseIp(body: string): string | null {
  const text = body.trim();
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["ip", "origin", "query"]) {
      const value = json[key];
      const first = typeof value === "string" ? value.split(",")[0]!.trim() : "";
      if (first && isIP(first) !== 0) return first;
    }
    return null;
  } catch {
    return isIP(text) !== 0 ? text : null;
  }
}

/** Split an HTTP/1.1 response and decode a chunked body when present. */
export function parseHttpResponse(raw: string): { status: number | null; body: string } {
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(raw);
  const at = raw.indexOf("\r\n\r\n");
  if (at < 0) return { status: status ? Number(status[1]) : null, body: "" };
  const head = raw.slice(0, at);
  const body = raw.slice(at + 4);
  if (!/transfer-encoding:\s*chunked/i.test(head)) return { status: status ? Number(status[1]) : null, body };
  let out = "";
  let i = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const nl = body.indexOf("\r\n", i);
    if (nl < 0) break;
    const size = parseInt(body.slice(i, nl).split(";")[0]!, 16);
    if (!Number.isFinite(size) || size === 0) break;
    out += body.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2;
  }
  return { status: status ? Number(status[1]) : null, body: out };
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** Test hook: extra TLS options (for example a private CA). Certificates are always verified. */
  tls?: ConnectionOptions;
}

export function probeThroughGateway(endpoint: string, token: string, target: URL, options: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const started = Date.now();
  const [host, portText] = endpoint.split(":");
  const port = Number(portText) || 8090;
  const targetHost = target.hostname;
  const targetPort = Number(target.port) || 443;

  return new Promise((resolve) => {
    let settled = false;
    let connectRequest: ReturnType<typeof httpRequest> | null = null;
    const done = (result: ProbeResult, cleanup?: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup?.();
      resolve(result);
    };
    const timer = setTimeout(() => {
      done({ ok: false, stage: "tunnel", message: `No answer within ${Math.round(timeoutMs / 1000)}s.` }, () => connectRequest?.destroy());
    }, timeoutMs);

    connectRequest = httpRequest({
      host,
      port,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers: {
        host: `${targetHost}:${targetPort}`,
        "proxy-authorization": `Basic ${Buffer.from(`session-intent:${token}`).toString("base64")}`,
      },
    });
    connectRequest.on("error", () => done({ ok: false, stage: "proxy_connect", message: "The gateway could not be reached." }));
    // A non-200 answer to CONNECT arrives as a normal response, not a 'connect' event.
    connectRequest.on("response", (res) => {
      const status = res.statusCode ?? 0;
      res.resume();
      done(
        status === 407
          ? { ok: false, stage: "proxy_auth", message: "The gateway rejected the session credentials (HTTP 407). The session may be expired, unfunded or not yet routed." }
          : { ok: false, stage: "tunnel", message: `The gateway refused the tunnel (HTTP ${status}).` },
        () => connectRequest?.destroy(),
      );
    });
    // Node delivers every answer to a CONNECT request through 'connect', including refusals.
    connectRequest.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        return done(
          res.statusCode === 407
            ? { ok: false, stage: "proxy_auth", message: "The gateway rejected the session credentials (HTTP 407). The session may be expired, unfunded or not yet routed." }
            : { ok: false, stage: "tunnel", message: `The gateway refused the tunnel (HTTP ${res.statusCode}).` },
          () => socket.destroy(),
        );
      }
      const tlsSocket = tlsConnect({ ...options.tls, socket, servername: targetHost, rejectUnauthorized: true });
      const chunks: Buffer[] = [];
      let size = 0;
      tlsSocket.on("secureConnect", () => {
        tlsSocket.write(`GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`);
      });
      tlsSocket.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32_768) return done({ ok: false, stage: "response", message: "The echo service answered with too much data." }, () => tlsSocket.destroy());
        chunks.push(chunk);
      });
      tlsSocket.on("error", () => done({ ok: false, stage: "tls", message: "The TLS handshake with the target failed through the tunnel." }, () => socket.destroy()));
      tlsSocket.on("close", () => {
        const { status, body } = parseHttpResponse(Buffer.concat(chunks).toString("utf8"));
        const ip = parseIp(body);
        if (status === 200 && ip) done({ ok: true, ip, target: targetHost, elapsedMs: Date.now() - started });
        else done({ ok: false, stage: "response", message: `The target answered ${status ?? "with no HTTP response"} and no usable IP was found.` });
      });
    });
    connectRequest.end();
  });
}
