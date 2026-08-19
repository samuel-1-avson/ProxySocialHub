import * as esbuild from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'phubb-rel-'));
const outfile = join(dir, 'reliability.mjs');

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/lib/reliability.ts')],
  outfile,
  format: 'esm',
  bundle: true,
  platform: 'neutral',
  logLevel: 'silent',
});

const rel = await import(pathToFileURL(outfile).href);

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function jwtWithExp(expSec) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url');
  return `${header}.${payload}.x`;
}

assert(rel.KEEPALIVE_ALARM === 'phubb-keepalive', 'keepalive name');
assert(rel.EXPIRY_WARN_ALARM === 'phubb-expiry-warn', 'warn name');
assert(rel.EXPIRY_CLEAR_ALARM === 'phubb-expiry', 'clear name');
assert(rel.KEEPALIVE_PERIOD_MINUTES === 1, 'Chrome min period is 1 minute');

const rfc = rel.parseExpiresAtMs('2026-08-20T12:00:00Z');
assert(rfc === Date.parse('2026-08-20T12:00:00Z'), 'RFC3339 ms');
assert(rel.parseExpiresAtMs(1_703_505_600) === 1_703_505_600_000, 'unix seconds');
assert(rel.parseExpiresAtMs(1_703_505_600_000) === 1_703_505_600_000, 'unix ms');
assert(rel.parseExpiresAtMs('') === undefined, 'empty');
assert(rel.parseExpiresAtMs('not-a-date') === undefined, 'junk');

assert(
  rel.sessionExpiresAtMs({ expires_at: '2026-08-20T12:00:00Z' }) === Date.parse('2026-08-20T12:00:00Z'),
  'top-level expires_at',
);
assert(
  rel.sessionExpiresAtMs({
    proxy_credentials: { expires_at: '2026-08-20T12:00:00Z' },
  }) === Date.parse('2026-08-20T12:00:00Z'),
  'nested expires_at',
);

const now = 1_700_000_000_000;
const hour = 60 * 60 * 1000;
assert(rel.expiryAlarmWhen(now + hour, now) === now + hour - rel.EXPIRY_WARN_LEAD_MS, 'warn 5 min before');
assert(rel.expiryAlarmWhen(now + 2 * 60 * 1000, now) === now + 1000, 'already inside lead → fire soon');
assert(rel.expiryAlarmWhen(now - 1000, now) === null, 'already expired');
assert(rel.expiryAlarmWhen(Number.NaN, now) === null, 'invalid');

assert(rel.shouldRefreshAccessToken(now + 10 * 60 * 1000, now), 'refresh when inside 30 min');
assert(!rel.shouldRefreshAccessToken(now + 2 * hour, now), 'no refresh when far');
assert(!rel.shouldRefreshAccessToken(undefined, now), 'no refresh without exp');

assert(rel.jwtExpMs(jwtWithExp(1_700_000_000)) === 1_700_000_000_000, 'jwt exp');
assert(rel.jwtExpMs('not.jwt') === undefined, 'bad jwt');

assert(rel.switchAction('off', undefined, 'order-a') === 'on', 'off → on');
assert(rel.switchAction('on', 'order-a', 'order-a') === 'same', 'same order while on');
assert(rel.switchAction('on', 'order-a', 'order-b') === 'switch', 'switch while on');
assert(rel.switchAction('lost', 'order-a', 'order-b') === 'switch', 'switch while lost');
assert(rel.switchAction('lost', 'order-a', 'order-a') === 'on', 'lost same order → reconnect');
assert(rel.switchAction('on', 'order-a', '') === 'on', 'empty selection');
assert(rel.switchButtonLabel('switch') === 'Switch', 'switch label');
assert(rel.switchButtonLabel('same') === 'On this order', 'same label');
assert(rel.switchButtonLabel('on') === 'Turn on', 'on label');

assert(rel.expiryPopupCopy(now - 1, now) === rel.SESSION_EXPIRED_COPY, 'expired copy');
assert(rel.expiryPopupCopy(now + 2 * 60 * 1000, now).includes('Expires in about'), 'warn copy');
assert(rel.expiryPopupCopy(now + hour, now).includes('Session expires in about'), 'far copy');
assert(rel.expiryPopupCopy(undefined, now) === '', 'no exp copy');

rmSync(dir, { recursive: true, force: true });
console.log('reliability tests ok');
