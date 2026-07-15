/** Signed JWT + API stubs for dashboard E2E (matches route-policy.spec.ts). */

import { createHmac } from 'crypto';
import type { Page } from '@playwright/test';

export const DEFAULT_E2E_JWT_SECRET = 'proxyhubb-e2e-route-policy-secret-at-least-64-characters-long';

export type MockRole = 'buyer' | 'provider' | 'both' | 'admin';

const preSignedTokens: Partial<Record<MockRole, string>> = {
    buyer: process.env.TEST_BUYER_JWT,
    provider: process.env.TEST_PROVIDER_JWT,
    both: process.env.TEST_BOTH_JWT,
    admin: process.env.TEST_ADMIN_JWT,
};

function base64Url(input: Buffer | string) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

export function signJwt(role: MockRole, secret = process.env.TEST_JWT_SECRET || process.env.JWT_SECRET || DEFAULT_E2E_JWT_SECRET) {
    if (preSignedTokens[role]) {
        return preSignedTokens[role] as string;
    }

    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64Url(
        JSON.stringify({
            sub: `${role}-route-policy-user`,
            role,
            email: `${role}@example.test`,
            iss: 'proxyhubb-control-api',
            exp: Math.floor(Date.now() / 1000) + 60 * 60,
        }),
    );
    const unsigned = `${header}.${payload}`;
    const signature = createHmac('sha256', secret).update(unsigned).digest();

    return `${unsigned}.${base64Url(signature)}`;
}

function cookieOrigins(baseUrl: string): string[] {
    const origins = [baseUrl, baseUrl.replace('localhost', '127.0.0.1')];
    return [...new Set(origins)];
}

export async function seedSignedAuth(page: Page, baseUrl: string, role: MockRole) {
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

    await page.context().addCookies(
        cookieOrigins(baseUrl).flatMap((url) => [
            {
                name: 'proxyhubb_e2e_auth',
                value: '1',
                url,
            },
            {
                name: 'proxyhubb_token',
                value: token,
                url,
                sameSite: 'Lax' as const,
            },
        ]),
    );

    await page.addInitScript(({ seededToken, seededUser }) => {
        sessionStorage.setItem('proxyhubb_token', seededToken);
        localStorage.setItem('proxyhubb_token', seededToken);
        localStorage.setItem('proxyhubb_refresh_token', 'route-policy-refresh-token');
        localStorage.setItem('proxyhubb_e2e_user', JSON.stringify(seededUser));
        document.cookie = `proxyhubb_token=${encodeURIComponent(seededToken)}; path=/; max-age=3600; samesite=lax`;
        document.cookie = 'proxyhubb_refresh_token=route-policy-refresh-token; path=/; max-age=3600; samesite=lax';
    }, { seededToken: token, seededUser: user });

    await page.route('**/v1/auth/refresh', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token, refresh_token: 'route-policy-refresh-token' }),
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
