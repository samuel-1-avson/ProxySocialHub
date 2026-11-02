import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAssurance, isSatelliteNetwork } from "../src/geo.ts";
import { parseEchoIp, parseHttpResponse, probeThroughProxy } from "../src/probe.ts";
import { maskProxyUrl, redact } from "../src/redact.ts";

describe("assurance", () => {
  const geo = (country: string | null) => ({ country, source: "test", lookedUpAt: null, note: null });

  it("mismatch when the estimate says another country", () => {
    const r = evaluateAssurance({ requestedCountry: "GH", observedIp: "203.0.113.1", geoip: geo("US") });
    assert.equal(r.assurance, "mismatch");
  });

  it("unverified (never verified) when no country estimate exists", () => {
    const r = evaluateAssurance({ requestedCountry: "GH", observedIp: "203.0.113.1", geoip: geo(null) });
    assert.equal(r.assurance, "unverified");
  });

  it("unavailable when no egress was observed", () => {
    const r = evaluateAssurance({ requestedCountry: "GH", observedIp: null, geoip: null });
    assert.equal(r.assurance, "unavailable");
  });

  it("direct_egress when the exit equals our own IP (bypass)", () => {
    const r = evaluateAssurance({
      requestedCountry: "GH",
      observedIp: "198.51.100.9",
      geoip: geo("GH"),
      ownDirectIp: "198.51.100.9",
    });
    assert.equal(r.assurance, "direct_egress");
  });

  it("unverified (never verified) on a satellite network, even when the estimate matches", () => {
    const r = evaluateAssurance({
      requestedCountry: "US",
      observedIp: "98.97.0.1",
      geoip: { ...geo("US"), network: "Space Exploration Technologies Corporation (AS14593)", satellite: true },
    });
    assert.equal(r.assurance, "unverified");
    assert.match(r.reason, /satellite network/);
  });

  it("recognises satellite operators but not ordinary ISPs", () => {
    assert.equal(isSatelliteNetwork({ asn: 14593, isp: "SpaceX Services, Inc." }), true);
    assert.equal(isSatelliteNetwork({ isp: "Space Exploration Technologies Corporation" }), true);
    assert.equal(isSatelliteNetwork({ asn: 15169, isp: "Google LLC" }), false);
    assert.equal(isSatelliteNetwork(null), false);
  });
});

describe("probe parsing", () => {
  it("extracts IPs from JSON, httpbin-style origins and plain text", () => {
    assert.equal(parseEchoIp('{"ip":"203.0.113.5"}'), "203.0.113.5");
    assert.equal(parseEchoIp('{"origin":"203.0.113.5, 10.0.0.1"}'), "203.0.113.5");
    assert.equal(parseEchoIp("203.0.113.5\n"), "203.0.113.5");
    assert.equal(parseEchoIp('{"ip":"not-an-ip"}'), null);
    assert.equal(parseEchoIp(""), null);
  });

  it("decodes chunked HTTP bodies", () => {
    const raw = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
    const { status, body } = parseHttpResponse(raw);
    assert.equal(status, 200);
    assert.equal(body, "hello world");
  });

  it("rejects non-HTTP proxies and non-HTTPS targets without dialing", async () => {
    const a = await probeThroughProxy("socks5://u:p@h:1080", new URL("https://echo.test/"));
    assert.equal(a.ok, false);
    const b = await probeThroughProxy("http://u:p@h:8090", new URL("http://echo.test/"));
    assert.equal(b.ok, false);
  });
});

describe("redaction", () => {
  it("strips credential and PII keys at any depth", () => {
    const out = redact({ a: 1, token: "x", nested: { password: "y", keep: true }, email: "a@b.c" });
    assert.deepEqual(out, { a: 1, nested: { keep: true } });
  });

  it("masks proxy passwords for logs", () => {
    assert.equal(maskProxyUrl("http://session-intent:secret@h:8090"), "http://session-intent:***@h:8090/");
  });
});
