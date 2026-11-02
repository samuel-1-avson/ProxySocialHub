// Observe the real egress IP through a proxy URL: HTTP CONNECT through the
// gateway, certificate-verified TLS to a fixed echo target, parse the IP.
// Dependency-free, adapted from apps/web/src/lib/server/proxy-probe.ts and
// generalised from session-intent tokens to any http://user:pass@host:port
// proxy URL. Credentials are used for the CONNECT only — never logged here.

import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";

export type ProbeStage = "proxy_connect" | "proxy_auth" | "tunnel" | "tls" | "response" | "invalid_input";
export type ProbeResult =
  | { ok: true; ip: string; targetHost: string; elapsedMs: number }
  | { ok: false; stage: ProbeStage; message: string };

export function parseEchoIp(body: string): string | null {
  const text = body.trim();
  if (!text || text.length > 2000) return null;
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["ip", "origin", "query", "address", "ipAddress"]) {
      const v = json[key];
      const first = typeof v === "string" ? (v.split(",")[0] ?? "").trim() : "";
      if (first && isIP(first) !== 0) return first;
    }
    return null;
  } catch {
    return isIP(text) !== 0 ? text : null;
  }
}

export function parseHttpResponse(raw: string): { status: number | null; body: string } {
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(raw);
  const status = m ? Number(m[1]) : null;
  const at = raw.indexOf("\r\n\r\n");
  if (at < 0) return { status, body: "" };
  const head = raw.slice(0, at);
  const body = raw.slice(at + 4);
  if (!/transfer-encoding:\s*chunked/i.test(head)) return { status, body };
  let out = "";
  let i = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const nl = body.indexOf("\r\n", i);
    if (nl < 0) break;
    const size = parseInt((body.slice(i, nl).split(";")[0] ?? "").trim(), 16);
    if (!Number.isFinite(size) || size === 0) break;
    out += body.slice(nl + 2, nl + 2 + size);
    i = nl + 2 + size + 2;
  }
  return { status, body: out };
}

export function probeThroughProxy(proxyUrl: string, target: URL, timeoutMs = 15_000): Promise<ProbeResult> {
  let proxy: URL;
  try {
    proxy = new URL(proxyUrl);
  } catch {
    return Promise.resolve({ ok: false, stage: "invalid_input", message: "proxy_url is not a valid URL." });
  }
  if (proxy.protocol !== "http:" || !proxy.hostname) {
    return Promise.resolve({
      ok: false,
      stage: "invalid_input",
      message: "proxy_url must be an http:// proxy URL (CONNECT gateway). SOCKS URLs cannot be probed here.",
    });
  }
  if (target.protocol !== "https:") {
    return Promise.resolve({ ok: false, stage: "invalid_input", message: "The echo target must be HTTPS." });
  }

  const started = Date.now();
  const targetHost = target.hostname;
  const targetPort = Number(target.port) || 443;
  const auth = Buffer.from(
    `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
  ).toString("base64");

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
      done(
        { ok: false, stage: "tunnel", message: `No answer within ${Math.round(timeoutMs / 1000)}s.` },
        () => connectRequest?.destroy(),
      );
    }, timeoutMs);

    connectRequest = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port) || 8090,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers: { host: `${targetHost}:${targetPort}`, "proxy-authorization": `Basic ${auth}` },
    });
    connectRequest.on("error", () =>
      done({ ok: false, stage: "proxy_connect", message: "The gateway could not be reached." }),
    );
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
    connectRequest.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        return done(
          res.statusCode === 407
            ? { ok: false, stage: "proxy_auth", message: "The gateway rejected the session credentials (HTTP 407). The session may be expired, unfunded or not yet routed." }
            : { ok: false, stage: "tunnel", message: `The gateway refused the tunnel (HTTP ${res.statusCode}).` },
          () => socket.destroy(),
        );
      }
      const tlsSocket = tlsConnect({ socket, servername: targetHost, rejectUnauthorized: true });
      const chunks: Buffer[] = [];
      let size = 0;
      tlsSocket.on("secureConnect", () => {
        tlsSocket.write(
          `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`,
        );
      });
      tlsSocket.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 32_768) {
          return done({ ok: false, stage: "response", message: "The echo service answered with too much data." }, () =>
            tlsSocket.destroy(),
          );
        }
        chunks.push(chunk);
      });
      tlsSocket.on("error", () =>
        done({ ok: false, stage: "tls", message: "The TLS handshake with the echo target failed through the tunnel." }, () =>
          socket.destroy(),
        ),
      );
      tlsSocket.on("close", () => {
        const { status, body } = parseHttpResponse(Buffer.concat(chunks).toString("utf8"));
        const ip = parseEchoIp(body);
        if (status === 200 && ip) done({ ok: true, ip, targetHost, elapsedMs: Date.now() - started });
        else
          done({
            ok: false,
            stage: "response",
            message: `The echo target answered ${status ?? "with no HTTP response"} and no usable IP was found.`,
          });
      });
    });
    connectRequest.end();
  });
}

/** Learn this process's own direct egress IP (best effort) to detect proxy bypass. */
export async function learnOwnDirectIp(echoUrl: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(echoUrl, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return parseEchoIp(await res.text());
  } catch {
    return null;
  }
}
