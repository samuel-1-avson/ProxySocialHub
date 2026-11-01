import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/providers/QueryProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { SkipLink } from "@/components/Accessibility";
import { TestnetEnvironmentBanner } from "@/components/TestnetEnvironmentBanner";

export const metadata: Metadata = {
  title: {
    default: "ProxyHubb | Proxy capacity, connected.",
    template: "%s | ProxyHubb",
  },
  description:
    "Discover proxy capacity, manage provider listings, and inspect public network records.",
};

const displayFont = localFont({
  src: "./fonts/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  variable: "--font-display",
  display: "swap",
});

const dataFont = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-code",
  preload: false,
  display: "swap",
});

/**
 * Root layout intentionally excludes Solana/EVM wallet providers.
 * WalletBoundary is mounted on authenticated shells and auth pages only
 * so public routes do not pay for chain JS (reconstruction plan §25.2).
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body
        className={`${displayFont.variable} ${dataFont.variable} antialiased`}
      >
        <SkipLink />
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider>
              <TestnetEnvironmentBanner />
              <ErrorBoundary level="page">{children}</ErrorBoundary>
              <ToastContainer />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
