import { test, expect } from '@playwright/test';
const docs = 'http://127.0.0.1:4023';
const explorer = 'http://127.0.0.1:4024';

test('Docs: system appearance follows the device and explicit choices persist', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${docs}/docs`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const theme = page.getByRole('combobox', { name: 'Color theme' });
  await theme.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await theme.selectOption('system');
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
  await page.getByRole('combobox', { name: 'Color theme' }).selectOption('dark');
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
