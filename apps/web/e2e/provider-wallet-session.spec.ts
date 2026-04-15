import { expect, test } from '@playwright/test';

const APP_ORIGIN = process.env.TEST_BASE_URL || 'http://localhost:4001';

type MockUser = {
  id: string;
  email?: string;
  role: string;
  username?: string;
  wallet_address?: string;
  trust_tier?: string;
  verified?: boolean;
};

async function seedAuth(page: Parameters<typeof test>[0]['page'], user: MockUser) {
  await page.context().addCookies([
    {
      name: 'proxyhubb_e2e_auth',
      value: '1',
      url: APP_ORIGIN,
    },
  ]);

  await page.addInitScript((seededUser) => {
    localStorage.setItem('proxyhubb_token', 'mock-test-token');
    localStorage.setItem('proxyhubb_refresh_token', 'mock-refresh-token');
    window.localStorage.setItem('proxyhubb_e2e_user', JSON.stringify(seededUser));
  }, user);
}

async function mockAuthenticatedUser(page: Parameters<typeof test>[0]['page'], user: MockUser) {
  await seedAuth(page, user);
  await page.route('**/v1/auth/refresh', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'mock-test-token',
        refresh_token: 'mock-refresh-token',
      }),
    });
  });
  await page.route('**/v1/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  });
}

async function gotoDashboard(page: Parameters<typeof test>[0]['page'], path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.getByText(/^Loading\.\.\.$/).waitFor({ state: 'hidden', timeout: 30000 }).catch(() => undefined);
}

test.describe('Provider onboarding and wallet/session critical flows', () => {
  test('shows provider application review state for pending applications', async ({ page }) => {
    const user: MockUser = {
      id: 'buyer-pending-user',
      email: 'buyer@example.com',
      role: 'buyer',
      wallet_address: '5J7sQx1LQx32fY6k3i8rXQ9rC3Z1V3aNQ3fxh7c7c4yD',
      trust_tier: 'verified',
      verified: true,
    };

    await mockAuthenticatedUser(page, user);

    await page.route('**/v1/provider/earnings/summary', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        total_earned_sol: 0,
        pending_sol: 0,
        paid_sol: 0,
        total_sessions: 0,
        total_bandwidth_gb: 0,
        last_30_days_sol: 0,
        last_7_days_sol: 0,
      }) });
    });
    await page.route('**/v1/provider/nodes', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [] }) });
    });
    await page.route('**/v1/provider/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'pending',
          application: {
            id: 'app-pending-1',
            user_id: user.id,
            isp: 'FiberCo',
            location: 'Accra',
            bandwidth: '1Gbps Fiber',
            status: 'pending',
            created_at: '2026-04-15T10:00:00Z',
          },
        }),
      });
    });

    await gotoDashboard(page, '/dashboard/provider');

    await expect(page.getByText(/application under review/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/manual approval/i)).toBeVisible();
  });

  test('submits a provider application when linked wallet balance is sufficient', async ({ page }) => {
    const user: MockUser = {
      id: 'buyer-submit-user',
      email: 'submit@example.com',
      role: 'buyer',
      wallet_address: '8M9fQx1LQx32fY6k3i8rXQ9rC3Z1V3aNQ3fxh7c7c4yD',
      trust_tier: 'verified',
      verified: true,
    };

    await mockAuthenticatedUser(page, user);

    await page.route('**/v1/provider/earnings/summary', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        total_earned_sol: 0,
        pending_sol: 0,
        paid_sol: 0,
        total_sessions: 0,
        total_bandwidth_gb: 0,
        last_30_days_sol: 0,
        last_7_days_sol: 0,
      }) });
    });
    await page.route('**/v1/provider/nodes', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [] }) });
    });
    await page.route('**/v1/provider/status', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not found' }) });
    });
    await page.route('**/v1/wallet', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          wallet: {
            id: 'wallet-1',
            balance_sol: 0.1,
            on_chain_sol: 0.25,
            available_sol: 0.25,
            solana_network: 'devnet',
            linked_solana_address: user.wallet_address,
            transactions: [],
            created_at: '2026-04-15T10:00:00Z',
          },
        }),
      });
    });
    await page.route('**/v1/provider/apply', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'ok',
          application: {
            id: 'app-created-1',
            user_id: user.id,
            isp: 'FiberCo',
            location: 'Accra',
            bandwidth: '1Gbps Fiber',
            status: 'pending',
            created_at: '2026-04-15T10:01:00Z',
          },
        }),
      });
    });

    await gotoDashboard(page, '/dashboard/provider');

    await page.getByPlaceholder(/1Gbps Fiber/i).fill('1Gbps Fiber');
    await page.getByRole('button', { name: /submit application/i }).click();

    await expect(page.getByText(/application received/i)).toBeVisible({ timeout: 10000 });
  });

  test('shows wallet-linking call to action when no linked wallet is present', async ({ page }) => {
    const user: MockUser = {
      id: 'wallet-user',
      email: 'wallet@example.com',
      role: 'buyer',
      trust_tier: 'starter',
    };

    await mockAuthenticatedUser(page, user);

    await page.route('**/v1/wallet', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          wallet: {
            id: 'wallet-2',
            balance_sol: 0,
            on_chain_sol: 0,
            available_sol: 0,
            solana_network: 'devnet',
            transactions: [],
            created_at: '2026-04-15T10:00:00Z',
          },
        }),
      });
    });

    await gotoDashboard(page, '/dashboard/wallet');

    await expect(page.getByText(/connect your solana wallet/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /^link wallet$/i })).toBeVisible();
  });

  test('shows linked wallet identity when a verified wallet exists', async ({ page }) => {
    const linkedWallet = '4Nd1mYhV4Y7j4JmQyS6yE8frLj1W8A2YJ7t6V1Rj9rQm';
    const user: MockUser = {
      id: 'wallet-linked-user',
      email: 'linked@example.com',
      role: 'buyer',
      wallet_address: linkedWallet,
      trust_tier: 'verified',
      verified: true,
    };

    await mockAuthenticatedUser(page, user);

    await page.route('**/v1/wallet', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          wallet: {
            id: 'wallet-3',
            balance_sol: 1.2,
            on_chain_sol: 1.2,
            available_sol: 1.2,
            solana_network: 'devnet',
            linked_solana_address: linkedWallet,
            transactions: [],
            created_at: '2026-04-15T10:00:00Z',
          },
        }),
      });
    });

    await gotoDashboard(page, '/dashboard/wallet');

    await page.getByRole('button', { name: /linked wallets/i }).click();
    await expect(page.getByText(/identity verified/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(linkedWallet)).toBeVisible();
  });

  test('creates a V2 session intent from the proxy dashboard', async ({ page }) => {
    const user: MockUser = {
      id: 'session-user',
      email: 'session@example.com',
      role: 'buyer',
      trust_tier: 'verified',
      verified: true,
    };
    const createdIntent = {
      token: 'mock-intent-token-123',
      expires_at: '2026-04-15T11:00:00Z',
      lifecycle_state: 'authorized',
      intent: {
        intent_id: 'intent-session-1',
        user_id: user.id,
        session_type: 'rotating',
        trust_tier: 'verified',
        bandwidth_limit: 0,
        allowed_domains: [],
        blocked_domains: [],
        requests_per_minute: 120,
        max_concurrency: 5,
      },
    };

    await mockAuthenticatedUser(page, user);

    await page.route('**/v1/sessions', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) });
    });
    await page.route('**/v1/analytics/overview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_requests: 0,
          total_bandwidth_gb: 0,
          success_rate: 100,
          avg_latency_ms: 0,
          active_sessions: 0,
          unique_destinations: 0,
          top_country: 'US',
          top_isp: 'FiberCo',
        }),
      });
    });
    await page.route('**/v1/sessions/intent', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createdIntent) });
    });
    await page.route('**/v1/sessions/intents/intent-session-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          lifecycle_state: 'authorized',
          expires_at: createdIntent.expires_at,
          created_at: '2026-04-15T10:00:00Z',
          updated_at: '2026-04-15T10:00:05Z',
          usage_snapshot: {
            total_bytes: 0,
            total_bytes_up: 0,
            total_bytes_down: 0,
            last_bytes_up_delta: 0,
            last_bytes_down_delta: 0,
            total_gb: 0,
            percent_used: 0,
            bytes_remaining: 0,
            unlimited: true,
          },
          billing_snapshot: {
            currency: 'USD',
            price_source: 'unpriced',
            unit_price_usd_per_gb: 0,
            unit_price_sol_per_gb: 0,
            estimated_cost_usd: 0,
            estimated_cost_sol: 0,
            projected_full_limit_cost_usd: 0,
            projected_full_limit_cost_sol: 0,
          },
          intent: createdIntent.intent,
        }),
      });
    });

    await gotoDashboard(page, '/dashboard/proxy');

    await page.getByRole('button', { name: /rotating/i }).click();

    await expect(page.getByText(/v2 session intent/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(createdIntent.token)).toBeVisible();
  });
});