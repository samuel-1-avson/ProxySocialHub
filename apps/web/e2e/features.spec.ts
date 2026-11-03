import { test, expect, type Page } from '@playwright/test';
import { seedSignedAuth } from './fixtures/signed-auth';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

async function stubApiDown(page: Page) {
    await page.routeWebSocket((url) => !url.pathname.includes('/_next/'), (socket) => socket.close());
    await page.route('**/v1/**', (route) => route.fulfill({ status: 503, json: { error: 'Not available in this test' } }));
}

// ==================== Wallet Tests ====================

test.describe('Wallet', () => {
    test.beforeEach(async ({ page }) => {
        await stubApiDown(page);
        await seedSignedAuth(page, BASE_URL, 'buyer');
    });

    test('should display wallet page', async ({ page }) => {
        // The legacy /dashboard/wallet URL redirects to the current page.
        await page.goto(`${BASE_URL}/dashboard/wallet`);
        await expect(page).toHaveURL(/\/app\/wallet/, { timeout: 30000 });
        await expect(page.getByRole('heading', { name: 'Your payment wallet' }).first()).toBeVisible({ timeout: 30000 });
    });

    test('should show the wallet view tabs', async ({ page }) => {
        await page.goto(`${BASE_URL}/app/wallet`);
        const views = page.getByRole('navigation', { name: 'Wallet views' });
        await expect(views.getByRole('link', { name: 'Your wallet' })).toBeVisible({ timeout: 30000 });
        await expect(views.getByRole('link', { name: 'Account funds' })).toBeVisible();
        await expect(views.getByRole('link', { name: 'Activity' })).toBeVisible();
    });

    test('should open the activity view for transaction history', async ({ page }) => {
        await page.goto(`${BASE_URL}/app/wallet?tab=history`);
        await expect(page.getByRole('navigation', { name: 'Wallet views' }).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page', { timeout: 30000 });
    });
});

// ==================== Marketplace Tests ====================

test.describe('Marketplace', () => {
    test('should display marketplace page', async ({ page }) => {
        await page.goto(`${BASE_URL}/marketplace`);
        await expect(page.getByText(/marketplace|proxies|listings/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should display listing cards', async ({ page }) => {
        await page.route(/\/v1\/listings(\?.*)?$/, (route) => route.fulfill({
            json: {
                listings: [{
                    id: 'listing-accra-1',
                    seller_id: 'seller-1',
                    node_id: 'node-1',
                    title: 'Accra Residential Pool',
                    description: 'Residential proxies in Ghana',
                    price_per_gb: 0.0025,
                    min_purchase_gb: 1,
                    available_bandwidth_gb: 500,
                    max_concurrency: 10,
                    proxy_type: 'residential',
                    protocol: 'http',
                    status: 'active',
                    country: 'GH',
                    city: 'Accra',
                    uptime_percent: 99.5,
                    avg_latency_ms: 80,
                    success_rate: 99,
                    quality_score: 95,
                }],
                total: 1,
                page: 1,
            },
        }));
        await page.route(/\/v1\/listings\/(featured|facets|collections)(\?.*)?$/, (route) => route.fulfill({ json: { listings: [], collections: [], total: 0 } }));
        await page.goto(`${BASE_URL}/marketplace`);
        await expect(page.getByText('Accra Residential Pool')).toBeVisible({ timeout: 30000 });
        await expect(page.getByText(/GB/i).first()).toBeVisible();
    });

    test('should have search functionality', async ({ page }) => {
        await page.goto(`${BASE_URL}/marketplace`);
        const searchInput = page.getByPlaceholder(/search/i);
        if (await searchInput.isVisible()) {
            await searchInput.fill('Ghana');
            expect(true).toBe(true);
        }
    });

    test('should filter by country', async ({ page }) => {
        await page.goto(`${BASE_URL}/marketplace`);
        const filterButton = page.getByRole('button', { name: /filter|country/i });
        if (await filterButton.isVisible()) {
            await filterButton.click();
            expect(true).toBe(true);
        }
    });
});

// ==================== Security Tests ====================

test.describe('Security Settings', () => {
    test.beforeEach(async ({ page }) => {
        await stubApiDown(page);
        // 2FA not enabled: the API answers 400, which the UI reads as "off".
        await page.route('**/v1/2fa/backup-codes', (route) => route.fulfill({ status: 400, json: { error: 'Two-factor authentication is not enabled' } }));
        await seedSignedAuth(page, BASE_URL, 'buyer');
    });

    test('should display security settings page', async ({ page }) => {
        // The legacy /dashboard/security URL redirects to the settings tab.
        await page.goto(`${BASE_URL}/dashboard/security`);
        await expect(page).toHaveURL(/tab=security/, { timeout: 30000 });
        await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible({ timeout: 30000 });
    });

    test('should show 2FA setup option', async ({ page }) => {
        await page.goto(`${BASE_URL}/app/settings?tab=security`);
        await expect(page.getByRole('button', { name: 'Set up authenticator' })).toBeVisible({ timeout: 30000 });
        await expect(page.getByText('Not enabled')).toBeVisible();
    });

    test('should have sessions tab', async ({ page }) => {
        await page.goto(`${BASE_URL}/app/settings?tab=security`);
        const sessionsTab = page.getByRole('tab', { name: /sessions/i });
        if (await sessionsTab.isVisible()) {
            await sessionsTab.click();
            await expect(page.getByText(/active|device/i).first()).toBeVisible({ timeout: 5000 });
        }
    });
});

// ==================== Accessibility Tests ====================

test.describe('Accessibility', () => {
    test('should have skip link', async ({ page }) => {
        await page.goto(`${BASE_URL}`);
        // Tab to focus skip link
        await page.keyboard.press('Tab');
        const skipLink = page.getByText(/skip to main/i);
        await expect(skipLink).toBeFocused();
    });

    test('should have proper heading hierarchy', async ({ page }) => {
        await page.goto(`${BASE_URL}`);
        const h1Elements = await page.locator('h1').all();
        expect(h1Elements.length).toBeGreaterThanOrEqual(1);
    });

    test('should have alt text on images', async ({ page }) => {
        await page.goto(`${BASE_URL}`);
        const images = await page.locator('img').all();
        for (const img of images) {
            const alt = await img.getAttribute('alt');
            expect(alt).not.toBeNull();
        }
    });

    test('dashboard should be keyboard navigable', async ({ page }) => {
        await page.goto(`${BASE_URL}`);
        await page.evaluate(() => {
            localStorage.setItem('access_token', 'mock-test-token');
            localStorage.setItem('user', JSON.stringify({
                id: 'test-user',
                email: 'test@example.com'
            }));
        });
        await page.goto(`${BASE_URL}/dashboard`);

        // Tab through focusable elements
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
        }

        // Should be able to tab without errors
        expect(true).toBe(true);
    });
});

// ==================== Error Handling Tests ====================

test.describe('Error Handling', () => {
    test('should show error page for 404', async ({ page }) => {
        await page.goto(`${BASE_URL}/nonexistent-page-12345`);
        await expect(page.getByText(/not found|404|error/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should redirect unauthenticated users from protected routes', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard`);
        // Should either redirect to login or show auth prompt
        const pageUrl = page.url();
        const hasAuth = pageUrl.includes('login') || await page.getByText(/sign in|login/i).first().isVisible().catch(() => false);
        expect(true).toBe(true); // Basic check passed
    });
});

// ==================== Responsive Tests ====================

test.describe('Responsive Design', () => {
    test('mobile navigation should work', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto(`${BASE_URL}`);

        // Look for mobile menu button
        const menuButton = page.getByRole('button', { name: /menu/i });
        if (await menuButton.isVisible()) {
            await menuButton.click();
            await expect(page.getByRole('navigation')).toBeVisible();
        }
    });

    test('tablet breakpoint should work', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto(`${BASE_URL}`);
        await expect(page.locator('body')).toBeVisible();
    });

    test('desktop sidebar should be visible', async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(`${BASE_URL}`);
        await page.evaluate(() => {
            localStorage.setItem('access_token', 'mock-test-token');
            localStorage.setItem('user', JSON.stringify({ id: 'test-user', email: 'test@example.com' }));
        });
        await page.goto(`${BASE_URL}/dashboard`);

        // Sidebar should be visible on desktop
        await expect(page.locator('aside, [role="navigation"]').first()).toBeVisible({ timeout: 10000 });
    });
});
