import { expect, test } from '@playwright/test';
import { gotoExplorerGlobeReady, stubExplorerApis } from './explorer-topology-helpers';
import { mockMapLinksEmpty, mockMapLinksResponse } from './fixtures/map-topology';

const topologyEnabled = ['1', 'true', 'yes'].includes(
    (process.env.NEXT_PUBLIC_GLOBE_TOPOLOGY ?? '').trim().toLowerCase(),
);
const legacyGlobeEnabled = ['1', 'true', 'yes'].includes(
    (process.env.NEXT_PUBLIC_LEGACY_EXPLORER_GLOBE ?? '').trim().toLowerCase(),
);

test.describe('globe topology (Phase 5 — legacy globe)', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(300_000);

    test.beforeEach(() => {
        test.skip(
            !legacyGlobeEnabled,
            'Legacy globe retired from primary UX; set NEXT_PUBLIC_LEGACY_EXPLORER_GLOBE=1 to run',
        );
    });

    test.describe('flag off (default dev:e2e)', () => {
        test.skip(topologyEnabled, 'Topology flag is on; skip flag-off assertions');

        test('globe mode does not request /v1/map/links', async ({ page }) => {
            const mapLinkUrls: string[] = [];
            await page.route('**/v1/map/links**', async (route) => {
                mapLinkUrls.push(route.request().url());
                await route.continue();
            });

            await stubExplorerApis(page);
            await gotoExplorerGlobeReady(page);

            await expect.poll(() => mapLinkUrls.length, { timeout: 5_000 }).toBe(0);
        });
    });

    test.describe('flag on', () => {
        test.skip(!topologyEnabled, 'Set NEXT_PUBLIC_GLOBE_TOPOLOGY=1 (see test:e2e:topology)');

        test('globe renders topology arcs when links are available', async ({ page }) => {
            await page.route('**/v1/map/links**', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(mockMapLinksResponse()),
                });
            });

            await stubExplorerApis(page, { mockWebSocket: true });
            await gotoExplorerGlobeReady(page);
            await expect(page.locator('[data-globe-topology="true"]')).toBeVisible({ timeout: 60_000 });
        });

        test('refetches links after link_update WebSocket event', async ({ page }) => {
            let fetchCount = 0;
            await page.route('**/v1/map/links**', async (route) => {
                fetchCount += 1;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(fetchCount > 1 ? mockMapLinksResponse() : mockMapLinksEmpty()),
                });
            });

            await stubExplorerApis(page, {
                mockWebSocket: true,
                sendLinkUpdateAfterSubscribe: true,
            });
            await gotoExplorerGlobeReady(page);

            await expect.poll(() => fetchCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
            await expect(page.locator('[data-globe-topology="true"]')).toBeVisible({ timeout: 60_000 });
        });
    });
});
