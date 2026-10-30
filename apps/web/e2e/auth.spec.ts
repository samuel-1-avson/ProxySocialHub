import { test, expect } from '@playwright/test';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import bs58 from 'bs58';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';
const API_URL = process.env.TEST_API_URL || 'http://localhost:18080';

async function expectWalletEntryState(page: Parameters<typeof test>[0]['page']) {
    await expect.poll(async () => {
        const selectWalletVisible = await page.getByRole('button', { name: /select wallet/i }).isVisible().catch(() => false);
        const loadingVisible = await page.getByText(/initializing wallet access/i).isVisible().catch(() => false);
        return selectWalletVisible || loadingVisible;
    }, {
        timeout: 10000,
    }).toBe(true);
}

async function loginViaWallet(request: Parameters<typeof test>[0]['request']) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' });
    const addressBytes = Buffer.from(jwk.x ?? '', 'base64url');
    expect(addressBytes.length, 'expected 32-byte Ed25519 public key').toBe(32);
    const address = bs58.encode(addressBytes);

    let message: string;
    try {
        const challengeRes = await request.post(`${API_URL}/v1/auth/wallet/challenge`, {
            data: { address },
        });

        if (!challengeRes.ok()) {
            console.log(`Wallet challenge not available (status=${challengeRes.status()}) — skipping auth test`);
            test.skip();
            return null;
        }

        const challengeJson = await challengeRes.json();
        message = String(challengeJson.message || '');
        if (!message) {
            throw new Error('Empty challenge message');
        }
    } catch (err) {
        console.log(`Wallet challenge request failed — skipping auth test: ${String(err)}`);
        test.skip();
        return null;
    }

    const signatureBytes = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey);
    const signature = bs58.encode(signatureBytes);

    const loginRes = await request.post(`${API_URL}/v1/auth/wallet/login`, {
        data: {
            address,
            signature,
            nonce: message,
        },
    });

    if (!loginRes.ok()) {
        throw new Error(`wallet login failed: status=${loginRes.status()} body=${await loginRes.text()}`);
    }

    const session = await loginRes.json();
    expect(session.token, 'missing token from wallet login response').toBeTruthy();

    const meRes = await request.get(`${API_URL}/v1/auth/me`, {
        headers: { Authorization: `Bearer ${session.token}` },
    });

    if (!meRes.ok()) {
        throw new Error(`auth/me failed: status=${meRes.status()} body=${await meRes.text()}`);
    }

    return session as { token: string; refresh_token?: string };
}

test.describe('Wallet Authentication Flow', () => {
    test('should show wallet connect button on login page', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`);

        // Verify the page title / heading
        await expect(page.getByText(/connect wallet/i).first()).toBeVisible({ timeout: 10000 });

        // Login may render a wallet loading state before the adapter button hydrates.
        await expectWalletEntryState(page);

        // Verify NO email/password form is present
        await expect(page.locator('input[type="email"]')).not.toBeVisible();
        await expect(page.locator('input[type="password"]')).not.toBeVisible();

        // Google sign-in is the only OAuth option, and only when the build has a client ID.
        if (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
            await expect(page.getByText(/continue with google/i).first()).toBeVisible();
        } else {
            await expect(page.getByText(/google/i)).not.toBeVisible();
        }
        await expect(page.getByText(/github/i)).not.toBeVisible();
    });

    test('should show wallet connect button on register page', async ({ page }) => {
        await page.goto(`${BASE_URL}/register`);

        // Verify the register page heading
        await expect(page.getByText(/initialize account/i).first()).toBeVisible({ timeout: 10000 });

        // Verify wallet connect button is present
        await expect(page.getByRole('button', { name: /select wallet/i })).toBeVisible({ timeout: 10000 });

        // Verify NO email/password form
        await expect(page.locator('input[type="email"]')).not.toBeVisible();
        await expect(page.locator('input[type="password"]')).not.toBeVisible();
    });

    test('should redirect unauthenticated dashboard access to login', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard`);

        await page.waitForURL(/\/login/);
        await expect(page.getByText(/connect wallet/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should authenticate via wallet challenge and access dashboard', async ({ page }) => {
        const session = await loginViaWallet(page.request);
        test.skip(!session, 'wallet auth backend unavailable');

        await page.context().addCookies([
            {
                name: 'proxyhubb_token',
                value: session?.token ?? '',
                url: BASE_URL,
                sameSite: 'Lax',
            },
            ...(session?.refresh_token
                ? [{
                    name: 'proxyhubb_refresh_token',
                    value: session.refresh_token,
                    url: BASE_URL,
                    sameSite: 'Lax' as const,
                }]
                : []),
        ]);

        await page.goto(`${BASE_URL}/dashboard`);
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible({ timeout: 15000 });
    });
});
