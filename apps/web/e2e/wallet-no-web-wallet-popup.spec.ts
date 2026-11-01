import { expect, test } from '@playwright/test';
import { seedSignedAuth } from './fixtures/signed-auth';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

// A signed-in user whose profile has a linked wallet, in a browser with no wallet extension.
// LinkedWalletAutoReconnect used to treat the Solflare *web wallet* ("Loadable", available in
// every browser) as an installed wallet and auto-connect it, which loads connect.solflare.com
// in a full-page iframe that covers the app and swallows every click (the intermittent
// "<iframe ...> subtree intercepts pointer events" failures in CI).
test.describe('wallet auto-reconnect', () => {
    test.setTimeout(180_000);

    test('does not open a web wallet when no wallet extension is installed', async ({ page }) => {
        await page.route('**/v1/**', (route) => route.fulfill({
            status: 503,
            json: { error: 'Fixture wallet source unavailable' },
        }));
        await seedSignedAuth(page, BASE_URL, 'provider');

        await page.goto(`${BASE_URL}/app/wallet`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        // The reconnect effect runs once the user and the wallet list are available.
        await page.waitForTimeout(10_000);

        await expect(page.locator('iframe[src*="connect.solflare.com"]')).toHaveCount(0);
        await expect(page.locator('.solflare-wallet-adapter-iframe')).toHaveCount(0);
    });
});
