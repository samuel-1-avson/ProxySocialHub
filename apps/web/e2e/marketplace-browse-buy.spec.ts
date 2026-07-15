import { expect, test } from '@playwright/test';
import { verifiedMapListingId } from './fixtures/marketplace-map';
import { stubMarketplaceBrowse } from './fixtures/marketplace-browse';
import {
    enableE2EMockBuy,
    mockProxyCredentials,
    stubPurchaseApis,
} from './fixtures/marketplace-purchase';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace browse grid buy', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('opens buy modal from browse grid Inject action', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubMarketplaceBrowse(page);

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });

        const injectAction = page.getByTestId('buy-listing-inject').first();
        await expect(injectAction).toBeVisible({ timeout: 15000 });
        await injectAction.click();

        const modal = page.getByTestId('buy-listing-modal');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await expect(modal.getByRole('heading', { name: /connect to node/i })).toBeVisible();
    });

    test('completes mocked purchase from browse grid', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubMarketplaceBrowse(page);
        await stubPurchaseApis(page);

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('buy-listing-inject').first().click();
        await expect(page.getByTestId('buy-listing-modal')).toBeVisible({ timeout: 15000 });

        await page.getByTestId('buy-listing-start-connection').click();

        await expect(page.getByTestId('buy-listing-modal-success')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(mockProxyCredentials.endpoint)).toBeVisible();
    });

    test('shows featured strip and collection rails', async ({ page }) => {
        await stubMarketplaceBrowse(page);

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });

        await expect(page.getByTestId('marketplace-featured-strip')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('marketplace-collection-rails')).toBeVisible();
        await expect(page.getByTestId('marketplace-collection-featured')).toBeVisible();
        await expect(page.getByTestId('marketplace-facet-chips')).toBeVisible();
    });

    test('requests catalog embed on listings index', async ({ page }) => {
        await stubMarketplaceBrowse(page);

        const listingsRequest = page.waitForRequest(
            (request) => {
                if (request.method() !== 'GET') return false;
                try {
                    const url = new URL(request.url());
                    const isIndex =
                        url.pathname === '/v1/listings' || url.pathname === '/api/v1/listings';
                    return isIndex && url.searchParams.get('include') === 'product';
                } catch {
                    return false;
                }
            },
            { timeout: 45_000 },
        );

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });
        await listingsRequest;
    });

    test('shows catalog product badge on browse cards', async ({ page }) => {
        await stubMarketplaceBrowse(page);

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('catalog-product-badge').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Premium Austin Pool').first()).toBeVisible();
    });

    test('passes country filter to listings API', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubMarketplaceBrowse(page);

        const filteredListingsRequest = page.waitForRequest(
            (request) => {
                if (request.method() !== 'GET') return false;
                try {
                    const url = new URL(request.url());
                    const isIndex =
                        url.pathname === '/v1/listings' || url.pathname === '/api/v1/listings';
                    return isIndex && url.searchParams.get('country') === 'US';
                } catch {
                    return false;
                }
            },
            { timeout: 45_000 },
        );

        await page.goto(`${BASE_URL}/marketplace`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('marketplace-facet-chips')).toBeVisible({ timeout: 15_000 });

        await page.getByTestId('marketplace-facet-country-US').click();
        await filteredListingsRequest;
    });
});
