import { test, expect as baseExpect } from '@playwright/test';
import { seedSignedAuth } from './fixtures/signed-auth';
import { stubMarketplaceListingDetail, verifiedMapListingId } from './fixtures/marketplace-map';

const base = process.env.TEST_BASE_URL || 'http://localhost:4011';
const expect = baseExpect.configure({ timeout: 30_000 });
test.setTimeout(150_000);
test.beforeEach(async ({ page }) => {
  // Automated runs validate the integration without fetching community map tiles.
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7ecef"/></svg>' }));
});

test('failed offer lookup cannot open a checkout with invented map terms', async ({ page }) => {
  await stubMarketplaceListingDetail(page);
  await page.route(url => url.pathname === `/v1/listings/${verifiedMapListingId}`, route => route.fulfill({ status: 503, json: { error: 'Offer source offline' } }));
  let writes = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/v1/orders')) writes++; });
  await page.goto(`${base}/marketplace/map?listing=${verifiedMapListingId}`);
  await page.getByTestId('marketplace-map-buy-btn').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Current offer terms are unavailable' })).toBeVisible();
  await expect(page.getByTestId('buy-listing-modal')).toHaveCount(0);
  expect(writes).toBe(0);
});

test('a cold geographic map draws API pins without waiting for a poll or pan', async ({ page }) => {
  await stubMarketplaceListingDetail(page);
  await page.goto(`${base}/marketplace/map`);
  const map = page.locator('[data-map-engine="leaflet"]');
  await expect(map.locator('.leaflet-marker-icon').first()).toBeVisible();
  await expect(map.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
});

test('analytics failures stay unavailable and other-currency amounts are never labeled SOL', async ({ page }) => {
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/analytics/usage/daily')) {
      return route.fulfill({ json: { data: [{ date: '2026-10-28', gb_used: 1.25, cost_ghs: 25, requests: 2 }] } });
    }
    if (path.includes('/analytics/geo') || path.includes('/analytics/top-destinations')) return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 503, json: { error: 'Telemetry source offline' } });
  });
  await seedSignedAuth(page, base, 'buyer');
  await page.goto(`${base}/dashboard/analytics`);
  await expect(page.getByRole('heading', { name: 'Traffic analytics' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Telemetry source offline' }).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Daily usage measurements' })).toContainText('1.25 GB');
  await expect(page.getByRole('region', { name: 'Daily usage measurements' })).toContainText('Not reported');
  await expect(page.getByText('25 SOL', { exact: false })).toHaveCount(0);
  await expect(page.locator('section[aria-label="Reported traffic totals"]')).toContainText('Not reported');
});

test('restored tools are discoverable without adding primary destinations or leaking seller tools', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ json: { orders: [], nodes: [], total_gb: 0, total_sessions: 0 } }));
  await seedSignedAuth(page, base, 'buyer');
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Search workspace' }).click();
  const search = page.getByRole('dialog', { name: 'Search workspace' });
  await expect(search.getByRole('link', { name: 'Billing & Access Passes' })).toBeVisible();
  await expect(search.getByRole('link', { name: 'API keys' })).toBeVisible();
  await expect(search.getByRole('link', { name: 'Pair a computer' })).toHaveCount(0);
  await search.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link')).toHaveCount(4);
});

test('an unavailable inbox is not presented as an empty conversation list', async ({ page }) => {
  await page.route('**/v1/**', route => route.fulfill({ status: 503, json: { error: 'Inbox source offline' } }));
  await seedSignedAuth(page, base, 'buyer');
  await page.goto(`${base}/messages`);
  await expect(page.getByRole('alert').filter({ hasText: 'Inbox source offline' })).toBeVisible();
  await expect(page.getByText('No conversations', { exact: true })).toHaveCount(0);
});
