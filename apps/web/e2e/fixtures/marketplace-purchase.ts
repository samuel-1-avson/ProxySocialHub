/** Shared Playwright stubs for marketplace buy flows (map + listing detail). */



import { expect } from '@playwright/test';

import { verifiedMapListingId, verifiedMapPoint } from './marketplace-map';
import { seedSignedAuth } from './signed-auth';



export const e2eOrderId = 'order-map-e2e-1';



export const mockProxyCredentials = {
    endpoint: 'proxy.e2e.test:8080',
    username: 'e2e-map-buyer',
    password: 'e2e-map-secret',
    legacy_password: 'e2e-map-secret',
    auth_for_endpoint: 'hmac' as const,
};

/** Soak-only token. Must never appear in the shop curl snippet. */
export const mockSessionCapability = 'phubb1.e2e-soak-not-for-public-endpoint';



function orderPath(url: string): string {

    try {

        const path = new URL(url).pathname;

        return path.startsWith('/api/v1/orders') ? path.slice('/api'.length) : path;

    } catch {

        return '';

    }

}



export async function enableE2EMockBuy(page: import('@playwright/test').Page, baseUrl: string) {
    await seedSignedAuth(page, baseUrl, 'buyer');

    await page.addInitScript(() => {
        (window as Window & { __PROXYHUB_E2E_MOCK_BUY__?: boolean }).__PROXYHUB_E2E_MOCK_BUY__ = true;
    });

    // Purchase stubs expect this buyer id (overrides seedSignedAuth /v1/auth/me).
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



export async function stubPurchaseApis(

    page: import('@playwright/test').Page,

    listingId = verifiedMapListingId,

) {

    await page.route((url) => orderPath(url).startsWith('/v1/orders'), async (route) => {

        const path = orderPath(route.request().url());

        const method = route.request().method();



        if (method === 'POST' && path === '/v1/orders') {

            const body = route.request().postDataJSON() as { listing_id?: string; bandwidth_gb?: number };

            expect(body.listing_id).toBe(listingId);

            await route.fulfill({

                status: 201,

                contentType: 'application/json',

                body: JSON.stringify({

                    order: {

                        id: e2eOrderId,

                        listing_id: listingId,

                        buyer_id: 'buyer-e2e',

                        status: 'pending',

                        bandwidth_gb: body.bandwidth_gb ?? 1,

                        total_price: verifiedMapPoint.price_per_gb,

                        session_id: 'session-e2e-1',

                        session_status: 'disabled',

                    },

                }),

            });

            return;

        }



        if (method === 'GET' && path === `/v1/orders/${e2eOrderId}`) {

            await route.fulfill({

                status: 200,

                contentType: 'application/json',

                body: JSON.stringify({

                    id: e2eOrderId,

                    listing_id: listingId,

                    buyer_id: 'buyer-e2e',

                    status: 'active',

                    bandwidth_gb: 1,

                    total_price: verifiedMapPoint.price_per_gb,

                    listing: {
                        title: 'E2E map listing',
                    },

                }),

            });

            return;

        }



        if (method === 'GET' && path === `/v1/orders/${e2eOrderId}/credentials`) {

            await route.fulfill({

                status: 200,

                contentType: 'application/json',

                body: JSON.stringify({
                    proxy_credentials: mockProxyCredentials,
                    session_capability: mockSessionCapability,
                    session_capability_note:
                        'Soak CONNECT token. Public buyer edge uses proxy_credentials.password (HMAC).',
                }),

            });

            return;

        }



        if (method === 'POST' && path === `/v1/orders/${e2eOrderId}/pay/solana`) {

            await route.fulfill({

                status: 200,

                contentType: 'application/json',

                body: JSON.stringify({

                    seller_pubkey: 'GXdz7cj6JK4qvQzgrwkBPJUkgcFMW68jQwonMQqAzrkF',

                    amount_lamports: 1_000_000,

                    bandwidth_gb: 1,

                }),

            });

            return;

        }



        // BuyListingModal confirms the (mocked) escrow before polling the order; without
        // this the request fell through to the dev server proxy and the buy showed
        // "Request failed".
        if (method === 'POST' && path === `/v1/orders/${e2eOrderId}/confirm-escrow`) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    order: {
                        id: e2eOrderId,
                        listing_id: listingId,
                        buyer_id: 'buyer-e2e',
                        status: 'active',
                        bandwidth_gb: 1,
                        total_price: verifiedMapPoint.price_per_gb,
                    },
                    escrow_pda: 'EscrowPdaE2E111111111111111111111111111111111',
                    on_chain_status: 'Active',
                }),
            });
            return;
        }

        await route.continue();

    });

}

export async function stubExtensionPairStart(page: import('@playwright/test').Page) {
    await page.route((url) => {
        try {
            return new URL(url).pathname.endsWith('/v1/extension/pair/start');
        } catch {
            return false;
        }
    }, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'ABCD2345', expires_in: 60 }),
        });
    });
}

/** Page-side chrome.runtime mock so Connect with ProxyHubb can one-click without a real MV3 extension. */
export async function mockExtensionHandoff(page: import('@playwright/test').Page) {
    await page.addInitScript(() => {
        const w = window as Window & {
            __PROXYHUB_EXTENSION_ID__?: string;
            chrome?: {
                runtime?: {
                    sendMessage: (extensionId: string, message: unknown, cb?: (response: unknown) => void) => void;
                };
            };
        };
        w.__PROXYHUB_EXTENSION_ID__ = 'abcdefghijklmnopabcdefghijklmnop';
        w.chrome = {
            runtime: {
                sendMessage: (_extensionId, message, cb) => {
                    const payload = message as { type?: string; orderId?: string };
                    const reply = (response: unknown) => {
                        if (cb) {
                            queueMicrotask(() => cb(response));
                        }
                    };
                    if (payload?.type === 'ping') {
                        reply({ ok: true, installed: true, signedIn: false, version: '0.4.0' });
                        return;
                    }
                    if (payload?.type === 'pair') {
                        reply({ ok: true, email: 'buyer-e2e@proxyhubb.test' });
                        return;
                    }
                    if (payload?.type === 'connect') {
                        reply({ ok: true, status: { state: 'on', orderId: payload.orderId } });
                        return;
                    }
                    reply({ ok: false, error: 'unknown' });
                },
            },
        };
    });
}



