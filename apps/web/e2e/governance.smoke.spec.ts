import { expect, test } from '@playwright/test';

/**
 * Local/docker smoke for Phase 3 community + governance UI (no devnet wallet).
 * Run: TEST_BASE_URL=http://localhost:3009 npm run test:e2e:governance:smoke
 */
const API_BASE = process.env.TEST_API_URL || 'http://localhost:18080';

test.describe('governance & community smoke (local)', () => {
    test('public API: execution readiness + beta catalog', async ({ request }) => {
        const readiness = await request.get(`${API_BASE}/v1/governance/execution-readiness`);
        expect(readiness.ok()).toBeTruthy();
        const body = await readiness.json();
        expect(body.governance_execution).toBeTruthy();

        const beta = await request.get(`${API_BASE}/v1/beta-program`);
        expect(beta.ok()).toBeTruthy();
        const betaBody = await beta.json();
        expect(betaBody.tasks?.length).toBeGreaterThan(0);
        expect(betaBody.stats?.total_tasks).toBeGreaterThan(0);
    });

    test('governance hub renders', async ({ page }) => {
        await page.goto('/governance', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Governance', level: 1 })).toBeVisible({
            timeout: 30_000,
        });
        await expect(
            page.getByText(
                /on-chain governance is active|on-chain governance is not ready|Checking on-chain governance readiness|Could not verify governance execution/i
            )
        ).toBeVisible({ timeout: 30_000 });
    });

    test('beta program page renders task catalog', async ({ page }) => {
        await page.goto('/community/beta', { waitUntil: 'networkidle' });
        await expect(page.getByRole('heading', { name: /ProxyHubb Beta Testers/i })).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByText(/Week 1/i)).toBeVisible();
        await expect(page.getByRole('link', { name: 'Discord #beta-testers' })).toBeVisible();
    });

    test('governance create shows templates', async ({ page }) => {
        test.skip(!process.env.TEST_BUYER_JWT, 'Set TEST_BUYER_JWT for authenticated create smoke');

        const token = process.env.TEST_BUYER_JWT!;
        const base = process.env.TEST_BASE_URL || 'http://localhost:3009';
        const cookieBase = base.replace('localhost', '127.0.0.1');
        await page.context().addCookies([
            { name: 'proxyhubb_token', value: token, url: cookieBase },
            { name: 'proxyhubb_token', value: token, url: base.replace('127.0.0.1', 'localhost') },
        ]);
        await page.addInitScript((jwt) => {
            sessionStorage.setItem('proxyhubb_token', jwt);
        }, token);

        await page.goto('/governance/create', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/governance\/create/, { timeout: 30_000 });
        await expect(page.getByRole('heading', { name: /create proposal/i })).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.getByText(/Community signal/i)).toBeVisible({ timeout: 15_000 });
    });
});
