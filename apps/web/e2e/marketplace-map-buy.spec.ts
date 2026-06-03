import { expect, test } from '@playwright/test';
import {
    mockListingDetail,
    mockMapResponse,
    verifiedMapListingId,
    verifiedMapPoint,
} from './fixtures/marketplace-map';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

async function enableE2EMockBuy(page: import('@playwright/test').Page) {
    await page.context().addCookies([
        {
            name: 'proxyhubb_e2e_auth',
            value: '1',
            url: BASE_URL.replace('localhost', '127.0.0.1'),
        },
    ]);
    await page.addInitScript(() => {
        sessionStorage.setItem('proxyhubb_token', 'mock-test-token');
        document.cookie = 'proxyhubb_refresh_token=mock-refresh-token; path=/; samesite=lax';
        (window as Window & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__ = true;
    });
    await page.route('**/v1/auth/refresh', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                token: 'mock-test-token',
                refresh_token: 'mock-refresh-token',
            }),
        });
    });
    await page.route('**/v1/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'buyer-e2e',
                email: 'buyer-e2e@proxyhubb.test',
                role: 'buyer',
            }),
        });
    });
}

const mockProxyCredentials = {
    endpoint: 'proxy.e2e.test:8080',
    username: 'e2e-map-buyer',
    password: 'e2e-map-secret',
};

async function stubMarketplaceMapApis(page: import('@playwright/test').Page) {
    await page.route('**/v1/marketplace/map**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockMapResponse()),
        });
    });
    await page.route(`**/v1/listings/${verifiedMapListingId}**`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ listing: mockListingDetail(), is_saved: false }),
        });
    });
}

async function stubPurchaseApis(page: import('@playwright/test').Page) {
    await page.route('**/v1/orders', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        const body = route.request().postDataJSON() as { listing_id?: string; bandwidth_gb?: number };
        expect(body.listing_id).toBe(verifiedMapListingId);
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                order: {
                    id: 'order-map-e2e-1',
                    listing_id: verifiedMapListingId,
                    buyer_id: 'buyer-e2e',
                    status: 'pending_payment',
                    bandwidth_gb: body.bandwidth_gb ?? 1,
                    total_amount: verifiedMapPoint.price_per_gb,
                },
                proxy_credentials: mockProxyCredentials,
            }),
        });
    });
    await page.route('**/v1/orders/order-map-e2e-1/pay/solana', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                seller_pubkey: 'GXdz7cj6JK4qvQzgrwkBPJUkgcFMW68jQwonMQqAzrkF',
                amount_lamports: 1_000_000,
                bandwidth_gb: 1,
            }),
        });
    });
}

test.describe('marketplace map buy-from-map', () => {
    test.setTimeout(90_000);

    test('opens buy modal from map pin detail', async ({ page }) => {
        await stubMarketplaceMapApis(page);

        await page.goto(`${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`, {
            waitUntil: 'domcontentloaded',
        });

        await expect(page.getByRole('heading', { name: verifiedMapPoint.title })).toBeVisible({
            timeout: 15000,
        });

        await page.getByRole('button', { name: /buy bandwidth/i }).click();

        const modal = page.getByTestId('buy-listing-modal');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await expect(modal.getByRole('heading', { name: /connect to node/i })).toBeVisible();
        await expect(modal.getByText(verifiedMapPoint.title)).toBeVisible();
    });

    test('completes mocked purchase from map and shows proxy credentials', async ({ page }) => {
        await enableE2EMockBuy(page);
        await stubMarketplaceMapApis(page);
        await stubPurchaseApis(page);

        await page.goto(`${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`, {
            waitUntil: 'domcontentloaded',
        });

        await expect(page.getByRole('heading', { name: verifiedMapPoint.title })).toBeVisible({
            timeout: 15000,
        });

        await page.getByRole('button', { name: /buy bandwidth/i }).click();
        await expect(page.getByTestId('buy-listing-modal')).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: /start connection/i }).click();

        await expect(page.getByRole('heading', { name: /connected!/i })).toBeVisible({
            timeout: 20000,
        });
        await expect(page.getByText(mockProxyCredentials.endpoint)).toBeVisible();
        await expect(page.getByText(mockProxyCredentials.username)).toBeVisible();
    });
});
