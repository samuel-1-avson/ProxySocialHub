import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/providers/QueryProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { SkipLink } from "@/components/Accessibility";
import { TestnetEnvironmentBanner } from "@/components/TestnetEnvironmentBanner";

export const metadata: Metadata = {
  title: "ProxyHubb — Proxy marketplace and network explorer",
  description:
    "Discover proxy capacity, manage provider listings, and inspect public network records.",
};

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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <SkipLink />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider>
              <TestnetEnvironmentBanner />
              <ErrorBoundary level="page">
                {children}
              </ErrorBoundary>
              <ToastContainer />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
