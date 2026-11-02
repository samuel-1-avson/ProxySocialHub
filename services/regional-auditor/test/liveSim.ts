// A local stand-in for the LIVE transport: an HTTP CONNECT gateway that issues the same
// `407 Proxy-Authenticate: Basic realm="ProxyHub"` challenge the real testnet gateway does,
// per-region exits, and an HTTPS site with a real (throw-away, locally generated) certificate.
// It lets tests exercise Chromium -> CONNECT -> TLS -> page without any ProxyHubb session.
// Synthetic: every IP and "region" here is fabricated by the test.

import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";
import { startDemoTarget, type DemoTarget } from "../src/fixtures/demoTarget.ts";

export const SHOP_HOST = "shop.example.test";
export const ECHO_HOST = "echo.example.test";

export interface SimRegion {
  /** The password the gateway accepts for this exit (the "session-intent token"). */
  token: string;
  /** The IP this exit reports to the echo service. */
  ip: string;
}

export interface GatewayLogEntry {
  authenticated: boolean;
  host: string;
  status: number;
  region: string | null;
}

export interface LiveSim {
  gatewayEndpoint: string;
  spki: string;
  log: GatewayLogEntry[];
  target: DemoTarget;
  stop(): Promise<void>;
}

function findOpenssl(): string | null {
  for (const candidate of ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "/usr/bin/openssl"]) {
    try {
      execFileSync(candidate, ["version"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export const opensslAvailable = (): boolean => findOpenssl() !== null;

export async function startLiveSim(options: {
  regions: Record<string, SimRegion>;
  scenario?: string;
  /** When set, the gateway refuses CONNECT to any other host (what a signed intent's allowed_domains would do). */
  allowedHosts?: string[];
}): Promise<LiveSim> {
  const openssl = findOpenssl();
  if (!openssl) throw new Error("openssl is not available");
  const dir = mkdtempSync(path.join(tmpdir(), "auditor-livesim-"));
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  execFileSync(
    openssl,
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", `/CN=${SHOP_HOST}`, "-addext", `subjectAltName=DNS:${SHOP_HOST},DNS:${ECHO_HOST}`],
    { stdio: "ignore" },
  );
  const key = readFileSync(keyFile);
  const cert = readFileSync(certFile);
  const spkiDer = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  const spki = createHash("sha256").update(spkiDer).digest("base64");

  const target = await startDemoTarget({ scenario: options.scenario ?? "demo-v1" });
  const log: GatewayLogEntry[] = [];
  const fronts = new Map<string, { server: https.Server; port: number }>();

  // One TLS front per region: it plays "the exit", telling the demo site who is visiting and from which IP.
  for (const [region, info] of Object.entries(options.regions)) {
    const server = https.createServer({ key, cert }, (req, res) => {
      const upstream = http.request(
        { host: "127.0.0.1", port: target.port, path: req.url, method: req.method, headers: { ...req.headers, "x-fixture-region": region, "x-fixture-egress-ip": info.ip } },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", () => res.writeHead(502).end());
      req.pipe(upstream);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    fronts.set(region, { server, port: (server.address() as AddressInfo).port });
  }

  const challenge = (socket: Duplex) =>
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="ProxyHub"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');

  const gateway = http.createServer((_req, res) => res.writeHead(501).end("Only CONNECT supported; use HTTP CONNECT or SOCKS5"));
  gateway.on("connect", (req, socket) => {
    socket.on("error", () => undefined);
    const host = (req.url ?? "").split(":")[0] ?? "";
    const header = req.headers["proxy-authorization"];
    const decoded = typeof header === "string" && header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf8") : null;
    const at = decoded?.indexOf(":") ?? -1;
    const user = decoded && at >= 0 ? decoded.slice(0, at) : null;
    const pass = decoded && at >= 0 ? decoded.slice(at + 1) : null;
    // Session intents authenticate as "session-intent"; marketplace orders carry a per-session username.
    const region = user === "session-intent" || user?.startsWith("order-user-") ? (Object.entries(options.regions).find(([, r]) => r.token === pass)?.[0] ?? null) : null;

    if (!region) {
      log.push({ authenticated: Boolean(decoded), host, status: 407, region: null });
      return challenge(socket);
    }
    if (options.allowedHosts && !options.allowedHosts.includes(host)) {
      log.push({ authenticated: true, host, status: 403, region });
      return void socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
    if (host !== SHOP_HOST && host !== ECHO_HOST) {
      log.push({ authenticated: true, host, status: 502, region });
      return void socket.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    }
    log.push({ authenticated: true, host, status: 200, region });
    const upstream = net.connect(fronts.get(region)!.port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));

  return {
    gatewayEndpoint: `127.0.0.1:${(gateway.address() as AddressInfo).port}`,
    spki,
    log,
    target,
    async stop() {
      gateway.closeAllConnections();
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      for (const { server } of fronts.values()) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await target.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
