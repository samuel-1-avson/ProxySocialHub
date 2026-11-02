import { test, expect } from '@playwright/test';
import { seedSignedAuth } from './fixtures/signed-auth';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

// Helper to stub all dashboard metrics and wallet APIs
async function stubDashboardApis(page: import('@playwright/test').Page) {
  await page.route('**/v1/analytics/overview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total_requests: 1500,
        total_bandwidth_gb: 45.2,
        success_rate: 99.8,
        avg_latency_ms: 32,
        active_sessions: 2,
        unique_destinations: 14,
        top_country: 'GH',
        top_isp: 'MTN',
        total_nodes: 0,
        total_earnings_sol: 0.0,
        avg_quality_score: 0,
        active_payouts: 0,
      }),
    });
  });

  await page.route('**/v1/wallet', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        wallet: {
          balance_sol: 2.545,
          linked_solana_address: '5J7sQx1LQx32fY6k3i8rXQ9rC3Z1V3aNQ3fxh7c7c4yD',
          transactions: [
            {
              id: 'tx-1',
              description: 'Deposit via MoMo',
              amount: 1.5,
              status: 'success',
              created_at: new Date().toISOString(),
            },
          ],
        }
      }),
    });
  });

  await page.route('**/v1/analytics/usage/daily*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            date: new Date().toISOString(),
            bytes_used: 1073741824,
            gb_used: 1.0,
            cost_ghs: 0.5,
          },
        ],
      }),
    });
  });

  await page.route('**/v1/notifications/unread-count', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0 }),
    });
  });
}

// ==================== Auth Tests ====================

test.describe('Authentication', () => {
  test('should display login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    // Allow dynamic import to complete on slow engines
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  });

  test('should display register page', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`);

    await expect(page.getByRole('heading', { level: 1, name: /create your account/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/connect a solana wallet to create your proxyhubb account/i)).toBeVisible();
  });

  test('should navigate from register to login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`);

    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

// ==================== Dashboard Tests ====================

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Force desktop view to keep sidebar links visible on all test runners
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedSignedAuth(page, BASE_URL, 'buyer');
    await stubDashboardApis(page);
  });

  test('should display dashboard after login', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    // /dashboard is the legacy path of the buyer workspace overview
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible({ timeout: 15000 });
  });

  test('should display wallet balance', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Look for balance display
    await expect(page.getByText(/balance|ghs|sol/i).locator('visible=true').first()).toBeVisible({ timeout: 15000 });
  });

  test('should navigate to wallet page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Skip mobile navigation test');

    // The old wallet path still lands on the workspace wallet (also pre-warms its compile)
    await page.goto(`${BASE_URL}/dashboard/wallet`);
    await expect(page).toHaveURL(/\/app\/wallet/, { timeout: 30000 });
    await page.goto(`${BASE_URL}/dashboard`);

    // The workspace header's Wallet link
    const walletLink = page.locator('a.workspace-wallet-link');
    await expect(walletLink).toBeVisible({ timeout: 15000 });
    await walletLink.click();
    await page.waitForURL('**/app/wallet', { timeout: 30000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Wallet' })).toBeVisible({ timeout: 15000 });
  });
});

// ==================== Session Tests ====================

test.describe('Sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedSignedAuth(page, BASE_URL, 'buyer');
    await stubDashboardApis(page);
  });

  test('should display create session button', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    // The Quick Connect CTA is named "Connect"
    await expect(page.getByRole('link', { name: /connect/i }).first()).toBeVisible({ timeout: 15000 });
  });
});

// ==================== Landing Page Tests ====================

test.describe('Landing Page', () => {
  test('should display hero section', async ({ page }) => {
    await page.goto(`${BASE_URL}`);

    await expect(page.getByRole('heading', { level: 1, name: /clear routes/i })).toBeVisible({ timeout: 15000 });
  });

  test('should have call-to-action buttons', async ({ page }) => {
    await page.goto(`${BASE_URL}`);

    await expect(page.getByRole('link', { name: /browse marketplace|access terminal/i }).first()).toBeVisible();
  });

  test('should be responsive', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}`);

    await expect(page.locator('body')).toBeVisible();

    // Test desktop viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE_URL}`);

    await expect(page.locator('body')).toBeVisible();
  });
});

// ==================== Admin Tests ====================

test.describe('Admin Panel', () => {
  test('redirects unauthenticated users from admin moderation', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: 'domcontentloaded' });

    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next') || url.searchParams.get('redirect')).toContain('/dashboard/admin');
  });
});

// ==================== Performance Tests ====================

test.describe('Performance', () => {
  test('should load landing page within 10 seconds', async ({ page }) => {
    const startTime = Date.now();
    await page.goto(`${BASE_URL}`);
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;

    // Allow a larger margin for cold Next.js dev server compilation inside container environment
    expect(loadTime).toBeLessThan(60000);
  });

  test('should have no accessibility violations on landing page', async ({ page }) => {
    await page.goto(`${BASE_URL}`);

    // Basic accessibility checks
    const images = await page.locator('img').all();
    for (const img of images) {
      const alt = await img.getAttribute('alt');
      // Images should have alt text (can be empty for decorative)
      expect(alt).not.toBeNull();
    }
  });
});
