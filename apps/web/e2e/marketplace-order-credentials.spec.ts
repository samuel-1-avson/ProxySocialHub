import { expect, test } from '@playwright/test';
import {
    e2eOrderId,
    enableE2EMockBuy,
    mockProxyCredentials,
    stubPurchaseApis,
    verifiedMapListingId,
} from './fixtures/marketplace-purchase';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace order credentials page', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('shows proxy credentials for an active order', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubPurchaseApis(page, verifiedMapListingId);

        await page.goto(`${BASE_URL}/dashboard/orders/${e2eOrderId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 90_000,
        });

        const credentials = page.getByTestId('marketplace-order-credentials');
        await expect(credentials).toBeVisible({ timeout: 30_000 });
        await expect(credentials.getByText(mockProxyCredentials.endpoint).first()).toBeVisible();
        await expect(credentials.getByText(mockProxyCredentials.username).first()).toBeVisible();
    });
});
