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

    test('shows verified offer and heartbeat proof on map pin detail', async ({ page }) => {
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
        await expect(page.getByText('Heartbeat proof')).toBeVisible();
        await expect(page.getByText('Regional area')).toBeVisible();
        await expect(page.getByTestId('catalog-product-badge')).toBeVisible();
        await expect(page.getByTestId('catalog-product-badge')).toContainText('premium-austin-pool');
    });

    test('sends country filter on map refetch', async ({ page }) => {
        const mapUrls: string[] = [];
        await page.route('**/v1/marketplace/map**', async (route) => {
            mapUrls.push(route.request().url());
            await fulfillMap(route);
        });

        await page.goto(`${BASE_URL}/marketplace/map`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('proxy-map-canvas')).toBeVisible({ timeout: 60_000 });

        const countrySelect = page.locator('select').nth(2);
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

