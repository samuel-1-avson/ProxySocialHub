import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_HEADERS, MAX_SKEW_MS, NonceCache, signRequest, verifyRequest } from "../src/auth.ts";

const secret = "s".repeat(40);
const owner = "11111111-2222-3333-4444-555555555555";

function signed(over: Partial<{ method: string; path: string; body: string; ts: number; nonce: string; owner: string }> = {}) {
  const ts = over.ts ?? Date.now();
  const nonce = over.nonce ?? `nonce-${Math.random().toString(16).slice(2)}-abcdef`;
  const body = over.body ?? '{"a":1}';
  const sig = signRequest(secret, { method: over.method ?? "POST", pathWithQuery: over.path ?? "/internal/v1/audits", owner: over.owner ?? owner, body, timestamp: ts, nonce });
  return {
    headers: { [AUTH_HEADERS.owner]: over.owner ?? owner, [AUTH_HEADERS.timestamp]: String(ts), [AUTH_HEADERS.nonce]: nonce, [AUTH_HEADERS.signature]: sig },
    body: Buffer.from(body),
  };
}

describe("signed internal requests", () => {
  it("accepts a valid signature and returns the owner", () => {
    const { headers, body } = signed();
    const r = verifyRequest(secret, headers, "POST", "/internal/v1/audits", body, new NonceCache());
    assert.deepEqual(r, { ok: true, ownerId: owner });
  });

  it("rejects a tampered body, path, method or owner", () => {
    const base = signed();
    const nonces = new NonceCache();
    assert.equal(verifyRequest(secret, base.headers, "POST", "/internal/v1/audits", Buffer.from('{"a":2}'), nonces).ok, false);
    assert.equal(verifyRequest(secret, signed().headers, "POST", "/internal/v1/audits/aud_000000000000/cancel", signed().body, nonces).ok, false);
    assert.equal(verifyRequest(secret, signed().headers, "GET", "/internal/v1/audits", signed().body, nonces).ok, false);
    const other = signed();
    other.headers[AUTH_HEADERS.owner] = "99999999-2222-3333-4444-555555555555";
    assert.equal(verifyRequest(secret, other.headers, "POST", "/internal/v1/audits", other.body, nonces).ok, false);
  });

  it("rejects the wrong secret and stale timestamps", () => {
    const { headers, body } = signed();
    assert.equal(verifyRequest("x".repeat(40), headers, "POST", "/internal/v1/audits", body, new NonceCache()).ok, false);
    const old = signed({ ts: Date.now() - MAX_SKEW_MS - 5000 });
    assert.equal(verifyRequest(secret, old.headers, "POST", "/internal/v1/audits", old.body, new NonceCache()).ok, false);
  });

  it("rejects a replayed nonce", () => {
    const { headers, body } = signed();
    const nonces = new NonceCache();
    assert.equal(verifyRequest(secret, headers, "POST", "/internal/v1/audits", body, nonces).ok, true);
    const again = verifyRequest(secret, headers, "POST", "/internal/v1/audits", body, nonces);
    assert.deepEqual(again, { ok: false, reason: "replayed request" });
  });

  it("does not consume nonces for invalid signatures", () => {
    const { headers, body } = signed({ nonce: "fixed-nonce-value-1234" });
    const nonces = new NonceCache();
    const bad = { ...headers, [AUTH_HEADERS.signature]: "00".repeat(32) };
    assert.equal(verifyRequest(secret, bad, "POST", "/internal/v1/audits", body, nonces).ok, false);
    assert.equal(verifyRequest(secret, headers, "POST", "/internal/v1/audits", body, nonces).ok, true);
  });

  it("rejects missing or malformed owner ids", () => {
    const { headers, body } = signed();
    const noOwner = { ...headers } as Record<string, string | undefined>;
    delete noOwner[AUTH_HEADERS.owner];
    assert.equal(verifyRequest(secret, noOwner, "POST", "/internal/v1/audits", body, new NonceCache()).ok, false);
    const weird = signed({ owner: "../../etc" });
    assert.equal(verifyRequest(secret, weird.headers, "POST", "/internal/v1/audits", weird.body, new NonceCache()).ok, false);
  });
});
