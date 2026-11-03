import { test, expect } from '@playwright/test';

test('regional view uses geographic tiles and public API coordinates', async ({ page }) => {
  // Keep automated runs off the community tile service. Production uses normal browser caching.
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e7ecef"/></svg>' }));
  await page.route('**/api/public?**', route => route.fulfill({ json: {
    total: 2, nodes: [
      { node_id: 'regional-node', lat: 5, lon: 0, country: 'GH', geo_source: 'gateway', is_active: true },
      { node_id: 'unlocated-node', country: 'GH', is_active: false },
    ],
  } }));
  await page.goto('/nodes?view=map');
  const map = page.getByRole('region', { name: 'Geographic node map' });
  await expect(map).toBeVisible();
  await expect(map.locator('img.leaflet-tile-loaded').first()).toHaveAttribute('src', /https:\/\/tile\.openstreetmap\.org\//);
  await expect(map.locator('.public-node-marker')).toHaveCount(1);
  await expect(map.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
  await map.locator('.public-node-marker').click();
  await expect(map.getByRole('link', { name: 'GH · regional-node' })).toHaveAttribute('href', '/nodes/regional-node');
  await expect(page.getByText('Positions are rounded', { exact: false })).toBeVisible();
});

test('public navigation, typed lookup, and About work without a wallet', async ({ page }) => {
  await page.goto('/search?type=wallets');
  await expect(page.getByRole('combobox', { name: 'Record type' })).toHaveValue('wallets');
  await expect(page.getByRole('link', { name: 'Docs', exact: false }).first()).toHaveAttribute('href', 'https://docs.proxyhubb.com/docs');
  await expect(page.getByRole('link', { name: 'Open workspace', exact: false })).toHaveAttribute('href', 'https://proxyhubb.com/app');
  await page.getByRole('link', { name: 'About the network' }).click();
  await expect(page.getByRole('heading', { name: 'What ProxyHubb supports' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Protocol overview');
});

test('analytics remain readable at desktop and 320px widths', async ({ page }) => {
  await page.route('**/api/public?**', async (route) => {
    const resource = new URL(route.request().url()).searchParams.get('resource');
    await route.fulfill({ json: resource === 'analytics' ? { metrics_available: true, bandwidth_gb: [], active_nodes: [], transaction_volume: [], active_wallets: [] } : {} });
  });
  await page.goto('/analytics');
  const grid = page.locator('div.explorer-chart-grid');
  await expect(grid).toHaveCSS('display', 'grid');
  const first = await grid.locator(':scope > *').first().boundingBox();
  const second = await grid.locator(':scope > *').nth(1).boundingBox();
  expect(first && second && Math.abs(first.y - second.y) < 2).toBeTruthy();
  await page.setViewportSize({ width: 320, height: 740 });
  const narrowFirst = await grid.locator(':scope > *').first().boundingBox();
  const narrowSecond = await grid.locator(':scope > *').nth(1).boundingBox();
  expect(narrowFirst && narrowSecond && narrowSecond.y > narrowFirst.y).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('System follows the device and explicit appearance persists', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/about');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('banner').locator('select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  await page.getByRole('button', { name: 'Use device appearance' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/light/);
});

test('public adapter rejects unsupported resources, writes, and invalid identifiers', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect((await health.json()).service).toBe('proxyhubb-explorer');
  expect((await request.get('/api/public?resource=wallet&id=../private')).status()).toBe(400);
  expect((await request.get('/api/public?resource=private-account')).status()).toBe(400);
  expect((await request.post('/api/public?resource=metrics')).status()).toBe(405);
});
