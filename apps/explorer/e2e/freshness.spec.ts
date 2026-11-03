import { test, expect, type Page } from '@playwright/test';

// What the API says about the index. Only the metrics matter here; every other resource is empty.
async function mockMetrics(page: Page, metrics: Record<string, unknown>) {
  await page.route('**/api/public?**', (route) => {
    const resource = new URL(route.request().url()).searchParams.get('resource');
    return route.fulfill({ json: resource === 'metrics' ? { block_height: 518284205, total_transactions: 167, ...metrics } : {} });
  });
}
const stale = { indexed_head_time: '2026-11-03T17:01:58Z', indexed_lag_seconds: 5820 };

test('a stale index is announced once on the overview, with its age on the tile', async ({ page }) => {
  await mockMetrics(page, stale);
  await page.goto('/');
  const notice = page.locator('.explorer-stale');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('Indexed data is 1 h 37 min old.');
  await expect(notice).toContainText('Transactions and blocks after that time are not shown yet.');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(page.getByText('Newest block is 1 h 37 min old')).toBeVisible();
});

test('the transactions and blocks pages carry the same notice', async ({ page }) => {
  await mockMetrics(page, stale);
  for (const path of ['/transactions', '/blocks']) {
    await page.goto(path);
    await expect(page.locator('.explorer-stale'), path).toHaveCount(1);
    await expect(page.locator('.explorer-stale'), path).toContainText('Indexed data is 1 h 37 min old.');
  }
});

test('a fresh index shows no notice and says how new the block is', async ({ page }) => {
  await mockMetrics(page, { indexed_head_time: '2026-11-03T18:38:40Z', indexed_lag_seconds: 20 });
  await page.goto('/');
  await expect(page.getByText('Newest block is under a minute old')).toBeVisible();
  await expect(page.locator('.explorer-stale')).toHaveCount(0);
});

test('the notice starts just past five minutes', async ({ page }) => {
  await mockMetrics(page, { indexed_head_time: '2026-11-03T18:30:00Z', indexed_lag_seconds: 300 });
  await page.goto('/blocks');
  await expect(page.locator('.ui-pagination')).toBeVisible();
  await expect(page.locator('.explorer-stale')).toHaveCount(0);

  await page.unroute('**/api/public?**');
  await mockMetrics(page, { indexed_head_time: '2026-11-03T18:30:00Z', indexed_lag_seconds: 301 });
  await page.goto('/blocks');
  await expect(page.locator('.explorer-stale')).toContainText('Indexed data is 5 min old.');
});

test('an index that cannot say how old it is shows no notice and no invented age', async ({ page }) => {
  await mockMetrics(page, {});
  await page.goto('/');
  await expect(page.getByText('Source block height')).toBeVisible();
  await expect(page.locator('.explorer-stale')).toHaveCount(0);
  await expect(page.getByText('Newest block is')).toHaveCount(0);
});
