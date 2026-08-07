"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseArgs,
  resolvePlatform,
  resolveArch,
  cachedBinaryPath,
  ensureBinaries,
} = require("../lib/index.js");

describe("@proxyhubb/provider", () => {
  it("parses --daemon flag", () => {
    const { packageType, passthrough } = parseArgs([
      "--daemon",
      "doctor",
      "--json",
    ]);
    assert.equal(packageType, "daemon");
    assert.deepEqual(passthrough, ["doctor", "--json"]);
  });

  it("defaults to wrapper", () => {
    const { packageType, passthrough } = parseArgs(["join", "--key", "x"]);
    assert.equal(packageType, "wrapper");
    assert.deepEqual(passthrough, ["join", "--key", "x"]);
  });

  it("resolves platform/arch", () => {
    assert.ok(["windows", "macos", "linux"].includes(resolvePlatform()));
    assert.ok(["amd64", "arm64"].includes(resolveArch()));
    const p = cachedBinaryPath("wrapper", "1.0.4");
    assert.match(p, /proxyhubb[/\\]cli/);
  });

  it("exports ensureBinaries", () => {
    assert.equal(typeof ensureBinaries, "function");
  });
});
