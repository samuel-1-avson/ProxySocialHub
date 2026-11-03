import { test, expect, type Page } from '@playwright/test';

// The API's own words for a few records. Only what each test needs is filled in.
const node = { node_id: 'n1', name: 'Proxy in GH', country: 'GH', is_active: true, uptime_percent: 100, bandwidth_gb: 0, active_sessions: 0, last_heartbeat: '2026-11-03T18:00:00Z' };
const answers: Record<string, (params: URLSearchParams) => unknown> = {
  metrics: () => ({ active_nodes: 2, total_transactions: 167, total_bandwidth_gb: 12.5, block_height: 518284205 }),
  nodes: () => ({ total: 1, nodes: [node] }),
  leaderboard: (params) => ({
    category: params.get('category'),
    period_applied: params.get('category') !== 'uptime',
    entries: [{ rank: 1, node_id: 'n1', name: 'Proxy in GH', country: 'GH', uptime_percent: 100, bandwidth_gb: 3.5, active_sessions: 0, is_validator: true }],
  }),
  analytics: () => ({ metrics_available: true, bandwidth_gb: [{ timestamp: '2026-11-03T10:00:00Z', value: 2 }, { timestamp: '2026-11-03T11:00:00Z', value: 3 }] }),
  'health-history': () => ({ metrics_available: true, history: [{ timestamp: '2026-11-03T10:00:00Z', status: 'degraded', active_nodes: 0 }, { timestamp: '2026-11-03T11:00:00Z', status: 'healthy', active_nodes: 2 }] }),
  blocks: () => ({ total: 3_410_992, blocks: [{ block_number: 518284205, transaction_count: 14, timestamp: '2026-11-03T17:01:50Z' }] }),
};
async function mockApi(page: Page) {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/public?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    return route.fulfill({ json: answers[params.get('resource') || '']?.(params) ?? {} });
  });
  return requests;
}

test('overview tiles say what the numbers measure', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByText('Only nodes whose owners chose to be listed')).toBeVisible();
  await expect(page.getByText('Node traffic, last 24 h', { exact: true })).toBeVisible();
  await expect(page.getByText("Sum of each listed node's 24-hour total")).toBeVisible();
  await expect(page.getByText('Cumulative indexed bandwidth')).toHaveCount(0);
  await expect(page.getByText('Reported network population')).toHaveCount(0);
});

test('analytics has no one-hour window and explains the traffic chart', async ({ page }) => {
  const requests = await mockApi(page);
  await page.goto('/analytics?period=1h');
  const periodSelect = page.getByRole('combobox', { name: 'Time window' });
  await expect(periodSelect).toHaveValue('24h');
  await expect(periodSelect.locator('option')).toHaveText(['Last 24 hours', 'Last 7 days', 'Last 30 days']);
  await expect(page.getByRole('heading', { name: 'Node traffic, rolling 24 h' })).toBeVisible();
  await expect(page.getByText('It is not traffic per hour.')).toBeVisible();
  expect(requests.filter((params) => ['analytics', 'health-history'].includes(params.get('resource') || '')).map((params) => params.get('period'))).not.toContain('1h');
});

test('network history shows active nodes, not an invented health state', async ({ page }) => {
  await mockApi(page);
  await page.goto('/analytics');
  const rows = page.locator('.explorer-history-item');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('2 active nodes');
  await expect(rows.locator('.ui-status')).toHaveCount(0);
  await expect(page.getByText('Active nodes reported in each observation window.')).toBeVisible();
});

test('node table and comparison show only what is measured', async ({ page }) => {
  await mockApi(page);
  await page.goto('/nodes');
  await expect(page.getByRole('columnheader', { name: 'Last-seen score' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Latency' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Uptime' })).toHaveCount(0);
  await page.goto('/nodes?view=compare');
  await page.getByRole('checkbox', { name: /Select Proxy in GH/ }).check();
  const compare = page.locator('.explorer-compare');
  await expect(compare.locator('tbody th')).toHaveText(['Region', 'Status', 'Last-seen score', 'Last heartbeat']);
  await expect(compare.getByText('Per-node traffic and session counts are not published.')).toBeVisible();
});

test('rankings do not call a freshness score uptime or a quality score a validator', async ({ page }) => {
  await mockApi(page);
  await page.goto('/nodes?view=rankings');
  await expect(page.getByRole('button', { name: 'Last seen' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('columnheader', { name: 'Last-seen score' })).toBeVisible();
  await expect(page.getByText('It is not measured uptime.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'High quality' })).toBeVisible();
  await expect(page.getByText('Validator', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Sessions' }).click();
  await expect(page.getByRole('columnheader', { name: 'Session count' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Not published' })).toBeVisible();
  await expect(page.getByText('Per-node session counts are not published.')).toBeVisible();

  await page.getByRole('button', { name: 'Bandwidth' }).click();
  await expect(page.getByRole('cell', { name: '3.5 GB' })).toBeVisible();
});

test('block counts say they cover the whole chain and the total says it is approximate', async ({ page }) => {
  await mockApi(page);
  await page.goto('/blocks');
  await expect(page.getByRole('columnheader', { name: 'On-chain transactions' })).toBeVisible();
  await expect(page.getByText('This Explorer indexes only ProxyHub transactions, so a block can list fewer.')).toBeVisible();
  await expect(page.getByText('about 3,410,992 blocks')).toBeVisible();
});
