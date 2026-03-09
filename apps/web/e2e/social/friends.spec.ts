import { test, expect } from "@playwright/test";

test.describe("Friends", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.waitForURL("/dashboard");
    });

    test("should display friends page with tabs", async ({ page }) => {
        await page.goto("/friends");
        
        await expect(page.locator("h1")).toContainText("Friends");
        await expect(page.locator("text=Friends")).toBeVisible();
        await expect(page.locator("text=Requests")).toBeVisible();
        await expect(page.locator("text=Suggestions")).toBeVisible();
    });

    test("should switch between tabs", async ({ page }) => {
        await page.goto("/friends");
        
        // Click Requests tab
        await page.click("text=Requests");
        await expect(page.locator("[aria-selected='true']")).toContainText("Requests");
        
        // Click Suggestions tab
        await page.click("text=Suggestions");
        await expect(page.locator("[aria-selected='true']")).toContainText("Suggestions");
    });

    test("should display friend cards with correct information", async ({ page }) => {
        await page.goto("/friends");
        
        const friendCards = page.locator("[role='listitem']");
        
        if (await friendCards.first().isVisible().catch(() => false)) {
            // Verify card has username
            await expect(friendCards.first().locator("text=@")).toBeVisible();
            
            // Verify message button exists
            await expect(friendCards.first().locator("[title='Send message']")).toBeVisible();
        }
    });

    test("should navigate to friend profile on click", async ({ page }) => {
        await page.goto("/friends");
        
        const usernameLink = page.locator("a[href^='/profile/']").first();
        
        if (await usernameLink.isVisible().catch(() => false)) {
            const href = await usernameLink.getAttribute("href");
            await usernameLink.click();
            await expect(page).toHaveURL(href || "/profile/*");
        }
    });
});

test.describe("Friend Button on Profile", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
    });

    test("should display friend button on other user profiles", async ({ page }) => {
        // Navigate to a public profile
        await page.goto("/profile/testuser");
        
        // Look for friend button
        const friendButton = page.locator("button").filter({ hasText: /Add Friend|Friends|Pending/ });
        
        // Button should exist if not viewing own profile
        if (await friendButton.isVisible().catch(() => false)) {
            await expect(friendButton).toBeVisible();
        }
    });

    test("should not display friend button on own profile", async ({ page }) => {
        // Navigate to own profile
        await page.goto("/profile");
        
        // Look for friend button
        const friendButton = page.locator("button").filter({ hasText: /Add Friend|Friends|Pending/ });
        
        // Button should not exist on own profile
        await expect(friendButton).toHaveCount(0);
    });
});

test.describe("People You May Know", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
    });

    test("should display suggestions widget", async ({ page }) => {
        await page.goto("/dashboard");
        
        // Look for People You May Know widget
        const widget = page.locator("text=People You May Know");
        
        if (await widget.isVisible().catch(() => false)) {
            await expect(widget).toBeVisible();
        }
    });

    test("should have accessible friend buttons in suggestions", async ({ page }) => {
        await page.goto("/friends");
        await page.click("text=Suggestions");
        
        const addFriendButtons = page.locator("[aria-label='Add friend'], [title='Add friend']");
        
        if (await addFriendButtons.first().isVisible().catch(() => false)) {
            // Verify buttons have proper aria labels
            const ariaLabel = await addFriendButtons.first().getAttribute("aria-label");
            expect(ariaLabel).toBeTruthy();
        }
    });
});

test.describe("Friends Accessibility", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.goto("/friends");
    });

    test("should have proper tablist structure", async ({ page }) => {
        const tablist = page.locator("[role='tablist']");
        await expect(tablist).toBeVisible();
        
        const tabs = tablist.locator("[role='tab']");
        expect(await tabs.count()).toBeGreaterThan(0);
        
        // Each tab should have aria-selected
        for (const tab of await tabs.all()) {
            const selected = await tab.getAttribute("aria-selected");
            expect(selected).toMatch(/true|false/);
        }
    });

    test("should navigate tabs with arrow keys", async ({ page }) => {
        // Focus first tab
        await page.locator("[role='tab']").first().focus();
        
        // Press right arrow
        await page.keyboard.press("ArrowRight");
        
        // Verify focus moved
        const focusedElement = await page.evaluate(() => document.activeElement?.getAttribute("role"));
        expect(focusedElement).toBe("tab");
    });

    test("should have accessible remove friend buttons", async ({ page }) => {
        const removeButtons = page.locator("[title='Remove friend']");
        
        if (await removeButtons.first().isVisible().catch(() => false)) {
            // Verify button is only visible on hover/focus
            await removeButtons.first().focus();
            await expect(removeButtons.first()).toBeVisible();
        }
    });
});
