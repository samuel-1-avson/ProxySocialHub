import { expect, test, type Page } from '@playwright/test';
import {
    EXPLORER_NODE_IDS,
    mockExplorerDecentralizationStatus,
    mockExplorerGate503Body,
    mockExplorerMetrics,
    mockExplorerNodeDetail,
    mockExplorerNodeGeo,
    mockExplorerNodesList,
    mockExplorerUnifiedMapResponse,
} from './fixtures/explorer';
import { fillReactInput } from './fixtures/react-input';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

type StubExplorerOptions = {
    /** When true, metrics returns 503 full-decentralization gate (overview pauses feeds). */
    gateActive?: boolean;
    /** When true, mock explorer WS (initial + subscribe) instead of aborting. */
    mockWebSocket?: boolean;
};

async function stubExplorerApis(page: import('@playwright/test').Page, options: StubExplorerOptions = {}) {
    await page.route('**/v1/explorer/nodes/geo**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerNodeGeo),
        });
    });

    await page.route('**/v1/explorer/metrics**', async (route) => {
        if (options.gateActive) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify(mockExplorerGate503Body),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerMetrics),
        });
    });

    await page.route('**/v1/explorer/network/health**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                status: 'healthy',
                solana_health: 'healthy',
                database_health: 'healthy',
                active_nodes: 2,
                avg_response_time_ms: 42,
                last_checked: new Date().toISOString(),
            }),
        });
    });

    await page.route('**/v1/explorer/analytics**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                period: '24h',
                transaction_volume: [],
                active_wallets: [],
                message: '',
            }),
        });
    });

    await page.route(/\/v1\/explorer\/nodes\/[^/?]+$/, async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const match = route.request().url().match(/\/nodes\/([^/?]+)(?:\?|$)/);
        const nodeId = match?.[1] ? decodeURIComponent(match[1]) : '';
        if (!nodeId || nodeId === 'geo') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerNodeDetail(nodeId)),
        });
    });

    await page.route('**/v1/explorer/decentralization/status**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerDecentralizationStatus()),
        });
    });

    await page.route('**/v1/explorer/decentralization/writers**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ writers: [], total: 0 }),
        });
    });

    await page.route('**/v1/marketplace/map**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerUnifiedMapResponse()),
        });
    });

    if (options.mockWebSocket) {
        await page.routeWebSocket('**/v1/explorer/ws**', (ws) => {
            ws.onMessage((message) => {
                try {
                    const parsed = JSON.parse(String(message)) as { type?: string };
                    if (parsed.type === 'subscribe') {
                        ws.send(
                            JSON.stringify({
                                type: 'initial',
                                data: { nodes: [] },
                                timestamp: new Date().toISOString(),
                            }),
                        );
                    }
                } catch {
                    /* ignore malformed client frames */
                }
            });
        });
    } else {
        await page.route('**/v1/explorer/ws**', async (route) => {
            await route.abort();
        });
    }

    await page.route('**/v1/explorer/nodes?**', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockExplorerNodesList()),
        });
    });

    await page.route('**/v1/explorer/transactions**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ transactions: [], total: 0, page: 1, page_size: 5 }),
        });
    });

    await page.route('**/v1/explorer/blocks**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ blocks: [], total: 0, page: 1, page_size: 5 }),
        });
    });
}

test.describe('explorer', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('overview loads with mocked APIs', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /proxyexplorer/i })).toBeVisible({ timeout: 30_000 });
    });

    test('node map shows listings layer toggle and marketplace map data', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /network wide map|node globe/i })).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByText('Marketplace listings')).toBeVisible();

        await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
        const globeToggle = page.getByRole('button', { name: '3D Globe' });
        await globeToggle.scrollIntoViewIfNeeded();
        await globeToggle.click({ force: true });
        await expect(page.locator('.leaflet-container')).toBeHidden({ timeout: 60_000 });
        await expect(page.getByRole('heading', { name: 'Node Globe' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('explorer-globe-ready')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('[data-globe-listings="true"]')).toBeVisible();
        await expect(page.getByTestId('explorer-map-stat-listings')).toHaveText('1');
        await expect(page.getByTestId('explorer-map-listings-2d-only')).toHaveCount(0);
    });

    test('globe mode loads self-hosted assets, toggles style, and selects a node', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '3D Globe' }).click();
        await expect(page.getByTestId('explorer-globe-loading')).toBeHidden({ timeout: 5_000 });
        await expect(page.getByTestId('explorer-globe-ready')).toBeVisible({ timeout: 60_000 });

        const terrainStyle = page.getByRole('button', { name: 'Terrain' });
        await terrainStyle.scrollIntoViewIfNeeded();
        await terrainStyle.click();
        await expect(terrainStyle).toHaveClass(/border-primary/);

        const austinRow = page.locator('tbody tr').filter({ hasText: 'Austin' }).first();
        await austinRow.click();
        await expect(page.getByText('Austin', { exact: true })).toBeVisible();
    });

    test('nodes grid accepts q search query param', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/nodes?q=austin`, { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/explorer\/nodes\?q=austin/);
    });

    test('node map shows WS connected with mocked websocket', async ({ page }) => {
        await stubExplorerApis(page, { mockWebSocket: true });
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('WS Connected')).toBeVisible({ timeout: 30_000 });
    });

    test('unified 2D map shows last updated timestamp and region distribution', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('explorer-map-updated')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText('Region Distribution')).toBeVisible();
        await expect(page.getByTestId('explorer-map-region-us-central')).toBeVisible();
        await expect(page.getByTestId('explorer-map-region-us-central')).toHaveText('us-central');
    });

    test('validators-only filter requests marketplace map with validator=true', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 30_000 });
        const validatorReq = page.waitForRequest(
            (req) =>
                req.url().includes('/v1/marketplace/map') &&
                req.url().includes('validator=true'),
            { timeout: 30_000 },
        );
        await page.getByRole('button', { name: /Validators/i }).click();
        await validatorReq;
    });

    test('layout trust badge reflects verified decentralization status', async ({ page }) => {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        const trustBadge = page.getByRole('link', { name: /Trust: Verified/i });
        await expect(trustBadge).toBeVisible({ timeout: 30_000 });
        await expect(trustBadge).toContainText('3/2');
    });

    test('overview shows full decentralization gate banner when metrics are gated', async ({ page }) => {
        await stubExplorerApis(page, { gateActive: true });
        const metricsGated = page.waitForResponse(
            (res) => res.url().includes('/v1/explorer/metrics') && res.status() === 503,
            { timeout: 90_000 },
        );
        await page.goto(`${BASE_URL}/explorer`, { waitUntil: 'domcontentloaded' });
        await metricsGated;
        await expect(page.getByRole('heading', { name: /proxyexplorer/i })).toBeVisible({ timeout: 60_000 });
        const gateBanner = page.getByTestId('explorer-overview-gate-banner');
        await expect(gateBanner).toBeVisible({ timeout: 60_000 });
        await expect(gateBanner).toContainText(/full decentralization gate is active/i);
        await expect(gateBanner).toContainText(/detailed feeds are paused until quorum is satisfied/i);
    });

    test('node compare page renders side-by-side metrics for two nodes', async ({ page }) => {
        await stubExplorerApis(page);
        const ids = `${EXPLORER_NODE_IDS.primary},${EXPLORER_NODE_IDS.secondary}`;
        const nodeDetailsLoaded = Promise.all([
            page.waitForResponse(
                (res) =>
                    res.url().includes(`/v1/explorer/nodes/${EXPLORER_NODE_IDS.primary}`) && res.status() === 200,
                { timeout: 90_000 },
            ),
            page.waitForResponse(
                (res) =>
                    res.url().includes(`/v1/explorer/nodes/${EXPLORER_NODE_IDS.secondary}`) && res.status() === 200,
                { timeout: 90_000 },
            ),
        ]);
        await page.goto(`${BASE_URL}/explorer/nodes/compare?ids=${ids}`, { waitUntil: 'domcontentloaded' });
        await nodeDetailsLoaded;
        await expect(page.getByRole('heading', { name: 'Node Comparison' })).toBeVisible({ timeout: 60_000 });
        const metricsSection = page.getByTestId('explorer-node-compare-metrics');
        await expect(metricsSection).toBeVisible({ timeout: 60_000 });
        await expect(metricsSection.getByRole('columnheader', { name: 'Node 1' })).toBeVisible();
        await expect(metricsSection.getByRole('columnheader', { name: 'Node 2' })).toBeVisible();
        await expect(metricsSection.getByText('99.50%')).toBeVisible();
        await expect(metricsSection.getByText('96.20%')).toBeVisible();
    });
});

test.describe('explorer search flow', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    async function submitNodesSearch(page: Page, query: string) {
        await stubExplorerApis(page);
        await page.goto(`${BASE_URL}/explorer/search`, { waitUntil: 'load' });
        await expect(page.getByTestId('explorer-search-query')).toBeVisible({ timeout: 90_000 });

        const main = page.getByRole('main');
        await main.getByRole('button', { name: 'Nodes', exact: true }).click();

        const queryInput = page.getByTestId('explorer-search-query');
        await fillReactInput(queryInput, query);
        await expect(queryInput).toHaveValue(query);
        await page.getByTestId('explorer-search-submit').click();

        const browseLink = page.getByTestId('explorer-search-browse-nodes');
        await expect(browseLink).toBeVisible({ timeout: 30_000 });
        await expect(browseLink).toHaveAttribute('href', `/explorer/nodes?q=${encodeURIComponent(query)}`);
        return browseLink;
    }

    test('search page links node browse to filtered nodes grid', async ({ page }) => {
        const browseLink = await submitNodesSearch(page, 'austin');
        await browseLink.scrollIntoViewIfNeeded();
        await Promise.all([
            page.waitForURL(/\/explorer\/nodes\?q=austin/, { timeout: 60_000 }),
            browseLink.click(),
        ]);
    });
});
