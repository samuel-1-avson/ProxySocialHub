import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import { SolanaWalletProvider } from "@/providers/SolanaWalletProvider";
import { QueryProvider } from "@/providers/QueryProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastContainer } from "@/components/Toast";
import { SkipLink } from "@/components/Accessibility";
import { OptionalEvmWalletProvider } from "@/lib/optional-evm-wallet-provider";

// Replaced Google Fonts with a standard system stack to fix Docker build errors (Network/DNS issues)
// const geistSans = Geist({
//   variable: "--font-geist-sans",
//   subsets: ["latin"],
// });

// const geistMono = Geist_Mono({
//   variable: "--font-geist-mono",
//   subsets: ["latin"],
// });

export const metadata: Metadata = {
  title: "ProxyHub - Ghana's Premium Proxy Marketplace",
  description: "Access reliable Ghana residential proxies or earn by sharing your bandwidth.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased"
      >
        <SkipLink />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <SolanaWalletProvider>
              <OptionalEvmWalletProvider>
                <AuthProvider>
                  <ErrorBoundary level="page">
                    {children}
                  </ErrorBoundary>
                  <ToastContainer />
                </AuthProvider>
              </OptionalEvmWalletProvider>
            </SolanaWalletProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

