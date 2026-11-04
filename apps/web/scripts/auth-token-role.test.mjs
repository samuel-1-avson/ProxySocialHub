// Run: node --test scripts/auth-token-role.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeJwtPayload, isTokenRoleStale } from "../src/lib/auth-token-role.ts";

function token(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

test("a buyer token is stale once the account became a provider", () => {
  assert.equal(isTokenRoleStale(token({ sub: "u1", role: "user" }), "provider"), true);
});

test("a token with the account's current role is not stale", () => {
  assert.equal(isTokenRoleStale(token({ role: "provider" }), "provider"), false);
  assert.equal(isTokenRoleStale(token({ role: " Provider " }), "provider"), false);
});

test("a demoted account's provider token is stale too", () => {
  assert.equal(isTokenRoleStale(token({ role: "provider" }), "user"), true);
});

test("unknown on either side never asks for a reissue", () => {
  assert.equal(isTokenRoleStale(null, "provider"), false);
  assert.equal(isTokenRoleStale("", "provider"), false);
  assert.equal(isTokenRoleStale("not-a-jwt", "provider"), false);
  assert.equal(isTokenRoleStale(token({ sub: "u1" }), "provider"), false);
  assert.equal(isTokenRoleStale(token({ role: "user" }), undefined), false);
  assert.equal(isTokenRoleStale(token({ role: "user" }), ""), false);
  assert.equal(isTokenRoleStale(token({ role: "user" }), 42), false);
});

test("decodeJwtPayload reads base64url payloads and rejects junk", () => {
  // This note's encoding contains "-" and "_", the characters base64url uses instead of "+" and "/".
  const payload = { role: "provider", note: "~~~???>>>" };
  assert.deepEqual(decodeJwtPayload(token(payload)), payload);
  assert.equal(decodeJwtPayload("a.b"), null);
  assert.equal(decodeJwtPayload("a.!!!.c"), null);
  assert.equal(decodeJwtPayload(`h.${Buffer.from("42").toString("base64url")}.s`), null);
});
