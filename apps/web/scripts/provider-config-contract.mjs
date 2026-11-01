import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/provider-config.ts");
const source = fs.readFileSync(sourcePath, "utf8");

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
});

const compiledModule = { exports: {} };
const sessionStorage = {
  getItem(key) {
    return Object.hasOwn(this, key) ? this[key] : null;
  },
  setItem(key, value) {
    this[key] = value;
  },
  removeItem(key) {
    delete this[key];
  },
};
const sandboxRequire = (id) => {
  if (id === "bs58") return require("bs58");
  return require(id);
};

vm.runInNewContext(transpiled.outputText, {
  require: sandboxRequire,
  module: compiledModule,
  exports: compiledModule.exports,
  process,
  crypto: globalThis.crypto,
  window: {},
  sessionStorage,
});

const { buildProviderToml } = compiledModule.exports;
assert.equal(typeof buildProviderToml, "function");

const toml = buildProviderToml({
  nodeId: "node-contract-test",
  apiKey: "provider-token-contract-test",
  providerSigningKey: "provider-signing-key-contract-test",
  connectionType: "residential",
  endpoints: {
    controlApiUrl: "https://api.proxyhubb.test",
    gatewayTunnelAddr: "gw.proxyhubb.test:3128",
    useTls: true,
  },
});

const requiredLines = [
  'control_api_url = "https://api.proxyhubb.test"',
  'gateway_addr = "gw.proxyhubb.test:3128"',
  'node_id = "node-contract-test"',
  'connection_type = "residential"',
  "use_tls = true",
  'jwt_token = ""',
  'api_key = "provider-token-contract-test"',
  'provider_signing_key = "provider-signing-key-contract-test"',
];

for (const line of requiredLines) {
  assert.ok(toml.includes(line), `missing provider config line: ${line}`);
}

assert.equal(
  toml.endsWith("\n"),
  true,
  "provider TOML should end with newline",
);
const { saveProviderApiKey, loadProviderApiKey, clearProviderSessionTokens } =
  compiledModule.exports;
saveProviderApiKey("token-a", "node-a");
assert.equal(
  loadProviderApiKey("node-a", { allowLegacyFallback: false }),
  "token-a",
);
assert.equal(
  loadProviderApiKey("node-b", { allowLegacyFallback: false }),
  null,
  "a new node must not inherit another node token",
);
saveProviderApiKey("token-b", "node-b");
assert.equal(
  loadProviderApiKey("node-a", { allowLegacyFallback: false }),
  "token-a",
);
sessionStorage.setItem(
  "proxyhubb_provider_signing_key_node-a",
  "retained-signing-key",
);
sessionStorage.setItem("unrelated-session-value", "retained");
clearProviderSessionTokens();
assert.equal(
  loadProviderApiKey("node-a", { allowLegacyFallback: false }),
  null,
);
assert.equal(
  loadProviderApiKey("node-b", { allowLegacyFallback: false }),
  null,
);
assert.equal(
  sessionStorage.getItem("proxyhubb_provider_signing_key_node-a"),
  "retained-signing-key",
);
assert.equal(sessionStorage.getItem("unrelated-session-value"), "retained");
console.log("provider config contract ok");
