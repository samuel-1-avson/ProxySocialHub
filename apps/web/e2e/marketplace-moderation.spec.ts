import { expect, test } from '@playwright/test';
import {
    enableE2EAdminSession,
    pendingForumReportId,
    pendingForumReportTitle,
    pendingListingId,
    pendingListingTitle,
    stubForumReportsQueue,
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

    test('shows pending forum report and resolves from queue', async ({ page }) => {
        await enableE2EAdminSession(page, BASE_URL);
        await stubForumReportsQueue(page, { emptyAfterResolve: true });

        await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.getByText(/^Loading\.\.\.$/).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);

        await page.getByRole('button', { name: /forum reports/i }).click();
        await expect(page.getByTestId('admin-forum-reports')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(pendingForumReportTitle)).toBeVisible({ timeout: 10000 });

        const row = page.getByTestId(`forum-report-${pendingForumReportId}`);
        // Each report offers hide/lock/delete + resolve; "Resolve only" leaves the post alone.
        await row.getByRole('button', { name: /^resolve only$/i }).click();

        await expect(page.getByText(/no reports in this queue/i)).toBeVisible({ timeout: 15000 });
    });
});
