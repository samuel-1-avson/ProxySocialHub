import { expect, test } from '@playwright/test';
import {
    e2eOrderId,
    enableE2EMockBuy,
    mockProxyCredentials,
    mockSessionCapability,
    stubPurchaseApis,
    stubExtensionPairStart,
    mockExtensionHandoff,
    verifiedMapListingId,
} from './fixtures/marketplace-purchase';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace order credentials page', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(180_000);

    test('shows proxy credentials for an active order', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await stubPurchaseApis(page, verifiedMapListingId);

        await page.goto(`${BASE_URL}/marketplace/orders/${e2eOrderId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 150_000,
        });

        const credentials = page.getByTestId('marketplace-order-credentials');
        await expect(credentials).toBeVisible({ timeout: 30_000 });
        await expect(credentials.getByText(mockProxyCredentials.endpoint).first()).toBeVisible();
        await expect(credentials.getByText(mockProxyCredentials.username).first()).toBeVisible();

        const curl = page.getByTestId('marketplace-order-credentials-curl');
        await expect(curl).toContainText(mockProxyCredentials.password);
        await expect(curl).toContainText(mockProxyCredentials.username);
        await expect(curl).not.toContainText('phubb1.');
        await expect(curl).not.toContainText(mockSessionCapability);

        await expect(page.getByTestId('marketplace-order-credentials-advanced')).toBeVisible();
        await expect(page.getByTestId('extension-connect-card')).toBeVisible();
        await expect(page.getByTestId('extension-connect-button')).toHaveText(/Connect with ProxyHubb/i);
    });

    test('Connect with ProxyHubb pairs and turns on a mocked extension', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await mockExtensionHandoff(page);
        await stubPurchaseApis(page, verifiedMapListingId);
        await stubExtensionPairStart(page);

        await page.goto(`${BASE_URL}/marketplace/orders/${e2eOrderId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 150_000,
        });

        await expect(page.getByTestId('extension-connect-card')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('extension-connect-button')).toBeEnabled();
        await page.getByTestId('extension-connect-button').click();
        await expect(page.getByTestId('extension-connect-status')).toContainText(/Connected/i, {
            timeout: 15_000,
        });
        await expect(page.getByTestId('extension-connect-button')).toHaveText(/Connected in this browser/i);
    });
});
