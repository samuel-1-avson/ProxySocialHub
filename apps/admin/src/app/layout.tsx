import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProxyHub Admin",
  description: "ProxyHub Administration Panel — Restricted Access",
  robots: "noindex, nofollow",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0a0a0f] text-[#e2e8f0] antialiased">
        {children}
      </body>
    </html>
  );
}
