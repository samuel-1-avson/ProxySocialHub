import { test, expect } from "@playwright/test";

test.describe("Messaging", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.waitForURL("/dashboard");
    });

    test("should display messages page with conversation list", async ({ page }) => {
        await page.goto("/messages");
        
        await expect(page.locator("text=Encrypted Comms")).toBeVisible();
    });

    test("should send a message", async ({ page }) => {
        await page.goto("/messages");
        
        // Select first conversation if exists
        const firstConversation = page.locator("[role='listitem']").first();
        
        if (await firstConversation.isVisible().catch(() => false)) {
            await firstConversation.click();
            
            // Type and send message
            const messageInput = page.locator("textarea, input[type='text']").last();
            await messageInput.fill("Test message " + Date.now());
            
            const sendButton = page.locator("button[type='submit'], button[aria-label='Send']").last();
            await sendButton.click();
            
            // Verify message appears in list
            await expect(page.locator("text=Test message")).toBeVisible();
        }
    });

    test("should have accessible message input", async ({ page }) => {
        await page.goto("/messages");
        
        const firstConversation = page.locator("[role='listitem']").first();
        if (await firstConversation.isVisible().catch(() => false)) {
            await firstConversation.click();
            
            const messageInput = page.locator("textarea, input[type='text']").last();
            await expect(messageInput).toHaveAttribute("placeholder", /message/i);
        }
    });
});

test.describe("Messaging Accessibility", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.goto("/messages");
    });

    test("should have proper ARIA roles for message list", async ({ page }) => {
        // Look for log role (for chat messages)
        const messageLog = page.locator("[role='log']");
        
        if (await messageLog.isVisible().catch(() => false)) {
            await expect(messageLog).toHaveAttribute("aria-live", "polite");
        }
    });

    test("should support keyboard navigation in conversations", async ({ page }) => {
        const conversations = page.locator("[role='listitem']");
        
        if (await conversations.first().isVisible().catch(() => false)) {
            // Tab to first conversation
            await page.keyboard.press("Tab");
            
            // Press Enter to select
            await page.keyboard.press("Enter");
            
            // Verify conversation is selected
            const selected = page.locator("[aria-selected='true'], .selected, .active");
            await expect(selected).toBeVisible();
        }
    });
});
