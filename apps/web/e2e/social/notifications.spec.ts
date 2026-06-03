import { test, expect } from "@playwright/test";

test.describe("Notification Center", () => {
    test.beforeEach(async ({ page }) => {
        // Login before each test
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.waitForURL("/dashboard");
    });

    test("should display notification bell with correct aria attributes", async ({ page }) => {
        const bellButton = page.locator("[aria-label*='Notifications']");
        
        await expect(bellButton).toBeVisible();
        await expect(bellButton).toHaveAttribute("aria-haspopup", "menu");
        await expect(bellButton).toHaveAttribute("aria-expanded", "false");
    });

    test("should open notification dropdown on click", async ({ page }) => {
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();

        const dropdown = page.locator("[role='menu']");
        await expect(dropdown).toBeVisible();
        await expect(bellButton).toHaveAttribute("aria-expanded", "true");
    });

    test("should close dropdown on Escape key", async ({ page }) => {
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();

        const dropdown = page.locator("[role='menu']");
        await expect(dropdown).toBeVisible();

        await page.keyboard.press("Escape");
        await expect(dropdown).not.toBeVisible();
        await expect(bellButton).toHaveAttribute("aria-expanded", "false");
    });

    test("should trap focus within dropdown when open", async ({ page }) => {
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();

        const dropdown = page.locator("[role='menu']");
        await expect(dropdown).toBeVisible();

        // Tab through all focusable elements
        const focusableElements = await dropdown.locator("button, a").all();
        expect(focusableElements.length).toBeGreaterThan(0);

        // Press Tab multiple times and verify focus stays within dropdown
        for (let i = 0; i < focusableElements.length + 2; i++) {
            await page.keyboard.press("Tab");
            const activeElement = await page.evaluate(() => document.activeElement?.closest("[role='menu']"));
            expect(activeElement).toBeTruthy();
        }
    });

    test("should navigate to notification settings", async ({ page }) => {
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();

        const settingsLink = page.locator("[aria-label='Notification settings']");
        await settingsLink.click();

        await expect(page).toHaveURL("/dashboard/settings/notifications");
    });

    test("should mark all notifications as read", async ({ page }) => {
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();

        const markAllButton = page.locator("[aria-label='Mark all notifications as read']");
        
        // Only test if button exists (has unread notifications)
        if (await markAllButton.isVisible().catch(() => false)) {
            await markAllButton.click();
            
            // Verify notifications are marked as read
            await expect(page.locator("[role='menu'] [role='listitem']").first()).toHaveClass(/bg-primary\/5/);
        }
    });
});

test.describe("Notification Settings", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.goto("/dashboard/settings/notifications");
    });

    test("should display notification preferences", async ({ page }) => {
        await expect(page.locator("h1")).toContainText("Notification Settings");
        await expect(page.locator("text=Social")).toBeVisible();
        await expect(page.locator("text=Business")).toBeVisible();
        await expect(page.locator("text=Community")).toBeVisible();
    });

    test("should toggle notification preferences", async ({ page }) => {
        const socialEmailToggle = page.locator("button").filter({ hasText: /Email/ }).first();
        
        // Get initial state
        const initialClass = await socialEmailToggle.getAttribute("class");
        
        // Click to toggle
        await socialEmailToggle.click();
        
        // Wait for save
        await expect(page.locator("text=Saved")).toBeVisible();
        
        // Verify state changed
        const newClass = await socialEmailToggle.getAttribute("class");
        expect(newClass).not.toBe(initialClass);
    });

    test("should change digest frequency", async ({ page }) => {
        const frequencySelect = page.locator("select").first();
        
        await frequencySelect.selectOption("daily");
        await expect(page.locator("text=Saved")).toBeVisible();
        
        // Verify day and time selectors appear
        await expect(page.locator("text=Day")).toBeVisible();
        await expect(page.locator("text=Time")).toBeVisible();
    });
});
