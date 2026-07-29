import { expect, test } from '@playwright/test';
import {
    catalogProductId,
    enableE2EProviderSession,
    newCatalogTitle,
    stubCatalogBrowseWithLinkedProduct,
    stubCatalogManageApi,
    supplyListingTitle,
} from './fixtures/marketplace-catalog';
import {
    enableE2EMockBuy,
    mockProxyCredentials,
    stubPurchaseApis,
} from './fixtures/marketplace-purchase';

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

    test('provider links a listing via select (no raw listing-id UX)', async ({ page }) => {
        await enableE2EProviderSession(page, BASE_URL);
        await stubCatalogManageApi(page);

        await page.goto(`${BASE_URL}/marketplace/manage/products`, {
            waitUntil: 'domcontentloaded',
            timeout: 90_000,
        });
        await expect(page.getByTestId('catalog-manage')).toBeVisible({ timeout: 30_000 });

        await page.getByTestId('catalog-create-product').click();
        await page.getByTestId('catalog-form-title').fill(newCatalogTitle);
        await page.getByTestId('catalog-form-submit').click();
        await expect(page.getByTestId('catalog-products-list').getByText(newCatalogTitle)).toBeVisible({
            timeout: 15_000,
        });

        await page.getByTestId(`catalog-product-manage-${catalogProductId}`).click();
        const select = page.getByTestId('catalog-link-listing-select');
        await expect(select).toBeVisible({ timeout: 15_000 });
        await expect(select.locator('option').nth(1)).toContainText(supplyListingTitle);
        await select.selectOption({ index: 1 });
        await page.getByTestId('catalog-link-listing-submit').click();

        await expect(page.getByTestId('catalog-product-offers')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('catalog-product-offers')).toContainText(supplyListingTitle);
    });
});

test.describe('marketplace catalog browse + buy', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('browse card prefers linked catalog product title then mocked buy works', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubCatalogBrowseWithLinkedProduct(page, newCatalogTitle);
        await stubPurchaseApis(page);

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });

        await expect(page.getByText(newCatalogTitle).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('catalog-product-badge').first()).toBeVisible();

        await page.getByTestId('buy-listing-inject').first().click();
        await expect(page.getByTestId('buy-listing-modal')).toBeVisible({ timeout: 15_000 });
        await page.getByTestId('buy-listing-start-connection').click();
        await expect(page.getByTestId('buy-listing-modal-success')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(mockProxyCredentials.endpoint)).toBeVisible();
    });
});
