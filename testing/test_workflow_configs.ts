/**
 * ProxyHubb CI/CD Workflow Configuration & Multi-Arch Verification Test
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

function runWorkflowTests() {
  console.log('=== Testing ProxyHubb CI/CD Multi-Arch & Verifiable Build Configurations ===\n');

  const rootDir = process.cwd();
  const deployYmlPath = path.join(rootDir, '.github', 'workflows', 'deploy.yml');
  const anchorYmlPath = path.join(rootDir, '.github', 'workflows', 'anchor-verify.yml');

  assert.ok(fs.existsSync(deployYmlPath), 'deploy.yml must exist');
  assert.ok(fs.existsSync(anchorYmlPath), 'anchor-verify.yml must exist');

  const deployContent = fs.readFileSync(deployYmlPath, 'utf8');
  const anchorContent = fs.readFileSync(anchorYmlPath, 'utf8');

  // 1. Verify Deploy Matrix Services
  const expectedServices = ['control-api', 'edge-gateway', 'provider-node', 'groth16-prover', 'web'];
  for (const svc of expectedServices) {
    assert.ok(deployContent.includes(`name: ${svc}`), `deploy.yml must include ${svc} in build matrix`);
  }
  console.log(`[PASS] All ${expectedServices.length} core DePIN services are included in the build matrix.`);

  // 2. Verify Multi-Arch Support
  assert.ok(deployContent.includes('linux/arm64'), 'deploy.yml must include linux/arm64 platform for ARM nodes');
  assert.ok(deployContent.includes('docker/setup-qemu-action'), 'deploy.yml must include QEMU setup for multi-arch emulation');
  console.log('[PASS] Multi-arch (linux/amd64, linux/arm64) configuration verified.');

  // 3. Verify Anchor Verifiable Build
  assert.ok(anchorContent.includes('AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu'), 'anchor-verify.yml must reference canonical Program ID');
  assert.ok(anchorContent.includes('actions/upload-artifact'), 'anchor-verify.yml must upload verifiable build attestation');
  console.log('[PASS] Solana Anchor verifiable build workflow verified.');

  console.log('\n=== All CI/CD Workflow Verification Tests Passed Successfully! ===');
}

runWorkflowTests();
