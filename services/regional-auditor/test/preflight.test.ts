import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { liveReady, runPreflight, type PreflightCheck } from "../src/preflight.ts";
import { jsonResponse, testConfig } from "./helpers.ts";

/** A TCP server that answers the first request with a canned HTTP response, like a CONNECT gateway would. */
async function fakeGateway(response: string): Promise<{ endpoint: string; close: () => void }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.once("data", () => socket.end(response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

const find = (checks: PreflightCheck[], id: string) => checks.find((c) => c.id === id)!;

function stubFetch(over: { facets?: unknown; modelStatus?: number } = {}) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/models/")) return jsonResponse(over.modelStatus ?? 200, { id: "muse-spark-1.3" });
    if (url.includes("/v1/listings/facets")) return jsonResponse(200, over.facets ?? { countries: [{ value: "GH", count: 2 }, { value: "US", count: 1 }] });
    if (url.includes("echo.test")) return new Response('{"ip":"203.0.113.9"}', { status: 200 });
    return new Response("<html>ok</html>", { status: 200 });
  }) as unknown as typeof fetch;
}

const BASIC_407 = 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="ProxyHub"\r\nContent-Length: 0\r\n\r\n';

describe("live preflight", () => {
  it("names every missing live prerequisite by variable and is not ready", async () => {
    const config = testConfig({ AUDITOR_SERVICE_SECRET: "", MODEL_API_KEY: "" });
    const checks = await runPreflight(config, { fetchImpl: stubFetch(), skipBrowser: true });
    assert.match(find(checks, "secret").detail, /AUDITOR_SERVICE_SECRET/);
    assert.match(find(checks, "gateway").detail, /AUDITOR_PROXY_ENDPOINT/);
    assert.match(find(checks, "targets").detail, /AUDITOR_ALLOWED_TARGET_ORIGINS/);
    assert.equal(find(checks, "model").status, "warn");
    assert.match(find(checks, "model").detail, /MODEL_API_KEY/);
    assert.equal(liveReady(checks), false);
  });

  it("accepts a gateway that issues the Basic 407 challenge, and reports a valid setup as ready", async () => {
    const gw = await fakeGateway(BASIC_407);
    try {
      const config = testConfig({
        AUDITOR_PROXY_ENDPOINT: gw.endpoint,
        AUDITOR_ALLOWED_TARGET_ORIGINS: "https://93.184.216.34",
        AUDITOR_EGRESS_ECHO_URL: "https://echo.test/ip",
        AUDITOR_GEOIP_PROVIDER: "none",
        AUDITOR_DATA_DIR: "./.data/preflight-test",
      });
      const checks = await runPreflight(config, { fetchImpl: stubFetch(), skipBrowser: true, apiUrl: "https://api.test", regions: ["GH", "US"] });
      assert.equal(find(checks, "gateway").status, "ok");
      assert.match(find(checks, "gateway").detail, /does not prove a session will work/);
      assert.equal(find(checks, "model").status, "ok");
      assert.equal(find(checks, "regions").status, "ok");
      assert.match(find(checks, "regions").detail, /provider claims/);
      // Without GeoIP the audit would refuse to interpret anything, so that must not look healthy.
      assert.equal(find(checks, "geoip").status, "warn");
      assert.equal(liveReady(checks), true);
    } finally {
      gw.close();
    }
  });

  it("rejects an endpoint that tunnels without credentials or does not speak CONNECT", async () => {
    const open = await fakeGateway("HTTP/1.1 200 Connection Established\r\n\r\n");
    const notProxy = await fakeGateway("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
    try {
      const base = { AUDITOR_ALLOWED_TARGET_ORIGINS: "https://93.184.216.34", AUDITOR_EGRESS_ECHO_URL: "https://echo.test/ip", AUDITOR_GEOIP_PROVIDER: "none" };
      const a = await runPreflight(testConfig({ ...base, AUDITOR_PROXY_ENDPOINT: open.endpoint }), { fetchImpl: stubFetch(), skipBrowser: true });
      assert.equal(find(a, "gateway").status, "fail");
      assert.match(find(a, "gateway").detail, /no credentials/);
      const b = await runPreflight(testConfig({ ...base, AUDITOR_PROXY_ENDPOINT: notProxy.endpoint }), { fetchImpl: stubFetch(), skipBrowser: true });
      assert.equal(find(b, "gateway").status, "fail");
      const c = await runPreflight(testConfig({ ...base, AUDITOR_PROXY_ENDPOINT: "127.0.0.1:1" }), { fetchImpl: stubFetch(), skipBrowser: true });
      assert.equal(find(c, "gateway").status, "fail");
    } finally {
      open.close();
      notProxy.close();
    }
  });

  it("flags a requested region that no active listing declares, and a rejected API key", async () => {
    const config = testConfig({ AUDITOR_PROXY_ENDPOINT: "127.0.0.1:1", AUDITOR_ALLOWED_TARGET_ORIGINS: "https://93.184.216.34", AUDITOR_GEOIP_PROVIDER: "none" });
    const checks = await runPreflight(config, { fetchImpl: stubFetch({ facets: { countries: [{ value: "US", count: 1 }] }, modelStatus: 401 }), skipBrowser: true, apiUrl: "https://api.test", regions: ["GH", "US"] });
    assert.equal(find(checks, "regions").status, "fail");
    assert.match(find(checks, "regions").detail, /no active listing is declared for GH/);
    assert.equal(find(checks, "model").status, "fail");
    assert.match(find(checks, "model").detail, /rejected/);
  });

  it("never prints secrets", async () => {
    const config = testConfig({ AUDITOR_PROXY_ENDPOINT: "127.0.0.1:1", AUDITOR_ALLOWED_TARGET_ORIGINS: "https://93.184.216.34", AUDITOR_GEOIP_PROVIDER: "none" });
    const checks = await runPreflight(config, { fetchImpl: stubFetch(), skipBrowser: true });
    const text = JSON.stringify(checks);
    assert.doesNotMatch(text, /test-key-do-not-use/);
    assert.doesNotMatch(text, new RegExp("t".repeat(40)));
  });
});
