import { test, expect } from '@playwright/test';
const docs = 'http://127.0.0.1:4023';
const explorer = 'http://127.0.0.1:4024';

test('Docs: system appearance follows the device and explicit choices persist', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${docs}/docs`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.docs-header select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  await page.getByRole('button', { name: 'Use device appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('Docs: blocked preference storage does not break theme selection', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage disabled'); };
    Storage.prototype.setItem = () => { throw new Error('Storage disabled'); };
  });
  await page.goto(`${docs}/docs`);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Start with your workflow.' })).toBeVisible();
});

test('Docs: mobile navigation stays out of the tab order until opened', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`${docs}/docs`);
  await expect(page.locator('#docs-sidebar')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Quick actions' })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.click();
  await expect(page.getByRole('dialog', { name: 'Docs navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#docs-sidebar')).toBeHidden();
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Docs: keyboard search opens the highlighted result and restores focus', async ({ page }) => {
  await page.goto(`${docs}/docs`);
  const trigger = page.getByRole('button', { name: 'Search documentation' });
  await trigger.click();
  const input = page.getByRole('combobox', { name: 'Search documentation' });
  const results = page.getByRole('dialog', { name: 'Search docs' });
  await input.fill('wallet');
  await expect(results.getByRole('option').first()).toBeVisible();
  await input.press('ArrowDown');
  const title = await results.getByRole('option', { selected: true }).locator('.search-hit-title').innerText();
  await input.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await trigger.click();
  await page.getByRole('button', { name: 'Close search', exact: true }).last().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Search docs' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('Explorer: analytics use a responsive grid with readable empty states', async ({ page }) => {
  await page.route('**/api/public?**', async (route) => {
    const resource = new URL(route.request().url()).searchParams.get('resource');
    await route.fulfill({ json: resource === 'analytics' ? { metrics_available: true, bandwidth_gb: [], active_nodes: [], transaction_volume: [], active_wallets: [] } : {} });
  });
  await page.goto(`${explorer}/analytics`);
  const grid = page.locator('div.explorer-chart-grid');
  await expect(grid).toBeVisible();
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

test('Explorer: typed lookup, About, and reciprocal links are reachable', async ({ page }) => {
  await page.goto(`${explorer}/search?type=wallets`);
  await expect(page.getByRole('combobox', { name: 'Record type' })).toHaveValue('wallets');
  await expect(page.getByRole('link', { name: 'Docs', exact: false }).first()).toHaveAttribute('href', 'https://docs.proxyhubb.com/docs');
  await page.getByRole('link', { name: 'About the network' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Protocol overview');
  await expect(page.getByRole('heading', { name: 'What ProxyHubb supports' })).toBeVisible();
});

test('Explorer: invalid public resources and identifiers are rejected before fetching', async ({ request }) => {
  const invalid = await request.get(`${explorer}/api/public?resource=wallet&id=../private`);
  expect(invalid.status()).toBe(400);
  const unknown = await request.get(`${explorer}/api/public?resource=private-account`);
  expect(unknown.status()).toBe(400);
  const write = await request.post(`${explorer}/api/public?resource=metrics`);
  expect(write.status()).toBe(405);
});

test('Docs: mobile examples use the reading width and contents never cover code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Clipboard blocked'); } } }));
  await page.goto(`${docs}/docs/sdks/python`);
  const example = page.getByRole('region', { name: /code example/ }).first();
  const width = await example.evaluate(el => el.clientWidth);
  const readingWidth = await page.locator('.doc-article').evaluate(el => el.clientWidth);
  expect(readingWidth - width).toBeLessThanOrEqual(4);
  const contents = page.getByRole('button', { name: 'On this page', exact: true });
  await expect(contents).toHaveCSS('position', 'static');
  await contents.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(contents).toBeFocused();
  await page.getByRole('button', { name: 'Copy code', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Copy failed. Try again', exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }));
  await page.getByRole('button', { name: 'Copy failed. Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Code copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('Explorer: mobile navigation and settlement actions stay fully visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/public?**', route => route.fulfill({ json: { transactions: [{ tx_hash: '5'.repeat(88), tx_type: 'settlement', status: 'confirmed', amount: .32, currency: 'SOL' }], total: 1 } }));
  await page.goto(`${explorer}/transactions`);
  const nav = page.getByRole('navigation', { name: 'Explorer primary' });
  for (const link of await nav.getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy();
  }
  const inspect = page.getByRole('link', { name: 'Inspect →' }).first();
  await expect(inspect).toBeVisible();
  const box = await inspect.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy();
  await expect(page.getByText('0.32 SOL', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test('Docs: API reference initializes once in the selected theme', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('phub-docs-theme')) localStorage.setItem('phub-docs-theme', 'light'); });
  await page.goto(`${docs}/docs/api`);
  const instances = page.locator('.openapi-frame .scalar-api-reference');
  await expect(instances).toHaveCount(1);
  await expect(page.locator('.openapi-frame .sidebar-search').first()).toHaveAttribute('aria-label', 'Search API reference');
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(500);
  await expect(instances).toHaveCount(1);
});

test('Explorer: overview stays concise as live history and transactions grow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/public?**', route => {
    const resource = new URL(route.request().url()).searchParams.get('resource');
    const data = resource === 'health-history' ? { history: Array.from({ length: 24 }, (_, i) => ({ timestamp: new Date(Date.UTC(2026, 10, 1, i)).toISOString(), status: 'healthy', active_nodes: 2 })) }
      : resource === 'transactions' ? { transactions: Array.from({ length: 20 }, (_, i) => ({ tx_hash: `${i}`.padStart(88, '5'), tx_type: 'settlement', status: 'confirmed', amount: .32, currency: 'SOL' })), total: 159 } : {};
    return route.fulfill({ json: data });
  });
  await page.goto(explorer);
  await expect(page.locator('.explorer-history-item:visible')).toHaveCount(4);
  await expect(page.getByRole('region', { name: 'Public transactions' }).locator('tbody tr')).toHaveCount(5);
  await expect(page.getByText('Showing 5 of 159 indexed records')).toBeVisible();
  await page.getByText('Show 20 earlier observations', { exact: true }).click();
  await expect(page.locator('.explorer-history-item:visible')).toHaveCount(24);
  await page.getByRole('link', { name: 'View all transactions' }).click();
  await expect(page.getByRole('region', { name: 'Public transactions' }).locator('tbody tr')).toHaveCount(20);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
