import { expect, test } from '@playwright/test';
import {
    mockMapResponse,
    stubMarketplaceListingDetail,
    verifiedMapListingId,
    verifiedMapPoint,
} from './fixtures/marketplace-map';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

function fulfillMap(route: import('@playwright/test').Route) {
    return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockMapResponse()),
    });
}

test.describe('marketplace map proof badges', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('shows verified offer and quality signals on map pin detail', async ({ page }) => {
        await stubMarketplaceListingDetail(page);

        await page.goto(
            `${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`,
            { waitUntil: 'domcontentloaded' }
        );

        await expect(page.getByRole('heading', { name: verifiedMapPoint.title, level: 2 })).toBeVisible({
            timeout: 30000,
        });
        await expect(page.getByText('Offer proof')).toBeVisible();
        await expect(page.getByText('Provider signed').first()).toBeVisible();
        await expect(page.getByText('High quality')).toBeVisible();
        await expect(page.getByText('Reported trust', { exact: true })).toBeVisible();
        await expect(page.getByText('Live connectivity requires a successful routed request.', { exact: false })).toBeVisible();
        await expect(page.getByText('Regional area')).toBeVisible();
        await expect(page.getByTestId('catalog-product-badge')).toBeVisible();
        await expect(page.getByTestId('catalog-product-badge')).toContainText('premium-austin-pool');
    });

    test('keeps missing quality unavailable rather than endorsing a published offer', async ({ page }) => {
        await stubMarketplaceListingDetail(page);
        await page.route('**/v1/marketplace/map**', route => route.fulfill({
            json: { ...mockMapResponse(), points: [{ ...verifiedMapPoint, trust_label: undefined, trust_badge: undefined, quality_score: undefined, uptime_percent: undefined, success_rate: undefined }] },
        }));
        await page.goto(`${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`);
        await expect(page.getByRole('heading', { name: verifiedMapPoint.title, level: 2 })).toBeVisible();
        await expect(page.getByText('High quality')).toHaveCount(0);
        await expect(page.getByText('Reported quality', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Reported uptime', { exact: true })).toBeVisible();
        await expect(page.getByText('Not reported', { exact: false }).first()).toBeVisible();
        await expect(page.getByText('Live connectivity requires a successful routed request.', { exact: false })).toBeVisible();
    });

    test('keeps the map visible while inspecting an offer and clears the selection when filtering', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 850 });
        await stubMarketplaceListingDetail(page);
        await page.goto(`${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`);
        await expect(page.getByRole('heading', { name: verifiedMapPoint.title, level: 2 })).toBeVisible();
        const country = page.getByRole('combobox', { name: 'Country' });
        await expect(country).toBeHidden();
        await page.mouse.wheel(0, 500);
        await expect.poll(async () => {
            const box = await page.getByTestId('proxy-map-canvas').boundingBox();
            return Boolean(box && box.y >= 0 && box.y < 200 && box.height > 300);
        }).toBe(true);
        await page.getByText('Filters', { exact: true }).click();
        await expect(country).toBeVisible();
        await country.selectOption('US');
        await expect(page.getByRole('heading', { name: 'Nothing selected', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: verifiedMapPoint.title, level: 2 })).toHaveCount(0);
    });

    test('sends country filter on map refetch', async ({ page }) => {
        const mapUrls: string[] = [];
        await page.route('**/v1/marketplace/map**', async (route) => {
            mapUrls.push(route.request().url());
            await fulfillMap(route);
        });

        await page.goto(`${BASE_URL}/marketplace/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('proxy-map-canvas')).toBeVisible({ timeout: 60_000 });

        const countrySelect = page.getByRole('combobox', { name: 'Country' });
        await expect(countrySelect.locator('option[value="US"]')).toHaveCount(1, { timeout: 15_000 });
        await countrySelect.selectOption('US');

        await expect
            .poll(() => mapUrls.some((url) => url.includes('country=US')), { timeout: 20_000 })
            .toBe(true);
    });

    test('sends bbox after search this area', async ({ page }) => {
        const mapUrls: string[] = [];
        await page.route('**/v1/marketplace/map**', async (route) => {
            mapUrls.push(route.request().url());
            await fulfillMap(route);
        });

        await page.goto(`${BASE_URL}/marketplace/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('proxy-map-canvas')).toBeVisible({ timeout: 60_000 });

        const searchArea = page.getByRole('button', { name: /search this area/i });
        await expect(searchArea).toBeVisible({ timeout: 30_000 });
        await searchArea.click();

        await expect
            .poll(() => mapUrls.some((url) => /[?&]bbox=/.test(url)), { timeout: 20_000 })
            .toBe(true);
    });
});

