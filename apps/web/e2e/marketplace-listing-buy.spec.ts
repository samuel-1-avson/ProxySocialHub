import { expect, test } from '@playwright/test';
import {
    mockListingDetail,
    stubMarketplaceListingDetail,
    verifiedMapListingId,
} from './fixtures/marketplace-map';
import {
    enableE2EMockBuy,
    mockProxyCredentials,
    openOrderCredentials,
    stubPurchaseApis,
} from './fixtures/marketplace-purchase';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';


test.describe('marketplace listing detail buy', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('opens buy modal from listing detail page', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubMarketplaceListingDetail(page);

        await page.goto(`${BASE_URL}/marketplace/${verifiedMapListingId}`, {
            waitUntil: 'domcontentloaded',
        });

        const expectedTitle = mockListingDetail().catalog_product?.title || mockListingDetail().title;
        await expect(page.getByRole('heading', { name: expectedTitle as string })).toBeVisible({
            timeout: 15000,
        });

        await page.getByRole('button', { name: /buy bandwidth/i }).click();

        const modal = page.getByTestId('buy-listing-modal');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await expect(modal.getByRole('heading', { name: /buy with sol/i })).toBeVisible();
    });

    test('completes mocked purchase from listing detail', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubMarketplaceListingDetail(page);
        await stubPurchaseApis(page);

        await page.goto(`${BASE_URL}/marketplace/${verifiedMapListingId}`, {
            waitUntil: 'domcontentloaded',
        });

        await page.getByRole('button', { name: /buy bandwidth/i }).click();
        await expect(page.getByTestId('buy-listing-modal')).toBeVisible({ timeout: 15000 });

        await page.getByTestId('buy-listing-start-connection').click();

        await expect(page.getByTestId('buy-listing-modal-success')).toBeVisible({ timeout: 20000 });
        await expect(page.getByTestId('extension-connect-card')).toBeVisible();
        const credentials = page.getByTestId('marketplace-order-credentials');
        await openOrderCredentials(credentials);
        await expect(credentials.getByText(mockProxyCredentials.endpoint.split(':')[0], { exact: true })).toBeVisible();
        await expect(credentials.getByText(mockProxyCredentials.username).first()).toBeVisible();
    });
});
