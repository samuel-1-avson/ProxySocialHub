/** Playwright stubs for provider catalog manage UI + browse handoff. */

import type { Page } from '@playwright/test';
import { seedSignedAuth } from './signed-auth';
import { mockListingDetail, verifiedMapListingId } from './marketplace-map';
import { stubMarketplaceBrowse } from './marketplace-browse';

export async function enableE2EProviderSession(page: Page, baseUrl: string) {
    await seedSignedAuth(page, baseUrl, 'provider');
}

export const catalogProductId = '66666666-6666-6666-6666-666666666606';
export const catalogOfferId = '77777777-7777-7777-7777-777777777707';
export const catalogListingId = verifiedMapListingId;
export const newCatalogTitle = 'E2E Catalog Product';
export const supplyListingTitle = 'Verified Austin Residential';

type CatalogProductRow = {
    id: string;
    seller_id: string;
    slug: string;
    title: string;
    description: string;
    status: string;
    created_at: string;
    updated_at: string;
};

type CatalogOfferRow = {
    id: string;
    product_id: string;
    listing_id: string;
    is_primary: boolean;
    listing?: ReturnType<typeof mockListingDetail>;
};

export async function stubCatalogManageApi(page: Page) {
    const products: CatalogProductRow[] = [];
    const offersByProduct = new Map<string, CatalogOfferRow[]>();

    const supplyListing = mockListingDetail({
        id: catalogListingId,
        title: supplyListingTitle,
        catalog_product: undefined,
    });

    await page.route('**/v1/listings/my**', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                listings: [supplyListing],
                total: 1,
                page: 1,
                limit: 100,
            }),
        });
    });

    await page.route('**/v1/catalog/products/my**', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                products,
                total: products.length,
                page: 1,
                limit: 20,
            }),
        });
    });

    await page.route(`**/v1/catalog/products/${catalogProductId}`, async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const product = products.find((p) => p.id === catalogProductId);
        if (!product) {
            await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                product,
                offers: offersByProduct.get(catalogProductId) ?? [],
            }),
        });
    });

    await page.route(`**/v1/catalog/products/${catalogProductId}/offers`, async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        const body = route.request().postDataJSON() as { listing_id?: string };
        const offer: CatalogOfferRow = {
            id: catalogOfferId,
            product_id: catalogProductId,
            listing_id: body.listing_id ?? catalogListingId,
            is_primary: true,
            listing: supplyListing,
        };
        offersByProduct.set(catalogProductId, [offer]);
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ offer }),
        });
    });

    await page.route('**/v1/catalog/products', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        const body = route.request().postDataJSON() as {
            title?: string;
            description?: string;
            status?: string;
        };
        const product: CatalogProductRow = {
            id: catalogProductId,
            seller_id: 'provider-route-policy-user',
            slug: 'e2e-catalog-product',
            title: body.title ?? newCatalogTitle,
            description: body.description ?? '',
            status: body.status ?? 'draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        products.push(product);
        offersByProduct.set(product.id, []);
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ product }),
        });
    });
}

/** After a product is linked in manage UI, browse should show merchandised title. */
export async function stubCatalogBrowseWithLinkedProduct(page: Page, productTitle = newCatalogTitle) {
    await stubMarketplaceBrowse(page);
    // Override listings index to prefer catalog product title on the card.
    await page.route((url) => {
        try {
            const path = url instanceof URL ? url.pathname : new URL(url).pathname;
            return path === '/v1/listings' || path === '/api/v1/listings';
        } catch {
            return false;
        }
    }, async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const listing = mockListingDetail({
            title: supplyListingTitle,
            catalog_product: {
                id: catalogProductId,
                slug: 'e2e-catalog-product',
                title: productTitle,
                status: 'active',
            },
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ listings: [listing], total: 1, page: 1 }),
        });
    });
}
