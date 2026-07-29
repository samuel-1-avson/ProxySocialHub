#!/usr/bin/env node
/**
 * Live testnet QA smoke against proxyhubb.com / api.proxyhubb.com.
 *
 * Public probes always run. Auth probes run only when QA_LIVE_JWT is set.
 * Does not mutate state (no KYC start, no deposits, no provider apply).
 *
 * Usage:
 *   node scripts/qa-live-testnet.mjs
 *   QA_LIVE_JWT=… node scripts/qa-live-testnet.mjs
 *   QA_LIVE_JSON=1 node scripts/qa-live-testnet.mjs
 *
 * Env:
 *   WEB_BASE     default https://proxyhubb.com
 *   API_BASE     default https://api.proxyhubb.com
 *   PROXY_BASE   default https://proxy.proxyhubb.com
 *   QA_LIVE_JWT  optional Bearer token for auth-gated checks
 *   QA_LIVE_JSON write qa-live-results.json when set to 1
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = (process.env.WEB_BASE || 'https://proxyhubb.com').replace(/\/$/, '');
const API = (process.env.API_BASE || 'https://api.proxyhubb.com').replace(/\/$/, '');
const PROXY = (process.env.PROXY_BASE || 'https://proxy.proxyhubb.com').replace(/\/$/, '');
const JWT = (process.env.QA_LIVE_JWT || '').trim();
const WRITE_JSON = process.env.QA_LIVE_JSON === '1' || process.env.QA_LIVE_JSON === 'true';
const TIMEOUT_MS = Number(process.env.QA_LIVE_TIMEOUT_MS || 20_000);
// proxy.proxyhubb.com may lack public DNS until edge TLS is published; default warn-only.
const REQUIRE_PROXY =
  process.env.QA_LIVE_REQUIRE_PROXY === '1' || process.env.QA_LIVE_REQUIRE_PROXY === 'true';

const KYC_STATUSES = new Set([
  'none',
  'not_started',
  'pending',
  'approved',
  'rejected',
  'insufficient_funds',
]);

/** @type {Array<Record<string, unknown>>} */
const results = [];

/**
 * @param {string} name
 * @param {string} url
 * @param {{
 *   expectJson?: boolean,
 *   headers?: Record<string, string>,
 *   ok?: (status: number, body: unknown, text: string) => boolean,
 *   required?: boolean,
 *   redirect?: 'follow' | 'manual',
 * }} [opts]
 */
async function probe(name, url, opts = {}) {
  const {
    expectJson = false,
    headers = {},
    ok = (status) => status >= 200 && status < 300,
    required = true,
    redirect = 'follow',
  } = opts;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers,
      redirect,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let body = text;
    if (expectJson) {
      try {
        body = JSON.parse(text);
      } catch {
        const row = {
          name,
          url,
          ok: false,
          required,
          status: res.status,
          ms: Date.now() - started,
          error: 'invalid json',
        };
        results.push(row);
        return row;
      }
    }
    const passed = ok(res.status, body, text);
    const row = {
      name,
      url,
      ok: passed,
      required,
      status: res.status,
      ms: Date.now() - started,
      body: expectJson ? body : undefined,
      preview: expectJson ? undefined : text.slice(0, 120).replace(/\s+/g, ' '),
    };
    results.push(row);
    return row;
  } catch (err) {
    const row = {
      name,
      url,
      ok: false,
      required,
      status: 0,
      ms: Date.now() - started,
      error: String(err?.message || err),
    };
    results.push(row);
    return row;
  }
}

function authHeaders() {
  return { Authorization: `Bearer ${JWT}`, Accept: 'application/json' };
}

function isHtmlPageOk(status, _body, text) {
  if (status < 200 || status >= 400) return false;
  const lower = String(text || '').toLowerCase();
  if (lower.includes('502 bad gateway') || lower.includes('503 service')) return false;
  if (lower.includes('upstream connect error')) return false;
  // Next.js / app shell should have some markup; empty body is a fail.
  return lower.includes('<!doctype') || lower.includes('<html') || lower.includes('proxyhubb');
}

console.log(`QA live testnet smoke`);
console.log(`  WEB_BASE=${WEB}`);
console.log(`  API_BASE=${API}`);
console.log(`  PROXY_BASE=${PROXY}`);
console.log(`  auth=${JWT ? 'enabled' : 'skipped (set QA_LIVE_JWT)'}`);
console.log(`  proxy_required=${REQUIRE_PROXY}`);
console.log('');

// --- A. Public / critical ---
await probe('api.health', `${API}/health`, {
  expectJson: true,
  ok: (status, body) =>
    status === 200 &&
    typeof body === 'object' &&
    body !== null &&
    (body.status === 'ok' || body.status === 'healthy' || body.status === 'up' || 'status' in body || 'ok' in body || Object.keys(body).length > 0),
});

await probe('api.ready', `${API}/ready`, {
  expectJson: false,
  ok: (status) => status === 200 || status === 204,
});

const publicConfig = await probe('api.system.config.public', `${API}/v1/system/config/public`, {
  expectJson: true,
  ok: (status, body) => {
    if (status !== 200 || typeof body !== 'object' || !body) return false;
    const configured = body.treasury_configured === true;
    const addr = typeof body.treasury_solana === 'string' && body.treasury_solana.trim().length > 0;
    return configured && addr;
  },
});

const solanaHealth = await probe('api.solana.health', `${API}/v1/solana/health`, {
  expectJson: true,
  ok: (status, body) => {
    if (status !== 200 || typeof body !== 'object' || !body) return false;
    const network = String(body.network || '').toLowerCase();
    if (network === 'mainnet' || network === 'mainnet-beta') return false;
    return true;
  },
});

await probe('api.map.health', `${API}/v1/system/map/health`, { expectJson: true });
await probe('api.marketplace.map', `${API}/v1/marketplace/map?include_nodes=true`, { expectJson: true });
await probe('api.listings', `${API}/v1/listings?limit=2`, { expectJson: true });

await probe('web.api.health', `${WEB}/api/health`, {
  expectJson: true,
  ok: (status, body) =>
    status === 200 &&
    typeof body === 'object' &&
    body !== null,
});

const htmlRoutes = [
  ['web.root', '/'],
  ['web.login', '/login'],
  ['web.onboarding', '/onboarding'],
  ['web.marketplace', '/marketplace'],
  ['web.explorer', '/explorer'],
  ['web.dashboard.wallet', '/dashboard/wallet'],
];
for (const [name, path] of htmlRoutes) {
  await probe(name, `${WEB}${path}`, { ok: isHtmlPageOk });
}

// Proxy edge: TLS reachability — any HTTP response (incl. 4xx) counts; connection failure does not.
await probe('proxy.tls', PROXY, {
  expectJson: false,
  required: REQUIRE_PROXY,
  ok: (status) => status > 0 && status < 600,
  redirect: 'manual',
});

// --- B. Auth-gated (optional) ---
if (JWT) {
  const me = await probe('auth.me', `${API}/v1/auth/me`, {
    expectJson: true,
    headers: authHeaders(),
    ok: (status, body) =>
      status === 200 &&
      typeof body === 'object' &&
      body !== null &&
      Boolean(body.id || body.user?.id),
  });

  const userId =
    me.ok && typeof me.body === 'object' && me.body
      ? String(me.body.id || me.body.user?.id || '')
      : '';

  await probe('auth.onboarding', `${API}/v1/onboarding`, {
    expectJson: true,
    headers: authHeaders(),
    ok: (status, body) =>
      status === 200 &&
      typeof body === 'object' &&
      body !== null &&
      typeof body.kyc_status === 'string',
  });

  await probe('auth.wallet', `${API}/v1/wallet`, {
    expectJson: true,
    headers: authHeaders(),
    ok: (status) => status === 200,
  });

  if (userId) {
    await probe('auth.kyc.status', `${API}/v1/kyc/status/${userId}`, {
      expectJson: true,
      headers: authHeaders(),
      ok: (status, body) =>
        status === 200 &&
        typeof body === 'object' &&
        body !== null &&
        KYC_STATUSES.has(String(body.kyc_status || '').toLowerCase()),
    });
  } else {
    results.push({
      name: 'auth.kyc.status',
      url: `${API}/v1/kyc/status/<user_id>`,
      ok: false,
      required: true,
      status: 0,
      ms: 0,
      error: 'skipped: no user id from /v1/auth/me',
    });
  }

  await probe('auth.mfa.status', `${API}/v1/security/mfa/status`, {
    expectJson: true,
    headers: authHeaders(),
    ok: (status) => status === 200,
  });
} else {
  console.log('[skip] auth probes — set QA_LIVE_JWT to enable');
}

// --- Report ---
console.log('');
for (const r of results) {
  let tag = 'OK  ';
  if (!r.ok) tag = r.required ? 'FAIL' : 'WARN';
  const extra = r.error
    ? ` err=${r.error}`
    : ` status=${r.status} ms=${r.ms}`;
  console.log(`${tag} ${r.name}${extra}`);
}

if (publicConfig.ok && typeof publicConfig.body === 'object' && publicConfig.body) {
  const addr = String(publicConfig.body.treasury_solana || '');
  const short = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
  console.log(`[info] treasury_configured=true treasury_solana=${short}`);
}
if (solanaHealth.ok && typeof solanaHealth.body === 'object' && solanaHealth.body) {
  console.log(
    `[info] solana.network=${solanaHealth.body.network} status=${solanaHealth.body.status ?? 'n/a'}`,
  );
}

const failures = results.filter((r) => r.required && !r.ok);
const summary = {
  at: new Date().toISOString(),
  web: WEB,
  api: API,
  proxy: PROXY,
  auth_enabled: Boolean(JWT),
  passed: results.filter((r) => r.ok).length,
  failed: failures.length,
  total: results.length,
  results: results.map(({ body, ...rest }) => ({
    ...rest,
    // Keep bodies out of default artifact noise except for assertion hints
    detail:
      rest.name === 'api.system.config.public' && body && typeof body === 'object'
        ? {
            treasury_configured: body.treasury_configured,
            treasury_present: Boolean(body.treasury_solana),
          }
        : rest.name === 'api.solana.health' && body && typeof body === 'object'
          ? { network: body.network, status: body.status }
          : undefined,
  })),
};

if (WRITE_JSON) {
  const out = join(root, 'qa-live-results.json');
  writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`[info] wrote ${out}`);
}

if (failures.length) {
  console.error(`\n[FAIL] ${failures.length} required probe(s) failed`);
  process.exit(1);
}

console.log(`\n[OK] live testnet QA passed (${summary.passed}/${summary.total})`);
process.exit(0);
