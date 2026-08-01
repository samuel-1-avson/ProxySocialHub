"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ModeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative p-2 rounded-[var(--radius-md)] transition-colors hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <Sun
        className="h-5 w-5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0"
        aria-hidden
      />
      <Moon
        className="absolute left-2 top-2 h-5 w-5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100"
        aria-hidden
      />
    </button>
  );
}
