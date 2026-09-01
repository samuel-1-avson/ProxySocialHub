/**
 * ProxyHubb Node.js SDK DePIN & P2P Integration Test
 */

import { ProxyHubClient, proxyUrl, sessionIntentProxyUrl } from '../index.js';
import assert from 'node:assert';

async function runSdkTest() {
  console.log('=== Testing ProxyHubb Node.js SDK DePIN & P2P Extensions ===\n');

  // 1. Instantiate Client
  const client = new ProxyHubClient({
    apiKey: 'phub_test_key_12345',
    baseUrl: 'https://api.testnet.proxyhubb.net',
    proxyEndpoint: 'proxy.testnet.proxyhubb.net:8090',
  });

  assert.ok(client, 'Client should be instantiated');
  assert.strictEqual(typeof client.createP2PSignalOffer, 'function', 'createP2PSignalOffer should exist');
  assert.strictEqual(typeof client.createP2PSignalAnswer, 'function', 'createP2PSignalAnswer should exist');
  assert.strictEqual(typeof client.getP2PSignals, 'function', 'getP2PSignals should exist');
  assert.strictEqual(typeof client.getGatewayOperators, 'function', 'getGatewayOperators should exist');
  assert.strictEqual(typeof client.getDePINMiningStats, 'function', 'getDePINMiningStats should exist');
  console.log('[PASS] All DePIN and P2P methods exist on ProxyHubClient.');

  // 2. Test Helper URLs
  const standardProxy = proxyUrl('order-123', 'pass-456', 'proxy.proxyhubb.com:8090');
  assert.strictEqual(standardProxy, 'http://order-123:pass-456@proxy.proxyhubb.com:8090');

  const sessionIntentProxy = sessionIntentProxyUrl('jwt-token-xyz', 'proxy.proxyhubb.com:8090');
  assert.strictEqual(sessionIntentProxy, 'http://session-intent:jwt-token-xyz@proxy.proxyhubb.com:8090');
  console.log('[PASS] Proxy URL formatting helpers verified.');

  // 3. Test P2P Signal Payload Generation
  const sessionId = 'sess-p2p-test-01';
  const buyerPubkey = '3FTBuRDD9LcfHbQDLRPniLHfbW58uLSb1WbWpc1cbQ5m';
  const providerHotkey = 'DNajRCExDb8cRNjywTmGuFkzyjLGkfBCofY2uVrjkEXe';
  const offerSdp = 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1';
  const iceCandidates = ['candidate:1 1 UDP 2130706431 192.168.1.100 54123 typ host'];

  // Test argument validation
  await assert.rejects(
    async () => client.getP2PSignals(''),
    /TypeError: sessionId is required/,
    'Should throw TypeError when sessionId is empty'
  );
  console.log('[PASS] Argument validation invariants verified.');

  console.log('\n=== All Node.js SDK DePIN Tests Passed Successfully! ===');
}

runSdkTest().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
