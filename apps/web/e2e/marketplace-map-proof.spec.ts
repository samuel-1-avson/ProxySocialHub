import { expect, test } from '@playwright/test';
import { mockListingDetail, mockMapResponse, verifiedMapListingId, verifiedMapPoint } from './fixtures/marketplace-map';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace map proof badges', () => {
    test('shows verified offer and heartbeat proof on map pin detail', async ({ page }) => {
        await page.route('**/v1/marketplace/map**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockMapResponse()),
            });
        });
        await page.route(`**/v1/listings/${verifiedMapListingId}**`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ listing: mockListingDetail(), is_saved: false }),
            });
        });

        await page.goto(
            `${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`,
            { waitUntil: 'domcontentloaded' }
        );

        await expect(page.getByRole('heading', { name: verifiedMapPoint.title })).toBeVisible({
            timeout: 15000,
        });
        await expect(page.getByText('Offer proof')).toBeVisible();
        await expect(page.getByText('Provider signed').first()).toBeVisible();
        await expect(page.getByText('Heartbeat proof')).toBeVisible();
    });
});
