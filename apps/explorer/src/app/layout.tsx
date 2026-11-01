import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "./ThemeProvider";
const sans = localFont({ src: "../../../../packages/design-system/fonts/space-grotesk-latin-wght-normal.woff2", variable: "--font-display", weight: "300 700", display: "swap" });
const mono = localFont({ src: "../../../../packages/design-system/fonts/ibm-plex-mono-latin-400-normal.woff2", variable: "--font-code", weight: "400", display: "swap", preload: false });
export const metadata: Metadata = {
  title: "ProxyHubb Explorer",
  description: "Public network, node, and settlement evidence for ProxyHubb.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
