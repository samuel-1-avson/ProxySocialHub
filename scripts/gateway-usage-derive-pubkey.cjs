#!/usr/bin/env node
/**
 * Derive GATEWAY_USAGE_PUBLIC_KEY from an existing PROVIDER_PRIVATE_KEY seed.
 *
 * Prefer this over regenerating when edge-gateway already has a seed in env —
 * a new keygen would break signature verify until both sides are rotated together.
 *
 * Usage:
 *   node scripts/gateway-usage-derive-pubkey.cjs
 *   node scripts/gateway-usage-derive-pubkey.cjs --env .env
 *   node scripts/gateway-usage-derive-pubkey.cjs --seed <64-hex>
 *   node scripts/gateway-usage-derive-pubkey.cjs --env .env --write
 *
 * --write appends/updates GATEWAY_USAGE_PUBLIC_KEY in the env file (local only).
 * Never commit the result.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function usage() {
  console.error(`Usage:
  node scripts/gateway-usage-derive-pubkey.cjs [--env PATH] [--write]
  node scripts/gateway-usage-derive-pubkey.cjs --seed <64-hex>
`);
  process.exit(2);
}

function seedToPubHex(seedHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error('seed must be 64 hex chars (32-byte Ed25519 seed)');
  }
  if (/^0+$/.test(seedHex)) {
    throw new Error('Refusing zero seed (known-key hazard)');
  }
  const seed = Buffer.from(seedHex, 'hex');
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    seed,
  ]);
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv);
  const spki = pub.export({ type: 'spki', format: 'der' });
  return spki.subarray(spki.length - 32).toString('hex');
}

function upsertEnvLine(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, line);
  }
  const trimmed = content.replace(/\s*$/, '');
  return `${trimmed}\n\n# Derived from PROVIDER_PRIVATE_KEY (${new Date().toISOString().slice(0, 10)})\n${line}\n`;
}

const args = process.argv.slice(2);
let envPath = null;
let seedArg = null;
let write = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--env') envPath = args[++i];
  else if (args[i] === '--seed') seedArg = args[++i];
  else if (args[i] === '--write') write = true;
  else if (args[i] === '-h' || args[i] === '--help') usage();
  else usage();
}

let seedHex = seedArg;
if (!seedHex) {
  envPath = envPath || path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`env file not found: ${envPath}`);
    process.exit(1);
  }
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/^PROVIDER_PRIVATE_KEY=([0-9a-fA-F]+)\s*$/m);
  if (!m) {
    console.error('PROVIDER_PRIVATE_KEY not set in env (need 64 hex chars)');
    process.exit(1);
  }
  seedHex = m[1];
}

const pubHex = seedToPubHex(seedHex);
console.log('# Control API:');
console.log(`GATEWAY_USAGE_PUBLIC_KEY=${pubHex}`);
console.error('Derived from existing PROVIDER_PRIVATE_KEY. Do not commit.');

if (write) {
  if (!envPath) {
    console.error('--write requires --env');
    process.exit(1);
  }
  const before = fs.readFileSync(envPath, 'utf8');
  const after = upsertEnvLine(before, 'GATEWAY_USAGE_PUBLIC_KEY', pubHex);
  fs.writeFileSync(envPath, after, { encoding: 'utf8', mode: 0o600 });
  console.error(`Updated ${envPath}`);
}
