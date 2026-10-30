import { expect, test } from '@playwright/test';
import { createHmac } from 'crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';
const DEFAULT_E2E_JWT_SECRET = 'proxyhubb-e2e-route-policy-secret-at-least-64-characters-long';
const JWT_SECRET = process.env.TEST_JWT_SECRET || process.env.JWT_SECRET || DEFAULT_E2E_JWT_SECRET;

type MockRole = 'buyer' | 'provider' | 'both' | 'admin';

const preSignedTokens: Partial<Record<MockRole, string>> = {
    buyer: process.env.TEST_BUYER_JWT,
    provider: process.env.TEST_PROVIDER_JWT,
    both: process.env.TEST_BOTH_JWT,
    admin: process.env.TEST_ADMIN_JWT,
};

const hasRequiredPreSignedTokens = !!preSignedTokens.buyer && !!preSignedTokens.provider && !!preSignedTokens.admin;
const canRunSignedJwtPolicyTests = !process.env.TEST_BASE_URL || hasRequiredPreSignedTokens || !!process.env.TEST_JWT_SECRET || !!process.env.JWT_SECRET;

function base64Url(input: Buffer | string) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function signJwt(role: MockRole) {
    if (preSignedTokens[role]) {
        return preSignedTokens[role];
    }

    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64Url(JSON.stringify({
        sub: `${role}-route-policy-user`,
        role,
        email: `${role}@example.test`,
        iss: 'proxyhubb-control-api',
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
    }));
    const unsigned = `${header}.${payload}`;
    const signature = createHmac('sha256', JWT_SECRET).update(unsigned).digest();

    return `${unsigned}.${base64Url(signature)}`;
}

async function seedSignedAuth(page: Parameters<typeof test>[0]['page'], role: MockRole) {
    const token = signJwt(role);
    const user = {
        id: `${role}-route-policy-user`,
        email: `${role}@example.test`,
        role,
        username: `${role}-route-policy`,
        wallet_address: '5J7sQx1LQx32fY6k3i8rXQ9rC3Z1V3aNQ3fxh7c7c4yD',
        trust_tier: 'verified',
        verified: true,
    };

    await page.context().addCookies([
        {
            name: 'proxyhubb_token',
            value: token,
            url: BASE_URL,
            sameSite: 'Lax',
        },
    ]);

    await page.addInitScript(({ seededToken, seededUser }) => {
        sessionStorage.setItem('proxyhubb_token', seededToken);
        localStorage.setItem('proxyhubb_e2e_user', JSON.stringify(seededUser));
    }, { seededToken: token, seededUser: user });

    await page.route('**/v1/auth/refresh', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: token, refresh_token: 'route-policy-refresh-token' }),
        });
    });

    await page.route('**/v1/auth/me', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(user),
        });
    });
}

test.describe('route policy middleware', () => {
    test.setTimeout(120_000);

    test('allows public marketplace, explorer, governance, and public profile routes', async ({ page }) => {
        for (const path of [
            '/marketplace/map',
            '/governance',
            '/profile/public-user',
        ]) {
            await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
            expect(new URL(page.url()).pathname).toBe(path);
        }
        await page.goto(`${BASE_URL}/explorer/map`, { waitUntil: 'domcontentloaded' });
        expect(new URL(page.url()).hostname).toBe('explorer.proxyhubb.com');
    });

    test('redirects unauthenticated authenticated/provider routes to login', async ({ page }) => {
        for (const path of ['/dashboard', '/governance/create', '/marketplace/create', '/dashboard/provider/nodes']) {
            await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
            const url = new URL(page.url());

            expect(url.pathname, `${path} should redirect to login`).toBe('/login');
            expect(url.searchParams.get('next') || url.searchParams.get('redirect')).toContain(path);
        }
    });

    test('redirects a buyer away from provider routes', async ({ page }) => {
        test.skip(!canRunSignedJwtPolicyTests, 'signed JWT policy tests require TEST_JWT_SECRET/JWT_SECRET when TEST_BASE_URL is used');

        await seedSignedAuth(page, 'buyer');
        await page.goto(`${BASE_URL}/dashboard/provider/nodes`, { waitUntil: 'domcontentloaded' });

        const url = new URL(page.url());
        expect(url.pathname).toBe('/dashboard');
        expect(url.searchParams.get('error')).toBe('provider_required');
    });

    test('allows a buyer onto provider onboarding routes', async ({ page }) => {
        test.skip(!canRunSignedJwtPolicyTests, 'signed JWT policy tests require TEST_JWT_SECRET/JWT_SECRET when TEST_BASE_URL is used');

        await seedSignedAuth(page, 'buyer');
        for (const path of ['/dashboard/provider', '/dashboard/become-provider']) {
            await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });

            const url = new URL(page.url());
            expect(url.pathname).toBe(path);
            expect(url.searchParams.get('error')).toBeNull();
        }
    });

    test('allows a provider onto provider routes', async ({ page }) => {
        test.skip(!canRunSignedJwtPolicyTests, 'signed JWT policy tests require TEST_JWT_SECRET/JWT_SECRET when TEST_BASE_URL is used');

        await seedSignedAuth(page, 'provider');
        await page.goto(`${BASE_URL}/dashboard/provider/nodes`, { waitUntil: 'domcontentloaded' });

        const url = new URL(page.url());
        expect(url.pathname).toBe('/dashboard/provider/nodes');
        expect(url.searchParams.get('error')).toBeNull();
    });

    test('redirects a provider away from admin routes and allows an admin', async ({ page, browser }) => {
        test.skip(!canRunSignedJwtPolicyTests, 'signed JWT policy tests require TEST_JWT_SECRET/JWT_SECRET when TEST_BASE_URL is used');

        await seedSignedAuth(page, 'provider');
        await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: 'domcontentloaded' });

        let url = new URL(page.url());
        expect(url.pathname).toBe('/dashboard');
        expect(url.searchParams.get('error')).toBe('admin_required');

        const adminPage = await browser.newPage();
        await seedSignedAuth(adminPage, 'admin');
        await adminPage.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: 'domcontentloaded' });

        url = new URL(adminPage.url());
        expect(url.pathname).toBe('/dashboard/admin');
        await adminPage.close();
    });
});
