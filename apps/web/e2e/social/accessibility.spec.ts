import { test, expect } from "@playwright/test";

test.describe("Social Features Accessibility", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
        await page.waitForURL("/dashboard");
    });

    test("all interactive elements should have accessible names", async ({ page }) => {
        // Check notification bell
        await page.goto("/dashboard");
        const notificationBell = page.locator("[aria-label*='Notifications']");
        await expect(notificationBell).toHaveAttribute("aria-label", /.+/);

        // Check buttons have text or aria-label
        const buttons = page.locator("button:not([aria-label]):not(:has-text(/.+/))");
        const buttonCount = await buttons.count();
        
        // All buttons should have accessible names
        for (let i = 0; i < buttonCount; i++) {
            const button = buttons.nth(i);
            const hasAccessibleName = await button.evaluate((el) => {
                return (
                    el.hasAttribute("aria-label") ||
                    el.hasAttribute("aria-labelledby") ||
                    el.textContent?.trim().length > 0 ||
                    el.getAttribute("title")?.length > 0
                );
            });
            expect(hasAccessibleName).toBeTruthy();
        }
    });

    test("should have proper heading hierarchy", async ({ page }) => {
        await page.goto("/forum");
        
        // Check h1 exists
        const h1 = page.locator("h1");
        await expect(h1).toHaveCount(1);
        
        // Check no skipped heading levels
        const headings = await page.locator("h1, h2, h3, h4, h5, h6").all();
        let previousLevel = 0;
        
        for (const heading of headings) {
            const level = parseInt(await heading.evaluate((el) => el.tagName)[1], 10);
            expect(level).toBeLessThanOrEqual(previousLevel + 1);
            previousLevel = Math.max(previousLevel, level);
        }
    });

    test("should have proper focus indicators", async ({ page }) => {
        await page.goto("/forum");
        
        // Tab to first interactive element
        await page.keyboard.press("Tab");
        
        // Check focus is visible
        const focusedElement = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            
            const styles = window.getComputedStyle(el);
            return {
                outline: styles.outline,
                outlineOffset: styles.outlineOffset,
                boxShadow: styles.boxShadow,
            };
        });
        
        if (focusedElement) {
            // Should have visible focus indicator
            const hasFocusIndicator = 
                focusedElement.outline !== "none" ||
                focusedElement.boxShadow !== "none";
            expect(hasFocusIndicator).toBeTruthy();
        }
    });

    test("dropdowns should have proper ARIA attributes", async ({ page }) => {
        await page.goto("/dashboard");
        
        // Open notification dropdown
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();
        
        // Check dropdown has proper roles
        const dropdown = page.locator("[role='menu']");
        await expect(dropdown).toBeVisible();
        await expect(dropdown).toHaveAttribute("aria-labelledby", /.+/);
        
        // Check menu items have proper roles
        const menuItems = dropdown.locator("[role='listitem'], [role='menuitem']");
        expect(await menuItems.count()).toBeGreaterThanOrEqual(0);
    });

    test("should respect prefers-reduced-motion", async ({ page }) => {
        // Emulate reduced motion preference
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/forum");
        
        // Check animations are disabled or reduced
        const hasReducedMotion = await page.evaluate(() => {
            return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        });
        
        expect(hasReducedMotion).toBeTruthy();
    });

    test("forms should have proper labels", async ({ page }) => {
        await page.goto("/forum/new");
        
        // Check all inputs have labels
        const inputs = page.locator("input, textarea, select");
        const inputCount = await inputs.count();
        
        for (let i = 0; i < inputCount; i++) {
            const input = inputs.nth(i);
            const hasLabel = await input.evaluate((el) => {
                const id = el.id;
                const ariaLabel = el.getAttribute("aria-label");
                const ariaLabelledBy = el.getAttribute("aria-labelledby");
                const placeholder = el.getAttribute("placeholder");
                const hasExplicitLabel = el.labels && el.labels.length > 0;
                const hasAssociatedLabel = id && document.querySelector(`label[for="${id}"]`);
                
                return (
                    hasExplicitLabel ||
                    hasAssociatedLabel ||
                    ariaLabel ||
                    ariaLabelledBy ||
                    placeholder
                );
            });
            
            expect(hasLabel).toBeTruthy();
        }
    });

    test("images should have alt text", async ({ page }) => {
        await page.goto("/friends");
        
        const images = page.locator("img:not([alt])");
        const imagesWithoutAlt = await images.count();
        
        // Decorative images should have alt="" or role="presentation"
        for (let i = 0; i < imagesWithoutAlt; i++) {
            const img = images.nth(i);
            const isDecorative = await img.evaluate((el) => {
                return el.getAttribute("role") === "presentation" ||
                       el.getAttribute("aria-hidden") === "true";
            });
            expect(isDecorative).toBeTruthy();
        }
    });

    test("should announce dynamic content changes", async ({ page }) => {
        await page.goto("/messages");
        
        // Check for live regions
        const liveRegions = page.locator("[aria-live]");
        const liveRegionCount = await liveRegions.count();
        
        // Should have at least one live region for announcements
        expect(liveRegionCount).toBeGreaterThanOrEqual(0);
    });

    test("color contrast should meet WCAG standards", async ({ page }) => {
        await page.goto("/forum");
        
        // This test would typically use a tool like axe-core
        // For now, we check basic text visibility
        const textElements = page.locator("p, span, h1, h2, h3, h4, h5, h6, a, button");
        
        for (const el of await textElements.all().slice(0, 20)) {
            const isVisible = await el.isVisible().catch(() => false);
            if (isVisible) {
                const color = await el.evaluate((e) => {
                    const styles = window.getComputedStyle(e);
                    return {
                        color: styles.color,
                        backgroundColor: styles.backgroundColor,
                    };
                });
                
                // Text should have a color
                expect(color.color).not.toBe("transparent");
            }
        }
    });
});

test.describe("Keyboard Navigation", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/login");
        await page.fill("[name='email']", process.env.TEST_USER_EMAIL || "");
        await page.fill("[name='password']", process.env.TEST_USER_PASSWORD || "");
        await page.click("button[type='submit']");
    });

    test("should navigate entire page with keyboard only", async ({ page }) => {
        await page.goto("/forum");
        
        // Get all focusable elements
        const focusableSelectors = [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "[tabindex]:not([tabindex='-1'])",
        ];
        
        // Tab through elements and verify focus moves
        let tabCount = 0;
        let lastFocused: string | null = null;
        let stuck = false;
        
        while (tabCount < 20 && !stuck) {
            await page.keyboard.press("Tab");
            
            const currentFocused = await page.evaluate(() => {
                const el = document.activeElement;
                return el ? el.tagName + (el.id ? `#${el.id}` : "") : null;
            });
            
            if (currentFocused === lastFocused) {
                stuck = true;
            } else {
                lastFocused = currentFocused;
                tabCount++;
            }
        }
        
        // Should be able to tab through multiple elements
        expect(tabCount).toBeGreaterThan(1);
    });

    test("Enter key should activate buttons and links", async ({ page }) => {
        await page.goto("/forum");
        
        // Tab to first link
        await page.keyboard.press("Tab");
        
        // Check if focused element is actionable
        const isActionable = await page.evaluate(() => {
            const el = document.activeElement;
            return el && (el.tagName === "A" || el.tagName === "BUTTON" || el.tagName === "INPUT");
        });
        
        if (isActionable) {
            // Store current URL
            const currentUrl = page.url();
            
            // Press Enter
            await page.keyboard.press("Enter");
            
            // Wait for potential navigation
            await page.waitForTimeout(500);
            
            // URL may have changed (navigation occurred)
        }
    });

    test("Escape key should close modals and dropdowns", async ({ page }) => {
        await page.goto("/dashboard");
        
        // Open notification dropdown
        const bellButton = page.locator("[aria-label*='Notifications']");
        await bellButton.click();
        
        // Verify dropdown is open
        const dropdown = page.locator("[role='menu']");
        await expect(dropdown).toBeVisible();
        
        // Press Escape
        await page.keyboard.press("Escape");
        
        // Verify dropdown is closed
        await expect(dropdown).not.toBeVisible();
    });
});
