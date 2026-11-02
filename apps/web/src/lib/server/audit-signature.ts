// Server-only: request signing shared by the audit route handlers. Dependency-free so it can be
// tested against the worker's verifier (services/regional-auditor/src/auth.ts), which it must
// match byte for byte.

import { createHash, createHmac } from "node:crypto";

export function signAuditorRequest(
  secret: string,
  input: { method: string; pathWithQuery: string; owner: string; body: string; timestamp: number; nonce: string },
): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const payload = [input.timestamp, input.nonce, input.method.toUpperCase(), input.pathWithQuery, input.owner, bodyHash].join("\n");
  return createHmac("sha256", secret).update(payload).digest("hex");
}
