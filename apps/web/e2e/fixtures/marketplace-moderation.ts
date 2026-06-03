/** Playwright stubs for marketplace listing moderation (admin queue). */

import type { Page } from '@playwright/test';
import { seedSignedAuth } from './signed-auth';

/** Middleware bypass + signed JWT + client auth stubs for /dashboard/admin. */
export async function enableE2EAdminSession(page: Page, baseUrl: string) {
    await seedSignedAuth(page, baseUrl, 'admin');
}

export const pendingListingId = '11111111-1111-1111-1111-111111111101';
export const pendingListingTitle = 'E2E Pending Residential US';

export const pendingListingPayload = {
    id: pendingListingId,
    title: pendingListingTitle,
    description: 'Listing awaiting operator approval',
    proxy_type: 'residential',
    protocol: 'http',
    country: 'US',
    price_per_gb: 4.25,
    status: 'pending_review',
    seller_id: '22222222-2222-2222-2222-222222222202',
};

function moderationPath(url: string): string {
    try {
        const path = new URL(url).pathname;
        return path.startsWith('/api/v1/') ? path.slice('/api'.length) : path;
    } catch {
        return '';
    }
}

export async function stubModerationQueue(page: Page, options?: { emptyAfterApprove?: boolean }) {
    let approved = false;

    await page.route('**/v1/moderation/listings/pending**', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        const body =
            approved && options?.emptyAfterApprove
                ? { listings: [], total: 0, page: 1, limit: 20 }
                : {
                      listings: [pendingListingPayload],
                      total: 1,
                      page: 1,
                      limit: 20,
                  };
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
    });

    await page.route('**/v1/moderation/listings/*/approve', async (route) => {
        const path = moderationPath(route.request().url());
        if (!path.endsWith('/approve') || route.request().method() !== 'POST') {
            await route.continue();
            return;
        }
        approved = true;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                message: 'Listing approved',
                listing: { ...pendingListingPayload, status: 'active' },
            }),
        });
    });
}
