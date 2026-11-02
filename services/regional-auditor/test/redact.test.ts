import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactDeep, redactKnown, redactSecrets, sanitizeUrl, sanitizeVisibleText } from "../src/redact.ts";

describe("redaction", () => {
  it("masks tokens, bearer headers, session-intent credentials and emails", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz012345";
    const text = `token ${jwt} Authorization: Bearer abcdef1234567890abcdef session-intent:eyJabc.def.ghi contact me@example.com api_key=sk_live_1234567890abcdef`;
    const out = redactSecrets(text);
    assert.doesNotMatch(out, /eyJhbGci/);
    assert.doesNotMatch(out, /abcdef1234567890abcdef/);
    assert.doesNotMatch(out, /me@example\.com/);
    assert.doesNotMatch(out, /sk_live_1234567890abcdef/);
    assert.match(out, /\[email\]/);
  });

  it("masks card-like numbers and long opaque blobs but keeps ordinary prices", () => {
    const out = redactSecrets("Card 4111 1111 1111 1111, hash 0123456789abcdef0123456789abcdef0123, price GH₵ 149.00 for 12 users");
    assert.match(out, /\[number\]/);
    assert.match(out, /\[hex\]/);
    assert.match(out, /GH₵ 149\.00 for 12 users/);
  });

  it("removes exact known secrets, including URL-encoded forms", () => {
    const out = redactKnown("pw=s3cr3t+value&x=s3cr3t%2Bvalue", ["s3cr3t+value"]);
    assert.doesNotMatch(out, /s3cr3t/);
  });

  it("truncates visible text and applies redaction first", () => {
    const out = sanitizeVisibleText(`hello me@example.com ${"x ".repeat(5000)}`, 100);
    assert.ok(out.length <= 100);
    assert.doesNotMatch(out, /me@example\.com/);
  });

  it("strips userinfo, fragments and sensitive query values from URLs", () => {
    const out = sanitizeUrl("https://user:pw@shop.example.com/cb?code=abc123&token=xyz&page=2#frag");
    assert.doesNotMatch(out, /user|pw@|abc123|xyz|frag/);
    assert.match(out, /page=2/);
  });

  it("masks credential-looking keys deeply", () => {
    const out = redactDeep({ a: { password: "p", token: "t", ok: "fine", list: [{ apiKey: "k" }] } });
    assert.deepEqual(out, { a: { password: "[redacted]", token: "[redacted]", ok: "fine", list: [{ apiKey: "[redacted]" }] } });
  });
});
