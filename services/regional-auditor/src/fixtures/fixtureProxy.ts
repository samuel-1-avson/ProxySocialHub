// Local authenticating HTTP proxy that stands in for a regional ProxyHubb exit
// in the fixture harness. DEVELOPMENT ONLY and plain-HTTP only: it forwards
// absolute-URI requests to the fixture demo origin and stamps them with the
// synthetic region and egress IP that the demo site reads. It exists so the
// fixture path exercises a real browser -> authenticated proxy -> site flow
// (including the 407 challenge), not to imitate the production gateway.

import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type RouteFault =
  | "wrong_country" // exit IP belongs to a different country than requested
  | "unknown_ip" // exit IP the GeoIP table cannot place
  | "rotate_after_first" // first probe is correct, later probes come from another country
  | "deny_auth"; // proxy refuses the credentials (no session available)

export interface FixtureRegion {
  country: string;
  egressIp: string;
  username: string;
  password: string;
}

export interface FixtureProxy {
  server: string;
  setFault(country: string, fault: RouteFault | null): void;
  close(): Promise<void>;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function parseBasic(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const at = decoded.indexOf(":");
  return at < 0 ? null : { user: decoded.slice(0, at), pass: decoded.slice(at + 1) };
}

export async function startFixtureProxy(options: {
  regions: FixtureRegion[];
  /** The only origin this proxy will forward to. */
  allowedOrigin: string;
  /** IPs used by wrong_country / unknown_ip / rotate faults. */
  decoyIps: { otherCountry: string; unknown: string };
}): Promise<FixtureProxy> {
  const faults = new Map<string, RouteFault>();
  const probeCounts = new Map<string, number>();
  const allowed = new URL(options.allowedOrigin);

  const challenge = (res: ServerResponse) => {
    res.writeHead(407, { "proxy-authenticate": 'Basic realm="fixture-proxy"', "content-type": "text/plain", connection: "close" });
    res.end("Proxy authentication required");
  };

  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    const creds = parseBasic(req.headers["proxy-authorization"] as string | undefined);
    const region = creds ? options.regions.find((r) => r.username === creds.user && safeEqual(r.password, creds.pass)) : undefined;
    if (!region || faults.get(region.country) === "deny_auth") return challenge(res);

    let target: URL;
    try {
      target = new URL(req.url ?? "");
    } catch {
      res.writeHead(400).end("Absolute-URI requests only");
      return;
    }
    if (target.origin !== allowed.origin) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Fixture proxy only forwards to the fixture site");
      return;
    }

    let egressIp = region.egressIp;
    const fault = faults.get(region.country);
    if (target.pathname === "/__egress") {
      const n = (probeCounts.get(region.country) ?? 0) + 1;
      probeCounts.set(region.country, n);
      const otherIp = options.regions.find((r) => r.country !== region.country)?.egressIp ?? options.decoyIps.otherCountry;
      if (fault === "wrong_country") egressIp = otherIp;
      if (fault === "unknown_ip") egressIp = options.decoyIps.unknown;
      if (fault === "rotate_after_first" && n > 1) egressIp = otherIp;
    }

    const headers = { ...req.headers };
    for (const h of ["proxy-authorization", "proxy-connection"]) delete headers[h];
    headers["x-fixture-region"] = region.country;
    headers["x-fixture-egress-ip"] = egressIp;
    headers.host = target.host;

    const upstream = http.request(
      { host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("Bad gateway");
    });
    req.pipe(upstream);
  };

  const server: Server = http.createServer(onRequest);
  // The fixture proxy is plain-HTTP only: it does not tunnel.
  server.on("connect", (_req, socket) => {
    socket.end("HTTP/1.1 501 Not Implemented\r\nContent-Length: 0\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    server: `http://127.0.0.1:${port}`,
    setFault(country, fault) {
      probeCounts.delete(country);
      if (fault) faults.set(country, fault);
      else faults.delete(country);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
