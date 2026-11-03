import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// src/session-plan.ts must stay identical to the web session assistant's checker, so a quote
// here and a plan in the web card always agree. If this fails, copy the web file over again:
//   cp apps/web/src/lib/concierge-plan.ts services/proxyhubb-mcp/src/session-plan.ts
const copy = fileURLToPath(new URL("../src/session-plan.ts", import.meta.url));
const original = fileURLToPath(new URL("../../../apps/web/src/lib/concierge-plan.ts", import.meta.url));
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("session plan copy", () => {
  it("matches apps/web/src/lib/concierge-plan.ts", { skip: !existsSync(original) && "web app not in this checkout" }, () => {
    assert.equal(read(copy), read(original));
  });
});
