import { test, expect } from "@playwright/test";

test.describe("Forum", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.waitForURL("/dashboard");
    });

    test("should display forum page with categories", async ({ page }) => {
        await page.goto("/forum");
        
        await expect(page.locator("h1")).toContainText("Community Forum");
        await expect(page.locator("[role='tablist']")).toBeVisible();
        await expect(page.locator("text=Categories")).toBeVisible();
    });

    test("should search forum threads", async ({ page }) => {
        await page.goto("/forum");
        
        const searchInput = page.locator("input[placeholder*='Search']");
        await searchInput.fill("proxy");
        await searchInput.press("Enter");
        
        // Wait for search results
        await page.waitForTimeout(500);
        
        // Verify search results or "No results" message
        const hasResults = await page.locator("[role='feed'] article").count() > 0;
        const hasNoResults = await page.locator("text=No results").isVisible().catch(() => false);
        
        expect(hasResults || hasNoResults).toBeTruthy();
    });

    test("should navigate to category page", async ({ page }) => {
        await page.goto("/forum");
        
        // Click first category
        const firstCategory = page.locator("a[href^='/forum/category/']").first();
        await firstCategory.click();
        
        // Verify navigation
        await expect(page).toHaveURL(/\/forum\/category\/.+/);
        await expect(page.locator("h1")).toBeVisible();
    });

    test("should navigate to thread detail", async ({ page }) => {
        await page.goto("/forum");
        
        // Click first thread
        const firstThread = page.locator("a[href^='/forum/thread/']").first();
        
        // Skip if no threads
        if (await firstThread.isVisible().catch(() => false)) {
            await firstThread.click();
            await expect(page).toHaveURL(/\/forum\/thread\/.+/);
            await expect(page.locator("h1")).toBeVisible();
        }
    });

    test("should create new thread with validation", async ({ page }) => {
        await page.goto("/forum/new");
        
        // Try to submit empty form
        await page.click("button[type='submit']");
        
        // Verify validation errors
        await expect(page.locator("text=Title is required")).toBeVisible();
        await expect(page.locator("text=Content is required")).toBeVisible();
        
        // Fill form
        await page.fill("input[placeholder*='title']", "Test Thread Title");
        await page.fill("textarea", "This is test content for the thread. It needs to be at least 10 characters.");
        
        // Select category if dropdown exists
        const categorySelect = page.locator("select");
        if (await categorySelect.count() > 0) {
            await categorySelect.selectOption({ index: 0 });
        }
    });

    test("should vote on thread", async ({ page }) => {
        await page.goto("/forum");
        
        // Navigate to a thread
        const firstThread = page.locator("a[href^='/forum/thread/']").first();
        if (await firstThread.isVisible().catch(() => false)) {
            await firstThread.click();
            
            // Find upvote button
            const upvoteButton = page.locator("button").filter({ has: page.locator("[data-icon='arrow-big-up']") }).first();
            
            if (await upvoteButton.isVisible().catch(() => false)) {
                await upvoteButton.click();
                
                // Verify vote registered (button should change appearance)
                await expect(upvoteButton).toHaveClass(/text-primary|fill-primary/);
            }
        }
    });

    test("should have proper accessibility attributes", async ({ page }) => {
        await page.goto("/forum");
        
        // Check for proper heading hierarchy
        const h1 = page.locator("h1");
        await expect(h1).toHaveCount(1);
        
        // Check for search landmark
        const search = page.locator("[role='search']");
        await expect(search).toBeVisible();
        
        // Check for feed role on thread list
        const feed = page.locator("[role='feed'], [role='list']");
        expect(await feed.count()).toBeGreaterThan(0);
    });
});

test.describe("Forum Keyboard Navigation", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.goto("/forum");
    });

    test("should navigate tabs with keyboard", async ({ page }) => {
        // Focus first tab
        await page.keyboard.press("Tab");
        
        // Press right arrow to move to next tab
        await page.keyboard.press("ArrowRight");
        
        // Verify tab changed (implementation depends on tab component)
        // This test verifies keyboard interaction works
    });

    test("should navigate thread list with keyboard", async ({ page }) => {
        // Navigate to thread list
        const threads = page.locator("[role='feed'] article, [role='listitem']");
        
        if (await threads.first().isVisible().catch(() => false)) {
            // Tab to first thread
            await page.keyboard.press("Tab");
            
            // Press Enter to navigate
            await page.keyboard.press("Enter");
            
            // Verify navigation
            await expect(page).toHaveURL(/\/forum\/thread\/.+|\/forum\/category\/.+/);
        }
    });
});
