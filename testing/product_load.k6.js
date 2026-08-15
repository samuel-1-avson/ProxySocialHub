/**
 * ProxyHubb product load test (API + optional CONNECT).
 *
 * Replaces Solana-RPC-only testing/load_test.yml for marketplace SLOs.
 *
 * Usage:
 *   k6 run testing/product_load.k6.js
 *   API_BASE=https://api.proxyhubb.com k6 run testing/product_load.k6.js
 *   BUYER_JWT=... k6 run -e BUYER_JWT=$BUYER_JWT testing/product_load.k6.js
 *   PROXY_HOST=proxy.proxyhubb.com:8090 PROXY_USER=... PROXY_PASS=... k6 run testing/product_load.k6.js
 *
 * Thresholds (adjust for Testnet capacity — single VM):
 *   - http_req_failed < 5%
 *   - browse_latency_ms p95 < 2s
 *   - product_errors < 5%
 *
 * Notes:
 *   - GET /v1/marketplace/map is rate-limited (30/min) — probed in a low-rate scenario only.
 *   - GET /v1/health/nodes must stay non-public (404/401/403 expected).
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const API_BASE = (__ENV.API_BASE || 'https://api.proxyhubb.com').replace(/\/$/, '');
const BUYER_JWT = __ENV.BUYER_JWT || '';
const PROXY_HOST = __ENV.PROXY_HOST || '';
const PROXY_USER = __ENV.PROXY_USER || '';
const PROXY_PASS = __ENV.PROXY_PASS || '';

const browseLatency = new Trend('browse_latency_ms');
const authLatency = new Trend('auth_latency_ms');
const errorRate = new Rate('product_errors');

const scenarios = {
  public_browse: {
    executor: 'ramping-arrival-rate',
    startRate: 2,
    timeUnit: '1s',
    preAllocatedVUs: 10,
    maxVUs: 50,
    stages: [
      { duration: '30s', target: 5 },
      { duration: '2m', target: 15 },
      { duration: '30s', target: 5 },
    ],
    exec: 'publicBrowse',
  },
  authenticated: {
    executor: 'constant-arrival-rate',
    rate: 3,
    timeUnit: '1s',
    duration: '2m',
    preAllocatedVUs: 5,
    maxVUs: 20,
    exec: 'authenticatedFlow',
    startTime: '15s',
  },
  // Stay under map rate limit (30/min): ~10/min.
  map_probe: {
    executor: 'constant-arrival-rate',
    rate: 10,
    timeUnit: '1m',
    duration: '3m',
    preAllocatedVUs: 1,
    maxVUs: 2,
    exec: 'mapProbe',
    startTime: '5s',
  },
};

if (PROXY_HOST && PROXY_USER && PROXY_PASS) {
  scenarios.connect_smoke = {
    executor: 'shared-iterations',
    vus: 1,
    iterations: 5,
    exec: 'connectSmoke',
    startTime: '20s',
  };
}

export const options = {
  scenarios,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    browse_latency_ms: ['p(95)<2000'],
    product_errors: ['rate<0.05'],
  },
};

function ok(res, name) {
  const pass = check(res, {
    [`${name} status 2xx/3xx`]: (r) => r.status >= 200 && r.status < 400,
  });
  errorRate.add(!pass);
  return pass;
}

export function publicBrowse() {
  group('public browse', () => {
    let res = http.get(`${API_BASE}/health`);
    browseLatency.add(res.timings.duration);
    ok(res, 'health');

    res = http.get(`${API_BASE}/v1/health/system`);
    browseLatency.add(res.timings.duration);
    ok(res, 'health_system');

    res = http.get(`${API_BASE}/v1/network/status`);
    browseLatency.add(res.timings.duration);
    ok(res, 'network_status');

    res = http.get(`${API_BASE}/v1/listings?limit=20`);
    browseLatency.add(res.timings.duration);
    ok(res, 'listings');

    res = http.get(`${API_BASE}/v1/system/config/public`);
    browseLatency.add(res.timings.duration);
    ok(res, 'public_config');

    // SEC-R1: node inventory must not be public. Expect 404/401/403 (not http failures).
    res = http.get(`${API_BASE}/v1/health/nodes`, {
      responseCallback: http.expectedStatuses(401, 403, 404),
    });
    const locked = check(res, {
      'health/nodes not public': (r) => r.status === 404 || r.status === 401 || r.status === 403,
    });
    errorRate.add(!locked);
  });
  sleep(0.5);
}

export function mapProbe() {
  // Rate-limited endpoint: 200 OK or 429 both acceptable for this probe.
  const res = http.get(`${API_BASE}/v1/marketplace/map?limit=100`, {
    responseCallback: http.expectedStatuses(200, 429),
  });
  browseLatency.add(res.timings.duration);
  const pass = check(res, {
    'marketplace_map 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
  errorRate.add(!pass);
  sleep(0.2);
}

export function authenticatedFlow() {
  if (!BUYER_JWT) {
    sleep(1);
    return;
  }
  const headers = {
    Authorization: `Bearer ${BUYER_JWT}`,
    'Content-Type': 'application/json',
  };
  group('authenticated', () => {
    let res = http.get(`${API_BASE}/v1/wallet`, { headers });
    authLatency.add(res.timings.duration);
    ok(res, 'wallet');

    res = http.get(`${API_BASE}/v1/orders?limit=10`, { headers });
    authLatency.add(res.timings.duration);
    ok(res, 'orders');

    res = http.get(`${API_BASE}/v1/usage/me`, { headers });
    authLatency.add(res.timings.duration);
    ok(res, 'usage_me');

    res = http.get(`${API_BASE}/v1/sessions?limit=10`, { headers });
    authLatency.add(res.timings.duration);
    ok(res, 'sessions');
  });
  sleep(0.5);
}

export function connectSmoke() {
  if (!PROXY_HOST || !PROXY_USER || !PROXY_PASS) {
    return;
  }
  const proxyURL = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_HOST}`;
  const res = http.get(`${API_BASE}/health`, {
    proxy: proxyURL,
    timeout: '15s',
  });
  const pass = check(res, {
    'connect proxy path status ok': (r) => r.status >= 200 && r.status < 500,
  });
  errorRate.add(!pass);
  sleep(1);
}
