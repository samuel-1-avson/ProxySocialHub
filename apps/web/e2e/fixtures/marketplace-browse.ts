/** Stubs for marketplace browse grid (`/marketplace`). */

import { mockListingDetail, mockListingSocialContext, verifiedMapListingId } from './marketplace-map';

export function mockBrowseListingsResponse() {
    const listing = mockListingDetail();
    return {
        listings: [listing],
        total: 1,
        page: 1,
    };
}

function isListingsIndex(url: string | URL): boolean {
    try {
        const path = url instanceof URL ? url.pathname : new URL(url).pathname;
        return path === '/v1/listings' || path === '/api/v1/listings';
    } catch {
        return typeof url === 'string' && /^\/v1\/listings(\?|$)/.test(url);
    }
}

export async function stubMarketplaceBrowse(
    page: import('@playwright/test').Page,
    listingId = verifiedMapListingId,
) {
    const listing = mockListingDetail();

    await page.route('**/v1/listings/facets**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                countries: [{ value: listing.country, count: 1 }],
                proxy_types: [{ value: listing.proxy_type, count: 1 }],
                isps: [{ value: listing.isp || 'Example ISP', count: 1 }],
                price_buckets: [{ min: 0, max: 10, count: 1 }],
            }),
        });
    });

    await page.route('**/v1/listings/collections**', async (route) => {
        const url = route.request().url();
        if (url.includes('/collections/featured')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    collection: {
                        slug: 'featured',
                        title: 'Featured',
                        description: 'Priority nodes',
                    },
                    listings: [listing],
                    total: 1,
                    page: 1,
                    limit: 20,
                }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                collections: [
                    {
                        slug: 'featured',
                        title: 'Featured',
                        description: 'Priority nodes',
                        count: 1,
                    },
                ],
            }),
        });
    });

    await page.route('**/v1/listings/featured**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ listings: [listing], total: 1 }),
        });
    });

    await page.route((url) => isListingsIndex(url), async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockBrowseListingsResponse()),
        });
    });

    await page.route('**/v1/matching/use-cases**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });

    await page.route(`**/v1/listings/${listingId}/social`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(mockListingSocialContext(listingId)),
        });
    });

    await page.route(`**/v1/listings/${listingId}/qa`, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ questions: [], count: 0 }),
        });
    });
}
