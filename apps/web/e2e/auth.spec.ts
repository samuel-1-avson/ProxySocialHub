import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4001';

test.describe('Real Authentication Flow', () => {
    test('should login successfully with seeded admin credentials', async ({ page }) => {
        // 1. Go to Login Page
        await page.goto(`${BASE_URL}/login`);

        // 2. Fill Credentials (seeded in previous step)
        await page.fill('input[type="email"]', 'admin@proxyhub.com');
        await page.fill('input[type="password"]', 'password123');

        // 3. Submit
        await page.click('button[type="submit"]');

        // 4. Verification
        // Expect redirect to dashboard content or URL
        // Depending on logic, it might go to /dashboard or /admin
        // Seeder set admin role, so let's verify we are authenticated.

        // Wait for navigation or specific element
        await expect(page).not.toHaveURL(/login/);

        // Check for "Dashboard" or user menu
        // Adjust selector based on actual UI. Assuming standard text presence.
        try {
            await expect(page.getByText(/dashboard|overview/i).first()).toBeVisible({ timeout: 15000 });
        } catch (e) {
            console.log("Dashboard text not found, checking URL...");
            expect(page.url()).toContain('dashboard');
        }
    });

    test('should fail with incorrect password', async ({ page }) => {
        await page.goto(`${BASE_URL}/login`);

        await page.fill('input[type="email"]', 'admin@proxyhub.com');
        await page.fill('input[type="password"]', 'wrongpass');
        await page.click('button[type="submit"]');

        // Expect error message
        await expect(page.getByText(/invalid|failed|error/i)).toBeVisible();
    });
});
