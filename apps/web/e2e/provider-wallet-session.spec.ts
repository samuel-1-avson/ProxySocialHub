import { expect, test, type Page } from '@playwright/test';
import { seedSignedAuth } from './fixtures/signed-auth';

const base = process.env.TEST_BASE_URL || 'http://localhost:4011';
const WALLET = '5J7sQx1LQx32fY6k3i8rXQ9rC3Z1V3aNQ3fxh7c7c4yD';

// Rebuilt against the current provider/wallet UX. The old suite drove the
// pre-redesign onboarding form, /dashboard/wallet link cards and a V2
// session-intent UI that no longer exists in the web app; those flows were
// re-pointed at /dashboard/become-provider, /provider and /app/wallet.

async function stubWallet(page: Page, wallet: Record<string, unknown> | null) {
  await page.route('**/v1/wallet', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ wallet }),
    }),
  );
}

const fundedWallet = {
  id: 'wallet-1',
  balance_sol: 0.25,
  on_chain_sol: 0.25,
  available_sol: 0.25,
  solana_network: 'devnet',
  linked_solana_address: WALLET,
  transactions: [],
  created_at: '2026-04-15T10:00:00Z',
};

test.describe('Provider onboarding and wallet flows', () => {
  test.setTimeout(120000);

  test('a pending application shows the automatic verification state', async ({ page }) => {
    await page.routeWebSocket((url) => !url.pathname.includes('/_next/'), (socket) => socket.close());
    await stubWallet(page, fundedWallet);
    await page.route('**/v1/provider/status', (route) =>
      route.fulfill({ status: 404, json: { error: 'not found' } }),
    );
    await page.route('**/v1/provider/apply', (route) =>
      route.fulfill({
        status: 201,
        json: {
          message: 'Application stored for automatic verification',
          application: { id: 'app-pending-1', status: 'pending', bandwidth: '1Gbps Fiber' },
        },
      }),
    );
    await seedSignedAuth(page, base, 'buyer');
    await page.goto(base + '/dashboard/become-provider', { waitUntil: 'domcontentloaded' });

    await page.getByPlaceholder(/1Gbps Fiber/i).fill('1Gbps Fiber');
    await page.getByRole('button', { name: /Submit Application/i }).click();
    await expect(page.getByText('Automatic Verification Pending')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/rechecked automatically/i)).toBeVisible();
  });

  test('an auto-approved application unlocks the provider workspace', async ({ page }) => {
    await page.routeWebSocket((url) => !url.pathname.includes('/_next/'), (socket) => socket.close());
    await stubWallet(page, fundedWallet);
    await page.route('**/v1/provider/status', (route) =>
      route.fulfill({ status: 404, json: { error: 'not found' } }),
    );
    await page.route('**/v1/provider/apply', (route) =>
      route.fulfill({
        status: 201,
        json: {
          message: 'Application approved automatically',
          auto_approved: true,
          application: { id: 'app-approved-1', status: 'approved', bandwidth: '1Gbps Fiber' },
        },
      }),
    );
    await page.route(/\/v1\/provider\/earnings\/summary/, (route) =>
      route.fulfill({
        json: { total_earned_sol: 0, pending_sol: 0, paid_sol: 0, total_sessions: 0, total_bandwidth_gb: 0, last_30_days_sol: 0, last_7_days_sol: 0 },
      }),
    );
    await page.route(/\/v1\/provider\/nodes/, (route) => route.fulfill({ json: { nodes: [] } }));
    // Seeded as a provider so the post-approval workspace navigation is
    // allowed by the route policy; the form still renders with no prior
    // application on file.
    await seedSignedAuth(page, base, 'provider');
    await page.goto(base + '/dashboard/become-provider', { waitUntil: 'domcontentloaded' });

    await page.getByPlaceholder(/1Gbps Fiber/i).fill('1Gbps Fiber');
    await page.getByRole('button', { name: /Submit Application/i }).click();
    await expect(page).toHaveURL(/\/provider$/, { timeout: 30000 });
    await expect(page.getByText('Provider overview')).toBeVisible({ timeout: 30000 });
  });

  test('the wallet page says so when no wallet is linked', async ({ page }) => {
    await page.routeWebSocket((url) => !url.pathname.includes('/_next/'), (socket) => socket.close());
    await stubWallet(page, { ...fundedWallet, linked_solana_address: undefined, on_chain_sol: 0 });
    await seedSignedAuth(page, base, 'buyer');
    await page.goto(base + '/app/wallet', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No wallet linked')).toBeVisible({ timeout: 30000 });
  });

  test('a linked wallet shows its linked status on the wallet page', async ({ page }) => {
    await page.routeWebSocket((url) => !url.pathname.includes('/_next/'), (socket) => socket.close());
    await stubWallet(page, fundedWallet);
    await seedSignedAuth(page, base, 'buyer');
    await page.goto(base + '/app/wallet', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Wallet linked/)).toBeVisible({ timeout: 30000 });
  });
});
