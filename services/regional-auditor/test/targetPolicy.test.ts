import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateRequest, isBlockedHostname, isBlockedIp, validateTargetUrl } from "../src/targetPolicy.ts";

const allowed = ["https://shop.example.com"];
const opts = { allowedOrigins: allowed };

describe("isBlockedIp", () => {
  const blocked = [
    "127.0.0.1", "127.8.9.10", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "203.0.113.9",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "::ffff:169.254.169.254",
    "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "[::1]",
  ];
  const publicIps = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"];

  for (const ip of blocked) it(`blocks ${ip}`, () => assert.equal(isBlockedIp(ip), true));
  for (const ip of publicIps) it(`allows ${ip}`, () => assert.equal(isBlockedIp(ip), false));
  it("blocks unparseable input rather than allowing it", () => assert.equal(isBlockedIp("not-an-ip"), true));
});

describe("isBlockedHostname", () => {
  for (const host of ["localhost", "app.localhost", "printer.local", "metadata.google.internal", "db.internal", "intranet", "x.corp"]) {
    it(`blocks ${host}`, () => assert.equal(isBlockedHostname(host), true));
  }
  it("allows a normal public name", () => assert.equal(isBlockedHostname("shop.example.com"), false));
});

describe("validateTargetUrl", () => {
  it("accepts an authorized https origin", () => {
    const r = validateTargetUrl("https://shop.example.com/signup?x=1", opts);
    assert.equal(r.ok, true);
  });
  it("rejects non-https schemes", () => {
    for (const u of ["http://shop.example.com/", "ftp://shop.example.com/", "file:///etc/passwd", "javascript:alert(1)"]) {
      const r = validateTargetUrl(u, opts);
      assert.equal(r.ok, false, u);
    }
  });
  it("rejects embedded credentials", () => {
    const r = validateTargetUrl("https://user:pw@shop.example.com/", opts);
    assert.deepEqual(r.ok === false && r.code, "credentials_in_url");
  });
  it("rejects loopback, private, metadata and encoded IP forms", () => {
    const targets = [
      "https://127.0.0.1/", "https://localhost/", "https://[::1]/", "https://10.1.2.3/", "https://169.254.169.254/latest/meta-data/",
      "https://[::ffff:127.0.0.1]/", "https://2130706433/", "https://0x7f.0.0.1/", "https://017700000001/", "https://metadata.google.internal/",
    ];
    for (const t of targets) assert.equal(validateTargetUrl(t, { allowedOrigins: [...allowed, "https://127.0.0.1", "https://localhost"] }).ok, false, t);
  });
  it("rejects an origin that is not on the authorized list, even if public", () => {
    const r = validateTargetUrl("https://evil.example.org/", opts);
    assert.equal(r.ok === false && r.code, "origin_not_authorized");
  });
  it("is not fooled by lookalike hosts or ports", () => {
    assert.equal(validateTargetUrl("https://shop.example.com.evil.test/", opts).ok, false);
    assert.equal(validateTargetUrl("https://shop.example.com:8443/", opts).ok, false);
    assert.equal(validateTargetUrl("https://shop.example.com@evil.test/", opts).ok, false);
  });
  it("allows only the explicit fixture origin over plain http", () => {
    const fx = { allowedOrigins: [], fixtureOrigins: ["http://127.0.0.1:4031"] };
    assert.equal(validateTargetUrl("http://127.0.0.1:4031/", fx).ok, true);
    assert.equal(validateTargetUrl("http://127.0.0.1:4032/", fx).ok, false);
    assert.equal(validateTargetUrl("http://127.0.0.1:4031/", { allowedOrigins: [] }).ok, false);
  });
});

describe("evaluateRequest (every browser request)", () => {
  const ctx = { allowedOrigins: new Set(["https://shop.example.com", "https://cdn.example.net"]), allowNonReadOnly: false };

  it("allows GET to approved origins and data URLs", () => {
    assert.equal(evaluateRequest("https://shop.example.com/app.js", "GET", ctx).ok, true);
    assert.equal(evaluateRequest("https://cdn.example.net/x.png", "get", ctx).ok, true);
    assert.equal(evaluateRequest("data:image/png;base64,AAAA", "GET", ctx).ok, true);
  });
  it("blocks redirects or subresources to unapproved hosts", () => {
    const r = evaluateRequest("https://tracker.example.org/p.gif", "GET", ctx);
    assert.equal(r.ok === false && r.code, "origin_not_authorized");
  });
  it("blocks private destinations even when someone allow-lists them", () => {
    const c = { ...ctx, allowedOrigins: new Set(["https://169.254.169.254", "https://10.0.0.1"]) };
    assert.equal(evaluateRequest("https://169.254.169.254/latest/meta-data/", "GET", c).ok, false);
    assert.equal(evaluateRequest("https://10.0.0.1/admin", "GET", c).ok, false);
  });
  it("blocks http downgrade and non-read-only methods", () => {
    assert.equal(evaluateRequest("http://shop.example.com/", "GET", ctx).ok, false);
    const post = evaluateRequest("https://shop.example.com/api/checkout", "POST", ctx);
    assert.equal(post.ok === false && post.code, "method_not_allowed");
    assert.equal(evaluateRequest("https://shop.example.com/api/q", "POST", { ...ctx, allowNonReadOnly: true }).ok, true);
  });
});
