import { expect, type Page } from "@playwright/test";

export async function setHeaderTheme(page: Page, theme: "dark" | "light") {
  const toggle = page.getByRole("banner").getByRole("button", {
    name: /^Switch to (light|dark) theme$/,
  });
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  if ((await toggle.getAttribute("aria-label")) === `Switch to ${theme} theme`) {
    await toggle.click();
  }
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${theme}\\b`));
}
