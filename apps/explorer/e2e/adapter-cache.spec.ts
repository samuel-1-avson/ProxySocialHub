import { test, expect } from '@playwright/test';
import http from 'node:http';

const upstreamPort = Number(process.env.EXPLORER_TEST_UPSTREAM_PORT || 4027);
let upstream: http.Server;
let hits: string[] = [];
// Each test uses numbers and ids nobody else asked for, so the adapter's cache starts cold
// even though both browser projects share one running server.
const fresh = () => 10 + Math.floor(Math.random() * 300_000) * 3;
const hitsFor = (fragment: string) => hits.filter((url) => url.includes(fragment)).length;

test.beforeAll(async () => {
  upstream = http.createServer((request, response) => {
    const url = request.url || '';
    hits.push(url);
    // A short delay keeps concurrent requests overlapping.
    setTimeout(() => {
      response.setHeader('content-type', 'application/json');
      const page = Number(new URL(url, 'http://upstream').searchParams.get('page'));
      if (url.startsWith('/v1/explorer/blocks')) {
        response.statusCode = page % 3 === 0 ? 500 : 200;
        response.end(JSON.stringify({ total: page, page, page_size: 20, blocks: [] }));
      } else if (url.startsWith('/v1/explorer/transactions/')) {
        response.statusCode = url.includes('missing') ? 404 : 200;
        response.end(JSON.stringify({ tx_hash: 'found', status: 'confirmed' }));
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    }, 60);
  });
  await new Promise<void>((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});
test.beforeEach(() => {
  hits = [];
});

test('visitors asking at the same moment cost the API one call, and the next ones none', async ({ request }) => {
  const page = fresh() + 1; // not divisible by 3, so the stand-in upstream answers it
  const url = `/api/public?resource=blocks&page=${page}`;
  const answers = await Promise.all(Array.from({ length: 6 }, () => request.get(url)));
  for (const answer of answers) {
    expect(answer.status()).toBe(200);
    expect((await answer.json()).total).toBe(page);
  }
  expect(answers.map((answer) => answer.headers()['x-public-cache']).sort()).toEqual(
    ['miss', 'shared', 'shared', 'shared', 'shared', 'shared'],
  );
  const later = await request.get(url);
  expect(later.headers()['x-public-cache']).toBe('hit');
  expect(later.headers()['cache-control']).toBe('no-store');
  expect(hitsFor(`page=${page}&`)).toBe(1);
});

test('a missing record is remembered briefly and still reported as not found', async ({ request }) => {
  const id = `missing-${fresh()}`;
  const first = await request.get(`/api/public?resource=transaction&id=${id}`);
  const second = await request.get(`/api/public?resource=transaction&id=${id}`);
  expect([first.status(), second.status()]).toEqual([404, 404]);
  expect((await second.json()).error).toBe('This public record was not found.');
  expect(second.headers()['x-public-cache']).toBe('hit');
  expect(hitsFor(id)).toBe(1);
});

test('an upstream failure is shown as unavailable, held for a moment only, then retried', async ({ request }) => {
  const page = fresh() + 2; // the stand-in upstream fails every page divisible by 3
  const url = `/api/public?resource=blocks&page=${page}`;
  const first = await request.get(url);
  expect(first.status()).toBe(502);
  expect((await first.json()).error).toContain('The public source returned 500');
  expect((await request.get(url)).headers()['x-public-cache']).toBe('hit');
  expect(hitsFor(`page=${page}&`)).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 2_300));
  const retry = await request.get(url);
  expect(retry.status()).toBe(502);
  expect(retry.headers()['x-public-cache']).toBe('miss');
  expect(hitsFor(`page=${page}&`)).toBe(2);
});

test('a hidden tab does not poll, and a returning tab refreshes stale data', async ({ page }) => {
  // /blocks loads the block list and, for the freshness notice, the metrics. Both must obey the rule.
  const seen: string[] = [];
  await page.route('**/api/public?**', (route) => {
    seen.push(new URL(route.request().url()).searchParams.get('resource') || '');
    return route.fulfill({ json: { blocks: [], total: 0 } });
  });
  const requested = () => [...seen].sort();
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    (window as unknown as { setTabHidden: (value: boolean) => void }).setTabHidden = (value) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const setHidden = (value: boolean) =>
    page.evaluate((hidden) => (window as unknown as { setTabHidden: (value: boolean) => void }).setTabHidden(hidden), value);
  await page.clock.install();
  await page.goto('/blocks');
  await expect.poll(requested).toEqual(['blocks', 'metrics']);

  await setHidden(true);
  await page.clock.runFor(180_000);
  expect(requested()).toEqual(['blocks', 'metrics']);

  await setHidden(false);
  await expect.poll(requested).toEqual(['blocks', 'blocks', 'metrics', 'metrics']);

  await page.clock.runFor(60_000);
  await expect.poll(requested).toEqual(['blocks', 'blocks', 'blocks', 'metrics', 'metrics', 'metrics']);
});
