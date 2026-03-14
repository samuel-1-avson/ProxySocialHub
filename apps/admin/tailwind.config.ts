import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        admin: {
          bg: "#0a0a0f",
          surface: "#111118",
          border: "#1e1e2e",
          accent: "#6366f1",
          "accent-hover": "#4f46e5",
          muted: "#4a4a6a",
          text: "#e2e8f0",
          "text-muted": "#94a3b8",
          danger: "#ef4444",
          warning: "#f59e0b",
          success: "#10b981",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
