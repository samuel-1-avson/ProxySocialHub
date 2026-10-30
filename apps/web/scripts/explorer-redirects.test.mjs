import test from 'node:test';
import assert from 'node:assert/strict';
import { explorerRedirects, matchExplorerRedirect } from '../src/lib/navigation/explorer-redirects.mjs';

test('Explorer migration stays inactive until an origin is configured', () => {
  assert.deepEqual(explorerRedirects(''), []);
});
test('Explorer preserves typed public record identifiers and merged views', () => {
  const routes = explorerRedirects('https://explorer.proxyhubb.com/');
  const destination = (source) => routes.find((route) => route.source === source)?.destination;
  assert.equal(destination('/explorer/transactions/:id'), 'https://explorer.proxyhubb.com/transactions/:id');
  assert.equal(destination('/explorer/blocks/:id'), 'https://explorer.proxyhubb.com/blocks/:id');
  assert.equal(destination('/explorer/wallets/:id'), 'https://explorer.proxyhubb.com/wallets/:id');
  assert.equal(destination('/explorer/map'), 'https://explorer.proxyhubb.com/nodes?view=map');
  assert.equal(destination('/explorer/leaderboard'), 'https://explorer.proxyhubb.com/nodes?view=rankings');
  assert.equal(destination('/explorer/nodes/compare'), 'https://explorer.proxyhubb.com/nodes?view=compare');
  assert.equal(destination('/explorer/about/protocol'), 'https://explorer.proxyhubb.com/about');
  assert.equal(destination('/treasury'), 'https://explorer.proxyhubb.com/governance/treasury');
  assert.ok(routes.every((route) => route.permanent === false));
});
test('Explorer migration does not capture private actions or purchase routes', () => {
  const routes = explorerRedirects('https://explorer.proxyhubb.com');
  for (const source of ['/app', '/marketplace/map', '/governance', '/governance/create', '/governance/:id', '/explorer/sessions', '/explorer/earnings']) {
    assert.equal(routes.some((route) => route.source === source), false);
  }
});
test('Public Explorer paths resolve onto the standalone origin', () => {
  assert.equal(matchExplorerRedirect('', '/explorer'), 'https://explorer.proxyhubb.com/');
  assert.equal(matchExplorerRedirect('https://explorer.proxyhubb.com', '/explorer'), 'https://explorer.proxyhubb.com/');
  assert.equal(
    matchExplorerRedirect('https://explorer.proxyhubb.com', '/explorer/transactions/abc'),
    'https://explorer.proxyhubb.com/transactions/abc',
  );
  assert.equal(
    matchExplorerRedirect('https://explorer.proxyhubb.com', '/explorer/map', '?country=US'),
    'https://explorer.proxyhubb.com/nodes?view=map&country=US',
  );
  assert.equal(
    matchExplorerRedirect('https://explorer.proxyhubb.com', '/explorer/nodes/compare'),
    'https://explorer.proxyhubb.com/nodes?view=compare',
  );
  for (const path of ['/explorer/sessions', '/explorer/earnings']) {
    assert.equal(matchExplorerRedirect('https://explorer.proxyhubb.com', path), 'https://explorer.proxyhubb.com/');
  }
  for (const path of ['/governance', '/governance/create', '/marketplace/map', '/app']) {
    assert.equal(matchExplorerRedirect('https://explorer.proxyhubb.com', path), null);
  }
});
test('Malformed and non-HTTPS Explorer origins fail the build', () => {
  for (const origin of ['http://explorer.proxyhubb.com', 'https://explorer.proxyhubb.com/path', 'https://example.com?query=1', 'https://user:pass@example.com']) {
    assert.throws(() => explorerRedirects(origin));
  }
});

test('Encoded record identifiers survive migration without double encoding', () => {
  assert.equal(
    matchExplorerRedirect('', '/explorer/nodes/node%2Fpart'),
    'https://explorer.proxyhubb.com/nodes/node%2Fpart',
  );
});

test('Malformed record encoding falls back safely and retains query context', () => {
  assert.equal(
    matchExplorerRedirect('', '/explorer/nodes/%E0%A4%A', '?country=GH'),
    'https://explorer.proxyhubb.com/?country=GH',
  );
});

test('Retired Explorer views retain filters without capturing private workspace actions', () => {
  assert.equal(
    matchExplorerRedirect('', '/explorer/sessions', '?page=2'),
    'https://explorer.proxyhubb.com/?page=2',
  );
  assert.equal(matchExplorerRedirect('', '/app/activity', '?tab=billing'), null);
});
