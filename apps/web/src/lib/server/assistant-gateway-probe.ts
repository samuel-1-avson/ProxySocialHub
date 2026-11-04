// Server-only: a credential-free admission check of the buyer proxy gateway.
//
// Sends an unauthenticated HTTP CONNECT to a fixed target. A healthy gateway
// answers 407 (proxy authentication required) before any tunnel exists, so no
// session is created, no credentials are handled, and no traffic flows. This
// proves the gateway process answers admission requests; it does NOT verify
// the caller's session, any provider, or an exit location. The authenticated
// end-to-end check stays in /api/proxy/test (lib/server/proxy-probe.ts).

import { connect, type Socket } from "node:net";

export interface GatewayProbeResult {
  reachable: boolean;
  /** HTTP status the gateway returned to the unauthenticated CONNECT, if any. */
  httpStatus: number | null;
  /** True when the gateway demanded proxy authentication (the expected 407). */
  authRequired: boolean;
  endpoint: string;
  elapsedMs: number;
}

export function gatewayEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PROXYHUBB_PROXY_ENDPOINT?.trim() || env.NEXT_PUBLIC_PROXY_ENDPOINT?.trim() || "localhost:8090").replace(/^https?:\/\//, "");
}

const PROBE_TARGET = "api.ipify.org:443";

export function probeGatewayAdmission(endpoint: string, options: { timeoutMs?: number; signal?: AbortSignal; connectImpl?: typeof connect } = {}): Promise<GatewayProbeResult> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const started = Date.now();
  const [host, portText] = endpoint.split(":");
  const port = Number(portText) || 8090;
  const base = { endpoint, elapsedMs: 0 };
  return new Promise((resolve) => {
    let settled = false;
    let socket: Socket | null = null;
    const done = (result: Omit<GatewayProbeResult, "elapsedMs" | "endpoint">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      socket?.destroy();
      resolve({ ...base, ...result, elapsedMs: Date.now() - started });
    };
    const timer = setTimeout(() => done({ reachable: false, httpStatus: null, authRequired: false }), timeoutMs);
    const onAbort = () => done({ reachable: false, httpStatus: null, authRequired: false });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) return onAbort();

    try {
      socket = (options.connectImpl ?? connect)({ host, port });
    } catch {
      return done({ reachable: false, httpStatus: null, authRequired: false });
    }
    let raw = "";
    socket.on("error", () => done({ reachable: false, httpStatus: null, authRequired: false }));
    socket.on("connect", () => {
      socket?.write(`CONNECT ${PROBE_TARGET} HTTP/1.1\r\nHost: ${PROBE_TARGET}\r\nProxy-Connection: close\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString("latin1");
      if (raw.length > 4096) return done({ reachable: true, httpStatus: null, authRequired: false });
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(raw);
      if (status) {
        const code = Number(status[1]);
        done({ reachable: true, httpStatus: code, authRequired: code === 407 });
      }
    });
    socket.on("close", () => done({ reachable: raw.length > 0, httpStatus: null, authRequired: false }));
  });
}
