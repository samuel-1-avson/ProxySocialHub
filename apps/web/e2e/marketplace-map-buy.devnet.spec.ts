import { expect, test } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';
const requiredEnv = [
    'E2E_LIVE_MAP_BUY',
    'TEST_BUYER_JWT',
    'E2E_LIVE_LISTING_ID',
    'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_TEST_WALLET',
    'NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET',
    'NEXT_PUBLIC_SOLANA_PROGRAM_ID',
    'NEXT_PUBLIC_SOLANA_RPC_URL',
] as const;

function missingEnv() {
    return requiredEnv.filter((key) => !process.env[key] || process.env[key] === '0');
}

test.describe('marketplace map live devnet buy', () => {
    test('creates a real control-api order and funds Solana devnet escrow', async ({ page }) => {
        const missing = missingEnv();
        test.skip(
            missing.length > 0,
            `Live devnet map buy skipped. Missing env: ${missing.join(', ')}`
        );

        test.setTimeout(120_000);
        const token = process.env.TEST_BUYER_JWT!;
        const listingId = process.env.E2E_LIVE_LISTING_ID!;

        await page.context().addCookies([
            {
                name: 'proxyhubb_token',
                value: token,
                url: BASE_URL.replace('localhost', '127.0.0.1'),
            },
        ]);
        await page.addInitScript((jwt) => {
            sessionStorage.setItem('proxyhubb_token', jwt);
        }, token);

        await page.goto(`${BASE_URL}/marketplace/map?listing=${listingId}`, {
            waitUntil: 'domcontentloaded',
        });

        await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible({
            timeout: 30_000,
        });
        await page.getByRole('button', { name: /buy bandwidth/i }).click();
        await expect(page.getByTestId('buy-listing-modal')).toBeVisible({ timeout: 30_000 });

        await page.getByRole('button', { name: /start connection/i }).click();

        await expect(page.getByTestId('buy-listing-modal-success')).toBeVisible({
            timeout: 90_000,
        });
        await expect(page.getByText(/proxy credentials/i)).toBeVisible();
    });
});
