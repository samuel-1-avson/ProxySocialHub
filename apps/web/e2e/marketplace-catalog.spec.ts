import { expect, test } from '@playwright/test';
import {
    enableE2EProviderSession,
    newCatalogTitle,
    stubCatalogManageApi,
} from './fixtures/marketplace-catalog';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace catalog manage', () => {
    test.setTimeout(120_000);

    test('provider can open catalog manage and create a product', async ({ page }) => {
        await enableE2EProviderSession(page, BASE_URL);
        await stubCatalogManageApi(page);

        await page.goto(`${BASE_URL}/marketplace/manage/products`, {
            waitUntil: 'domcontentloaded',
            timeout: 90_000,
        });
        await page
            .waitForResponse((res) => res.url().includes('/v1/auth/me') && res.ok(), { timeout: 60_000 })
            .catch(() => undefined);
        await page.getByText(/^Loading\.\.\.$/).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);

        await expect(page.getByTestId('catalog-manage')).toBeVisible({ timeout: 30_000 });
        await page.getByTestId('catalog-create-product').click();
        await page.getByTestId('catalog-form-title').fill(newCatalogTitle);
        await page.getByTestId('catalog-form-submit').click();

        await expect(page.getByTestId('catalog-products-list').getByText(newCatalogTitle)).toBeVisible({
            timeout: 15_000,
        });
    });
});
