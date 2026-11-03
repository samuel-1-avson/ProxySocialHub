// Fetch one HTTPS page THROUGH a ProxyHubb exit, for agents that cannot use a
// proxy URL themselves (chat clients). Same CONNECT-then-TLS path as probe.ts,
// but byte-safe (real pages are chunked, compressed and non-ASCII) and bounded:
// HTTPS only, public hosts only, a size cap, a time cap and a redirect limit.
// The proxy credential is used for the CONNECT only and never appears in a result.
//
// Host checks here cover what the URL itself says. A public name that resolves to
// a private address is resolved on the exit side, where the gateway's destination
// guard applies (services/edge-gateway/src/proxy/destination_guard.rs).

import { request as httpRequest } from "node:http";
import { BlockList, isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { brotliDecompressSync, constants as zlib, gunzipSync, inflateSync } from "node:zlib";

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_DECODED_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set([443, 8443]);
const USER_AGENT = "ProxyHubb-MCP/0.1 (+https://proxyhubb.com)";

// Two lists on purpose: a BlockList also matches IPv4 addresses against IPv6 rules (as
// ::ffff:a.b.c.d), so one shared list with the mapped range would block every IPv4 address.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");
}
const INTERNAL_NAME = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/i;

export type TargetCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Only public https:// pages on 443/8443; never loopback, private, link-local or bare intranet names. */
export function checkTarget(raw: string | URL): TargetCheck {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw.trim()) : raw;
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https:// URLs can be fetched." };
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are refused." };
  if (url.href.length > 2048) return { ok: false, reason: "The URL is longer than 2048 characters." };
  const port = url.port ? Number(url.port) : 443;
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: `Port ${port} is not allowed (443 or 8443 only).` };
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const family = isIP(host);
  if (family === 4 && BLOCKED_V4.check(host, "ipv4")) return { ok: false, reason: "Private or reserved addresses are refused." };
  if (family === 6 && BLOCKED_V6.check(host, "ipv6")) return { ok: false, reason: "Private or reserved addresses are refused." };
  if (family === 0 && (!host.includes(".") || INTERNAL_NAME.test(host))) {
    return { ok: false, reason: "Internal host names are refused; use a public domain." };
  }
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// HTTP/1.1 response handling on bytes
// ---------------------------------------------------------------------------

export interface ParsedResponse {
  status: number | null;
  headers: Record<string, string>;
  body: Buffer;
}

function dechunk(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let i = 0;
  for (let guard = 0; guard < 100_000; guard++) {
    const nl = buf.indexOf("\r\n", i);
    if (nl < 0) break;
    const size = parseInt((buf.subarray(i, nl).toString("latin1").split(";")[0] ?? "").trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = nl + 2;
    const stop = Math.min(start + size, buf.length);
    parts.push(buf.subarray(start, stop));
    if (stop < start + size) break; // truncated mid-chunk: keep what arrived
    i = start + size + 2;
  }
  return Buffer.concat(parts);
}

export function parseHttpResponseBytes(raw: Buffer): ParsedResponse {
  const end = raw.indexOf("\r\n\r\n");
  if (end < 0) return { status: null, headers: {}, body: Buffer.alloc(0) };
  const lines = raw.subarray(0, end).toString("latin1").split("\r\n");
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(lines[0] ?? "");
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  let body = raw.subarray(end + 4);
  if (/\bchunked\b/i.test(headers["transfer-encoding"] ?? "")) body = dechunk(body);
  return { status: m ? Number(m[1]) : null, headers, body };
}

/**
 * Tracks whether a whole response has arrived, so a keep-alive server cannot hold us until the
 * timeout. Headers are parsed once; after that only byte counts and the stream's tail are checked.
 */
export class ResponseTracker {
  #head: Buffer = Buffer.alloc(0);
  #bodyStart = -1;
  #bodyBytes = 0;
  #mode: "none" | "length" | "chunked" | "close" = "close";
  #length = 0;
  #tail = "";

  /** Feed the next chunk; true once the response is complete. */
  push(chunk: Buffer): boolean {
    if (this.#bodyStart < 0) {
      this.#head = Buffer.concat([this.#head, chunk]);
      const end = this.#head.indexOf("\r\n\r\n");
      if (end < 0) return false;
      this.#bodyStart = end + 4;
      const head = this.#head.subarray(0, end).toString("latin1");
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0);
      const length = /\r\ncontent-length:\s*(\d+)/i.exec(head);
      if (status === 204 || status === 304 || (status >= 100 && status < 200)) this.#mode = "none";
      else if (/\r\ntransfer-encoding:[^\r\n]*\bchunked\b/i.test(head)) this.#mode = "chunked";
      else if (length) {
        this.#mode = "length";
        this.#length = Number(length[1]);
      }
      const rest = this.#head.subarray(this.#bodyStart);
      this.#head = Buffer.alloc(0);
      return this.#body(rest);
    }
    return this.#body(chunk);
  }

  #body(chunk: Buffer): boolean {
    this.#bodyBytes += chunk.length;
    if (this.#mode === "none") return true;
    if (this.#mode === "length") return this.#bodyBytes >= this.#length;
    if (this.#mode === "chunked") {
      this.#tail = (this.#tail + chunk.subarray(Math.max(0, chunk.length - 7)).toString("latin1")).slice(-7);
      return this.#tail.endsWith("\r\n0\r\n\r\n") || (this.#bodyBytes === 5 && this.#tail === "0\r\n\r\n");
    }
    return false;
  }
}

/** Undo Content-Encoding; partial (truncated) streams yield what decodes. Null for unknown encodings. */
export function decodeBody(body: Buffer, contentEncoding: string | undefined): Buffer | null {
  const enc = (contentEncoding ?? "").trim().toLowerCase();
  try {
    if (!enc || enc === "identity") return body;
    if (enc === "gzip" || enc === "x-gzip") {
      return gunzipSync(body, { finishFlush: zlib.Z_SYNC_FLUSH, maxOutputLength: MAX_DECODED_BYTES });
    }
    if (enc === "deflate") return inflateSync(body, { finishFlush: zlib.Z_SYNC_FLUSH, maxOutputLength: MAX_DECODED_BYTES });
    if (enc === "br") {
      return brotliDecompressSync(body, { finishFlush: zlib.BROTLI_OPERATION_FLUSH, maxOutputLength: MAX_DECODED_BYTES });
    }
  } catch {
    return null;
  }
  return null;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Readable text of an HTML page: no scripts, styles or tags; block elements become line breaks. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const input = html.length > MAX_BODY_BYTES ? html.slice(0, MAX_BODY_BYTES) : html;
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(input)?.[1];
  const title = rawTitle ? decodeEntities(rawTitle).replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
  const text = decodeEntities(
    input
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|nav|main|ul|ol|table|blockquote|pre|dd|dt)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export interface PageContent {
  contentType: string | null;
  title: string | null;
  /** Null for binary content, or when the body could not be decoded. */
  text: string | null;
  note: string | null;
}

/** Turn a fetched body into what an agent can read. */
export function readPage(headers: Record<string, string>, body: Buffer): PageContent {
  const contentType = headers["content-type"]?.slice(0, 120) ?? null;
  const decoded = decodeBody(body, headers["content-encoding"]);
  if (!decoded) return { contentType, title: null, text: null, note: `Could not decode the "${headers["content-encoding"]}" body.` };
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const isHtml = mime === "text/html" || mime === "application/xhtml+xml" || (!mime && /<html[\s>]/i.test(decoded.subarray(0, 2048).toString("latin1")));
  const isText = isHtml || mime.startsWith("text/") || /[/+](json|xml)$/.test(mime) || mime === "application/javascript";
  if (!isText) return { contentType, title: null, text: null, note: `Binary content (${mime || "unknown type"}) is not returned as text.` };
  const charset = /charset=["']?([\w.-]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
  let str: string;
  try {
    str = new TextDecoder(charset, { fatal: false }).decode(decoded);
  } catch {
    str = new TextDecoder("utf-8", { fatal: false }).decode(decoded);
  }
  if (isHtml) {
    const { title, text } = htmlToText(str);
    return { contentType, title, text, note: null };
  }
  return { contentType, title: null, text: str.trim(), note: null };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export type FetchStage = "invalid_input" | "proxy_connect" | "proxy_auth" | "tunnel" | "tls" | "response" | "redirect";

export interface FetchPageOptions {
  timeoutMs: number;
  maxBytes?: number;
  acceptLanguage?: string;
}

export type FetchPageResult =
  | {
      ok: true;
      finalUrl: string;
      redirects: string[];
      status: number;
      headers: Record<string, string>;
      body: Buffer;
      /** The body hit maxBytes and was cut off. */
      truncated: boolean;
      bytesReceived: number;
      elapsedMs: number;
    }
  | { ok: false; stage: FetchStage; message: string; redirects: string[] };

type OnceResult =
  | { ok: true; status: number; headers: Record<string, string>; body: Buffer; truncated: boolean; bytes: number }
  | { ok: false; stage: FetchStage; message: string };

function requestOnce(proxy: URL, target: URL, timeoutMs: number, maxBytes: number, acceptLanguage: string | undefined): Promise<OnceResult> {
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const port = Number(target.port) || 443;
  const auth = Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64");

  return new Promise((resolve) => {
    let settled = false;
    let connectRequest: ReturnType<typeof httpRequest> | null = null;
    const done = (result: OnceResult, cleanup?: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup?.();
      resolve(result);
    };
    const timer = setTimeout(() => {
      done({ ok: false, stage: "response", message: `No complete answer within ${Math.round(timeoutMs / 1000)}s.` }, () =>
        connectRequest?.destroy(),
      );
    }, timeoutMs);

    const refused = (status: number): OnceResult =>
      status === 407
        ? { ok: false, stage: "proxy_auth", message: "The gateway rejected the credentials (HTTP 407). The order's session may be expired or not yet routed." }
        : { ok: false, stage: "tunnel", message: `The gateway refused the tunnel (HTTP ${status}).` };

    connectRequest = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port) || 8090,
      method: "CONNECT",
      path: `${host.includes(":") ? `[${host}]` : host}:${port}`,
      headers: { host: `${host}:${port}`, "proxy-authorization": `Basic ${auth}` },
    });
    connectRequest.on("error", () => done({ ok: false, stage: "proxy_connect", message: "The gateway could not be reached." }));
    connectRequest.on("response", (res) => {
      res.resume();
      done(refused(res.statusCode ?? 0), () => connectRequest?.destroy());
    });
    connectRequest.on("connect", (res, socket) => {
      if (res.statusCode !== 200) return done(refused(res.statusCode ?? 0), () => socket.destroy());
      const tlsSocket = tlsConnect({ socket, servername: isIP(host) === 0 ? host : undefined, rejectUnauthorized: true });
      const chunks: Buffer[] = [];
      const tracker = new ResponseTracker();
      let size = 0;
      const finish = (truncated: boolean) => {
        const raw = Buffer.concat(chunks);
        const parsed = parseHttpResponseBytes(raw);
        if (parsed.status === null) {
          return done({ ok: false, stage: "response", message: "The site answered without a readable HTTP response." }, () => tlsSocket.destroy());
        }
        done({ ok: true, status: parsed.status, headers: parsed.headers, body: parsed.body, truncated, bytes: size }, () => tlsSocket.destroy());
      };
      tlsSocket.on("secureConnect", () => {
        tlsSocket.write(
          [
            `GET ${target.pathname || "/"}${target.search} HTTP/1.1`,
            `Host: ${target.host}`,
            `User-Agent: ${USER_AGENT}`,
            "Accept: text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            "Accept-Encoding: gzip, deflate, br",
            ...(acceptLanguage ? [`Accept-Language: ${acceptLanguage.replace(/[\r\n]/g, "").slice(0, 100)}`] : []),
            "Connection: close",
            "",
            "",
          ].join("\r\n"),
        );
      });
      tlsSocket.on("data", (chunk: Buffer) => {
        size += chunk.length;
        chunks.push(chunk);
        if (size > maxBytes) return finish(true);
        if (tracker.push(chunk)) finish(false);
      });
      tlsSocket.on("error", () => {
        if (chunks.length > 0) return finish(false);
        done({ ok: false, stage: "tls", message: "The TLS handshake with the site failed through the tunnel." }, () => socket.destroy());
      });
      tlsSocket.on("close", () => finish(false));
    });
    connectRequest.end();
  });
}

/** GET one page through an http:// proxy URL, following up to 5 redirects, each re-checked. */
export async function fetchThroughProxy(proxyUrl: string, target: URL, opts: FetchPageOptions): Promise<FetchPageResult> {
  const started = Date.now();
  const redirects: string[] = [];
  let proxy: URL;
  try {
    proxy = new URL(proxyUrl);
  } catch {
    return { ok: false, stage: "invalid_input", message: "The proxy URL is not valid.", redirects };
  }
  if (proxy.protocol !== "http:" || !proxy.hostname) {
    return { ok: false, stage: "invalid_input", message: "Only http:// (CONNECT) proxy URLs are supported.", redirects };
  }
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkTarget(current);
    if (!checked.ok) {
      return { ok: false, stage: hop ? "redirect" : "invalid_input", message: hop ? `Redirected to a refused URL: ${checked.reason}` : checked.reason, redirects };
    }
    const remaining = opts.timeoutMs - (Date.now() - started);
    if (remaining <= 0) return { ok: false, stage: "response", message: "Ran out of time following redirects.", redirects };
    const res = await requestOnce(proxy, current, remaining, maxBytes, opts.acceptLanguage);
    if (!res.ok) return { ...res, redirects };
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, stage: "redirect", message: "The site redirected to an invalid location.", redirects };
      }
      redirects.push(next.href);
      current = next;
      continue;
    }
    return {
      ok: true,
      finalUrl: current.href,
      redirects,
      status: res.status,
      headers: res.headers,
      body: res.body,
      truncated: res.truncated,
      bytesReceived: res.bytes,
      elapsedMs: Date.now() - started,
    };
  }
  return { ok: false, stage: "redirect", message: `The site redirected more than ${MAX_REDIRECTS} times.`, redirects };
}
