#!/usr/bin/env node
/**
 * Generates the Ed25519 keypair used for edge-gateway usage-report signing
 * (audit 2026-07-30, remediation 0.11 / hotfix sequence step 1).
 *
 * Wiring:
 *   PROVIDER_PRIVATE_KEY  -> edge-gateway env (hex Ed25519 seed, 32 bytes)
 *   GATEWAY_USAGE_PUBLIC_KEY -> control-api env (hex Ed25519 pubkey, 32 bytes)
 *
 * The control-api verifies `POST /v1/gateway/usage/report` signatures against
 * GATEWAY_USAGE_PUBLIC_KEY and fails closed when it is unset (BE-01 fix), so
 * these two values must be deployed together.
 *
 * Run:  node scripts/gateway-usage-keygen.cjs
 * Never commit the output; paste it into the server's .env only.
 */
const { generateKeyPairSync } = require('crypto');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
const spki = publicKey.export({ type: 'spki', format: 'der' });

// For Ed25519, the raw 32-byte seed is the trailing 32 bytes of PKCS#8 DER,
// and the raw 32-byte public key is the trailing 32 bytes of SPKI DER.
const seedHex = pkcs8.subarray(pkcs8.length - 32).toString('hex');
const pubHex = spki.subarray(spki.length - 32).toString('hex');

if (/^0+$/.test(seedHex)) {
  console.error('Refusing zero seed (known-key hazard, see .env.docker.example).');
  process.exit(1);
}

console.log('# Edge gateway (services/edge-gateway):');
console.log(`PROVIDER_PRIVATE_KEY=${seedHex}`);
console.log('');
console.log('# Control API (services/control-api):');
console.log(`GATEWAY_USAGE_PUBLIC_KEY=${pubHex}`);
console.log('');
console.error('Store only in the server .env / secret manager. Do not commit.');
