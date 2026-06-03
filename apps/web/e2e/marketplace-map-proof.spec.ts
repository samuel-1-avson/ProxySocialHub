import { expect, test } from '@playwright/test';
import {
    stubMarketplaceListingDetail,
    verifiedMapListingId,
    verifiedMapPoint,
} from './fixtures/marketplace-map';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace map proof badges', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(120_000);

    test('shows verified offer and heartbeat proof on map pin detail', async ({ page }) => {
        await stubMarketplaceListingDetail(page);

        await page.goto(
            `${BASE_URL}/marketplace/map?listing=${verifiedMapListingId}`,
            { waitUntil: 'domcontentloaded' }
        );

        await expect(page.getByRole('heading', { name: verifiedMapPoint.title, level: 2 })).toBeVisible({
            timeout: 30000,
        });
        await expect(page.getByText('Offer proof')).toBeVisible();
        await expect(page.getByText('Provider signed').first()).toBeVisible();
        await expect(page.getByText('Heartbeat proof')).toBeVisible();
    });
});

