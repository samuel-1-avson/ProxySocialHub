import { expect, test } from '@playwright/test';
import {
    enableE2EAdminSession,
    pendingListingId,
    pendingListingTitle,
    stubModerationQueue,
} from './fixtures/marketplace-moderation';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

test.describe('marketplace admin moderation', () => {
    test.setTimeout(120_000);

    test('shows pending listing and approves from queue', async ({ page }) => {
        await enableE2EAdminSession(page, BASE_URL);
        await stubModerationQueue(page, { emptyAfterApprove: true });

        await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.getByText(/^Loading\.\.\.$/).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);

        await expect(page).toHaveURL(/\/dashboard\/admin/, { timeout: 30_000 });
        await expect(page.getByTestId('admin-listing-moderation')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(pendingListingTitle)).toBeVisible({ timeout: 10000 });

        const row = page.getByTestId(`pending-listing-${pendingListingId}`);
        await row.getByRole('button', { name: /approve/i }).click();

        await expect(page.getByText(/no listings awaiting review/i)).toBeVisible({ timeout: 15000 });
    });
});
