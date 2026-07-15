/** Playwright stubs for provider catalog manage UI. */

import type { Page } from '@playwright/test';
import { seedSignedAuth } from './signed-auth';

export async function enableE2EProviderSession(page: Page, baseUrl: string) {
    await seedSignedAuth(page, baseUrl, 'provider');
}

export const catalogProductId = '66666666-6666-6666-6666-666666666606';
export const newCatalogTitle = 'E2E Catalog Product';

export async function stubCatalogManageApi(page: Page) {
    const products: Array<{
        id: string;
        seller_id: string;
        slug: string;
        title: string;
        description: string;
        status: string;
        created_at: string;
        updated_at: string;
    }> = [];

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

    await page.route('**/v1/catalog/products', async (route) => {
        if (route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        const body = route.request().postDataJSON() as { title?: string; description?: string; status?: string };
        const product = {
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
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ product }),
        });
    });
}
