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

import { Web3Provider } from "@/lib/web3-provider";

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
              <Web3Provider>
                <AuthProvider>
                  <ErrorBoundary level="page">
                    {children}
                  </ErrorBoundary>
                  <ToastContainer />
                </AuthProvider>
              </Web3Provider>
            </SolanaWalletProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

