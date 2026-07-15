import { expect, test } from '@playwright/test';
import { mockMapResponse } from './fixtures/marketplace-map';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';
const unifiedEnabled = ['1', 'true', 'yes'].includes(
    (process.env.NEXT_PUBLIC_UNIFIED_NETWORK ?? '').trim().toLowerCase(),
);

test.describe('unified network shell', () => {
    test.skip(!unifiedEnabled, 'Set NEXT_PUBLIC_UNIFIED_NETWORK=1 when starting dev:e2e (see test:e2e:network)');

    test('renders network shell instead of redirecting to map', async ({ page }) => {
        await page.route('**/v1/marketplace/map**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockMapResponse()),
            });
        });

        await page.goto(`${BASE_URL}/network`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await expect(page).toHaveURL(/\/network/, { timeout: 30_000 });
        await expect(page.getByTestId('network-shell')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('network-map-embed')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 60_000 });
        await expect(page.getByTestId('network-map-full-link')).toBeVisible();
        await expect(page.getByRole('link', { name: /open marketplace map/i }).first()).toBeVisible();
    });

    test('network shell does not fetch globe topology links', async ({ page }) => {
        const topologyUrls: string[] = [];
        await page.route('**/v1/map/links**', async (route) => {
            topologyUrls.push(route.request().url());
            await route.continue();
        });
        await page.route('**/v1/marketplace/map**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockMapResponse()),
            });
        });

        await page.goto(`${BASE_URL}/network`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await expect(page.getByTestId('network-shell')).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => topologyUrls.length, { timeout: 5_000 }).toBe(0);
    });

    test('embed map requests include_catalog and shows listing pins', async ({ page }) => {
        const mapUrls: string[] = [];
        await page.route('**/v1/marketplace/map**', async (route) => {
            mapUrls.push(route.request().url());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockMapResponse()),
            });
        });

        await page.goto(`${BASE_URL}/network`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await expect(page.getByTestId('network-map-embed')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible({ timeout: 60_000 });

        await expect
            .poll(() => mapUrls.some((url) => url.includes('include_catalog=true')), { timeout: 20_000 })
            .toBe(true);
    });
});
