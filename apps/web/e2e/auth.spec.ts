import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4001';
const API_URL = process.env.TEST_API_URL || 'http://localhost:8081';

test.describe('Wallet Authentication Flow', () => {
    test('should show wallet connect button on login page', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`);

        // Verify the page title / heading
        await expect(page.getByText(/connect wallet/i).first()).toBeVisible({ timeout: 10000 });

        // Verify wallet connect button is present
        await expect(page.locator('text=Select Wallet').first().or(page.locator('[class*="wallet-adapter"]').first())).toBeVisible({ timeout: 10000 });

        // Verify NO email/password form is present
        await expect(page.locator('input[type="email"]')).not.toBeVisible();
        await expect(page.locator('input[type="password"]')).not.toBeVisible();

        // Verify NO OAuth buttons
        await expect(page.getByText(/google/i)).not.toBeVisible();
        await expect(page.getByText(/github/i)).not.toBeVisible();
    });

    test('should show wallet connect button on register page', async ({ page }) => {
        await page.goto(`${BASE_URL}/register`);

        // Verify the register page heading
        await expect(page.getByText(/initialize account/i).first()).toBeVisible({ timeout: 10000 });

        // Verify wallet connect button is present
        await expect(page.locator('text=Select Wallet').first().or(page.locator('[class*="wallet-adapter"]').first())).toBeVisible({ timeout: 10000 });

        // Verify NO email/password form
        await expect(page.locator('input[type="email"]')).not.toBeVisible();
        await expect(page.locator('input[type="password"]')).not.toBeVisible();
    });

    test('should authenticate via dev login and access dashboard', async ({ page }) => {
        // Use the backend dev login endpoint for E2E testing
        const devSecret = process.env.DEV_LOGIN_SECRET || 'test-secret';

        const response = await page.request.post(`${API_URL}/v1/auth/dev/login`, {
            headers: {
                'X-Dev-Login-Secret': devSecret,
            }
        });

        if (response.ok()) {
            const { token } = await response.json();

            // Set the token in localStorage and navigate to dashboard
            await page.goto(`${BASE_URL}/login`);
            await page.evaluate((t) => {
                localStorage.setItem('proxyhubb_token', t);
            }, token);

            // Navigate to dashboard
            await page.goto(`${BASE_URL}/dashboard`);

            // Verify we can access dashboard
            await expect(page.getByText(/dashboard|overview/i).first()).toBeVisible({ timeout: 15000 });
        } else {
            // Dev login not available (production mode or no secret configured)
            console.log('Dev login not available — skipping authenticated test');
            test.skip();
        }
    });
});
