import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4011';

// ==================== Auth Tests ====================

test.describe('Authentication', () => {
  test('should display login page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    await page.fill('input[type="email"]', 'invalid@test.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.getByText(/invalid|error|failed/i)).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to register page', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);

    await page.click('text=/sign up|register|create account/i');
    await expect(page).toHaveURL(/register/);
  });

  test('should display register page with all fields', async ({ page }) => {
    await page.goto(`${BASE_URL}/register`);

    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i).first()).toBeVisible();
  });
});

// ==================== Dashboard Tests ====================

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication by setting token in localStorage
    await page.goto(`${BASE_URL}`);
    await page.evaluate(() => {
      localStorage.setItem('access_token', 'mock-test-token');
      localStorage.setItem('user', JSON.stringify({ id: 'test-user', email: 'test@example.com', role: 'buyer' }));
    });
  });

  test('should display dashboard after login', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Check for dashboard elements
    await expect(page.getByText(/dashboard|welcome/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('should display wallet balance', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    // Look for balance display
    await expect(page.getByText(/balance|ghs/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to wallet page', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    await page.click('text=/wallet/i');
    await expect(page).toHaveURL(/wallet/);
  });
});

// ==================== Session Tests ====================

test.describe('Sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}`);
    await page.evaluate(() => {
      localStorage.setItem('access_token', 'mock-test-token');
      localStorage.setItem('user', JSON.stringify({ id: 'test-user', email: 'test@example.com', role: 'buyer' }));
    });
  });

  test('should display create session button', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);

    await expect(page.getByRole('button', { name: /create|new session/i })).toBeVisible({ timeout: 10000 });
  });
});

// ==================== Landing Page Tests ====================

test.describe('Landing Page', () => {
  test('should display hero section', async ({ page }) => {
    await page.goto(`${BASE_URL}`);

    await expect(page.getByText(/proxyhubb|proxy/i).first()).toBeVisible();
  });

  test('should have call-to-action buttons', async ({ page }) => {
    await page.goto(`${BASE_URL}`);

    await expect(page.getByRole('link', { name: /get started|sign up|start/i }).first()).toBeVisible();
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
  test('should load landing page within 3 seconds', async ({ page }) => {
    const startTime = Date.now();
    await page.goto(`${BASE_URL}`);
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThan(3000);
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
