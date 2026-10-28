import { expect, test } from '@playwright/test';
import { seedSignedAuth } from './fixtures/signed-auth';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

async function stubAgentsApis(page: import('@playwright/test').Page) {
    await page.route('**/v1/agents', async (route) => {
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 'agent-smoke-1',
                    name: 'Smoke Test Agent',
                    description: 'E2E fixture agent',
                    category: 'automation',
                    price_per_run: 0,
                },
            ]),
        });
    });

    await page.route('**/v1/agents/instances', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });
}

/** These routes redirect to the console; on a cold dev server the first navigation can
 * be replaced mid-flight (net::ERR_ABORTED), so wait for where it ends up instead. */
async function gotoAgentConsole(page: import('@playwright/test').Page, path: string) {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'commit' }).catch(() => undefined);
    await page.waitForURL((url) => url.pathname === '/dashboard/agents', { timeout: 60_000 });
}

test.describe('agents IA (Phase C — console only)', () => {
    test.setTimeout(120_000);

    test('redirects /agents to Agent console', async ({ page }) => {
        await seedSignedAuth(page, BASE_URL, 'buyer');
        await stubAgentsApis(page);
        await gotoAgentConsole(page, '/agents');
        await expect(page.getByRole('heading', { name: /agent console/i })).toBeVisible({
            timeout: 15_000,
        });
        await expect(page.getByText(/experimental/i).first()).toBeVisible({ timeout: 15_000 });
    });

    test('permanent-redirects legacy /marketplace/agents to Agent console', async ({ page }) => {
        await seedSignedAuth(page, BASE_URL, 'buyer');
        await stubAgentsApis(page);
        await gotoAgentConsole(page, '/marketplace/agents');
        await expect(page.getByRole('heading', { name: /agent console/i })).toBeVisible({
            timeout: 15_000,
        });
    });

    test('redirects /agents/instances to Agent console when authenticated', async ({ page }) => {
        await seedSignedAuth(page, BASE_URL, 'buyer');
        await stubAgentsApis(page);
        await gotoAgentConsole(page, '/agents/instances');
        await expect(page.getByRole('heading', { name: /agent console/i })).toBeVisible({
            timeout: 15_000,
        });
    });
});
