/** Shared Playwright stubs for marketplace buy flows (map + listing detail). */



import { expect } from '@playwright/test';

import { verifiedMapListingId, verifiedMapPoint } from './marketplace-map';
import { seedSignedAuth } from './signed-auth';



export const e2eOrderId = 'order-map-e2e-1';



export const mockProxyCredentials = {

    endpoint: 'proxy.e2e.test:8080',

    username: 'e2e-map-buyer',

    password: 'e2e-map-secret',

};



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

                }),

            });

            return;

        }



        if (method === 'GET' && path === `/v1/orders/${e2eOrderId}/credentials`) {

            await route.fulfill({

                status: 200,

                contentType: 'application/json',

                body: JSON.stringify({ proxy_credentials: mockProxyCredentials }),

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



        await route.continue();

    });

}


