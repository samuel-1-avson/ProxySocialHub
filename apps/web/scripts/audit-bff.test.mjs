// Tests for the audit BFF primitives that do not need a running server.
// Run: node --test scripts/audit-bff.test.mjs
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { NonceCache, verifyRequest } from "../../../services/regional-auditor/src/auth.ts";
import { verifyJwt } from "../src/lib/server/audit-auth.ts";
import { signAuditorRequest } from "../src/lib/server/audit-signature.ts";

const secret = "w".repeat(48);
const owner = "11111111-aaaa-4aaa-8aaa-111111111111";

test("a request signed by the web server verifies in the worker, and tampering does not", () => {
  const body = JSON.stringify({ request: { regions: ["GH"] } });
  const ts = Date.now();
  const nonce = randomBytes(12).toString("hex");
  const path = "/internal/v1/audits?limit=5";
  const sig = signAuditorRequest(secret, { method: "POST", pathWithQuery: path, owner, body, timestamp: ts, nonce });
  const headers = { "x-auditor-owner": owner, "x-auditor-ts": String(ts), "x-auditor-nonce": nonce, "x-auditor-sig": sig };
  assert.deepEqual(verifyRequest(secret, headers, "POST", path, Buffer.from(body), new NonceCache()), { ok: true, ownerId: owner });
  assert.equal(verifyRequest(secret, headers, "POST", path, Buffer.from(body + " "), new NonceCache()).ok, false);
  assert.equal(verifyRequest(secret, headers, "GET", path, Buffer.from(body), new NonceCache()).ok, false);
  assert.equal(verifyRequest(secret, headers, "POST", "/internal/v1/audits", Buffer.from(body), new NonceCache()).ok, false);
});

function jwt(payload, key = "j".repeat(64), alg = "HS256") {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg, typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", key).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
const future = Math.floor(Date.now() / 1000) + 600;

test("verifyJwt accepts only a correctly signed, unexpired, correctly issued HS256 token", () => {
  const key = "j".repeat(64);
  assert.equal(verifyJwt(jwt({ sub: owner, iss: "proxyhubb-control-api", exp: future }), key)?.sub, owner);
  assert.equal(verifyJwt(jwt({ sub: owner, exp: future }), key)?.sub, owner, "iss is only enforced when present, like the middleware");
  assert.equal(verifyJwt(jwt({ sub: owner, exp: future }, "x".repeat(64)), key), null, "wrong key");
  assert.equal(verifyJwt(jwt({ sub: owner, exp: Math.floor(Date.now() / 1000) - 5 }), key), null, "expired");
  assert.equal(verifyJwt(jwt({ sub: owner, iss: "someone-else", exp: future }), key), null, "wrong issuer");
  assert.equal(verifyJwt(jwt({ sub: owner, exp: future }, key, "none"), key), null, "alg must be HS256");
  assert.equal(verifyJwt("a.b", key), null);
  assert.equal(verifyJwt("", key), null);
});
