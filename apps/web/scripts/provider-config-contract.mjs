import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sourcePath = path.resolve('src/lib/provider-config.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: sourcePath,
});

const module = { exports: {} };
const sandboxRequire = (id) => {
  if (id === 'bs58') return require('bs58');
  return require(id);
};

vm.runInNewContext(transpiled.outputText, {
  require: sandboxRequire,
  module,
  exports: module.exports,
  process,
  crypto: globalThis.crypto,
});

const { buildProviderToml } = module.exports;
assert.equal(typeof buildProviderToml, 'function');

const toml = buildProviderToml({
  nodeId: 'node-contract-test',
  apiKey: 'provider-token-contract-test',
  providerSigningKey: 'provider-signing-key-contract-test',
  connectionType: 'residential',
  endpoints: {
    controlApiUrl: 'https://api.proxyhubb.test',
    gatewayTunnelAddr: 'gw.proxyhubb.test:3128',
    useTls: true,
  },
});

const requiredLines = [
  'control_api_url = "https://api.proxyhubb.test"',
  'gateway_addr = "gw.proxyhubb.test:3128"',
  'node_id = "node-contract-test"',
  'connection_type = "residential"',
  'use_tls = true',
  'jwt_token = ""',
  'api_key = "provider-token-contract-test"',
  'provider_signing_key = "provider-signing-key-contract-test"',
];

for (const line of requiredLines) {
  assert.ok(toml.includes(line), `missing provider config line: ${line}`);
}

assert.equal(toml.endsWith('\n'), true, 'provider TOML should end with newline');
console.log('provider config contract ok');
