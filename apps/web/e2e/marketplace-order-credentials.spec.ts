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
        await credentials.getByText('Use in another app or device').click();
        const [host, port] = mockProxyCredentials.endpoint.split(':');
        await expect(credentials.getByText(host, { exact: true })).toBeVisible();
        await expect(credentials.getByText(port, { exact: true })).toBeVisible();
        await expect(credentials.getByText(mockProxyCredentials.username).first()).toBeVisible();

        const curl = page.getByTestId('marketplace-order-credentials-curl');
        await expect(curl).toContainText(mockProxyCredentials.password);
        await expect(curl).toContainText(mockProxyCredentials.username);
        await expect(curl).not.toContainText('phubb1.');
        await expect(curl).not.toContainText(mockSessionCapability);
        // Internal soak tokens and gateway jargon are not shown to buyers.
        await expect(page.getByText(/soak|HMAC|edge gateway/i)).toHaveCount(0);

        // No extension in this browser: the card explains, and there is no Turn on button.
        await expect(page.getByTestId('extension-connect-card')).toBeVisible();
        await expect(page.getByTestId('extension-install-hint')).not.toHaveText(/Checking/i, { timeout: 15_000 });
        await expect(page.getByTestId('extension-connect-button')).toHaveCount(0);
    });

    test('Turn on proxy pairs and turns on a mocked extension', async ({ page }) => {
        await enableE2EMockBuy(page, BASE_URL);
        await mockExtensionHandoff(page);
        await stubPurchaseApis(page, verifiedMapListingId);
        await stubExtensionPairStart(page);

        await page.goto(`${BASE_URL}/marketplace/orders/${e2eOrderId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 150_000,
        });

        await expect(page.getByTestId('extension-connect-card')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('extension-connect-button')).toHaveText(/Turn on proxy/i, { timeout: 15_000 });
        await page.getByTestId('extension-connect-button').click();
        await expect(page.getByText('Proxy is on in this browser')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('extension-install-hint')).toContainText('203.0.113.7');

        await page.getByTestId('extension-disconnect-button').click();
        await expect(page.getByTestId('extension-connect-button')).toHaveText(/Turn on proxy/i);
    });
});
