import { expect, test } from '@playwright/test';
import {
    applyBuyerAuth,
    governanceApiBase,
    governanceBaseUrl,
    missingGovernanceDevnetEnv,
} from './helpers/governance-live';

test.describe('governance live devnet', () => {
    test('loads governance hub and execution readiness with auth', async ({ page }) => {
        const missing = missingGovernanceDevnetEnv();
        test.skip(
            missing.length > 0,
            `Live governance E2E skipped. Missing env: ${missing.join(', ')}`
        );

        test.setTimeout(60_000);
        const token = process.env.TEST_BUYER_JWT!;
        const baseUrl = governanceBaseUrl();

        await applyBuyerAuth(page, token);
        await page.goto(`${baseUrl}/governance`, { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('heading', { name: /governance/i })).toBeVisible({
            timeout: 30_000,
        });
        await expect(
            page.getByText(/on-chain governance is active|on-chain governance is not ready/i)
        ).toBeVisible({ timeout: 30_000 });
    });

    test('creates signal proposal and casts on-chain yes vote', async ({ page }) => {
        const missing = missingGovernanceDevnetEnv();
        test.skip(
            missing.length > 0,
            `Live governance E2E skipped. Missing env: ${missing.join(', ')}`
        );

        test.setTimeout(180_000);
        const token = process.env.TEST_BUYER_JWT!;
        const baseUrl = governanceBaseUrl();
        const stamp = Date.now();
        const title = `E2E signal ${stamp}`;

        await applyBuyerAuth(page, token);
        const description =
            `Playwright devnet governance flow ${stamp}. Validates on-chain create and vote relay.`;

        const createRes = await page.request.post(
            `${governanceApiBase()}/v1/governance/proposals`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    title,
                    description,
                    duration_days: 7,
                    type: 'signal',
                },
            }
        );
        expect(createRes.ok(), await createRes.text()).toBeTruthy();
        const created = await createRes.json();
        const proposalId =
            created.proposal?.id ??
            created.proposal_id ??
            (typeof created.id === 'string' ? created.id : '');
        expect(proposalId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );

        await page.goto(`${baseUrl}/governance/${proposalId}`, {
            waitUntil: 'domcontentloaded',
        });

        await expect(page.getByText(title, { exact: false })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(/impact preview/i)).toBeVisible({ timeout: 30_000 });

        await page.getByRole('button', { name: /support unit/i }).click();
        await page.getByRole('button', { name: /confirm sequence/i }).click();

        await expect
            .poll(
                async () => {
                    const err = page.getByText(/sequence error|vote failed/i);
                    if (await err.isVisible().catch(() => false)) {
                        return (await err.textContent()) || 'vote error';
                    }
                    const res = await page.request.get(
                        `${governanceApiBase()}/v1/governance/proposals/${proposalId}`,
                        { headers: { Authorization: `Bearer ${token}` } }
                    );
                    if (!res.ok()) return `proposal fetch ${res.status()}`;
                    const body = await res.json();
                    const p = body.proposal ?? body;
                    const yes = Math.max(
                        Number(p.yes_votes ?? 0),
                        Number(p.votes_for ?? 0)
                    );
                    return yes > 0 ? 'voted' : 'pending';
                },
                { timeout: 120_000, intervals: [2000, 3000, 5000] }
            )
            .toBe('voted');
    });
});
