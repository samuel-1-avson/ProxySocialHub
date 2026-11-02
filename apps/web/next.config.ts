import type { NextConfig } from "next";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { explorerRedirects } from "./src/lib/navigation/explorer-redirects.mjs";

const require = createRequire(import.meta.url);
const configDir = path.dirname(fileURLToPath(import.meta.url));
const isPlaywrightE2E = process.env.PLAYWRIGHT_E2E_AUTH_BYPASS === "1";
const analyze = process.env.ANALYZE === "true";

const nextConfig: NextConfig = {
  compress: true,
  output: "standalone",
  trailingSlash: false,
  // React Compiler needs native SWC; disable for Playwright dev server on Windows
  // when @next/swc-win32-x64-msvc is missing or arch-mismatched.
  reactCompiler: !isPlaywrightE2E,
  outputFileTracingRoot: path.join(configDir, "../.."),
  // Only force WASM when native @next/swc-* is unavailable (see NEXT_FORCE_SWC_WASM).
  // Unconditional useWasmBinary breaks some App Router pages on Windows dev:e2e.
  experimental: {
    ...(process.env.NEXT_FORCE_SWC_WASM === "1" ? { useWasmBinary: true } : {}),
    optimizePackageImports: ["lucide-react", "date-fns", "recharts"],
  },
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Baseline security headers for every page, plus CORS headers for API communication.
  // The site has no iframes or embeddable pages (so clickjacking protection is safe), and
  // the node-location picker uses browser geolocation (so no blanket Permissions-Policy).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 180 days, no includeSubDomains: the gateway hosts are not browser-facing HTTPS sites.
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization" },
        ],
      },
    ];
  },
  // Proxy all /v1/* API calls through the Next.js server so the browser never
  // needs to reach the backend directly. API_URL is a server-only env var
  // (not NEXT_PUBLIC_*) so it is never baked into the browser JS bundle.
  async rewrites() {
    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:18080';
    return {
      // /api is reserved by Next internals; keep legacy alias in beforeFiles
      // so compatibility rewrites run before filesystem/API route checks.
      beforeFiles: [
        {
          source: '/api/v1/:path*',
          destination: `${apiUrl}/v1/:path*`,
        },
      ],
      afterFiles: [
        {
          source: '/v1/:path*',
          destination: `${apiUrl}/v1/:path*`,
        },
      ],
      fallback: [],
    };
  },
  async redirects() {
    return [
      ...explorerRedirects('https://explorer.proxyhubb.com'),
      {
        source: '/dashboard/settings/identity',
        destination: '/app/settings',
        permanent: true,
      },
      {
        source: '/dashboard/settings/notifications',
        destination: '/app/settings?tab=preferences',
        permanent: true,
      },
      {
        source: '/dashboard/settings/security',
        destination: '/app/settings?tab=security',
        permanent: true,
      },
      {
        source: '/dashboard/settings/devices',
        destination: '/app/settings?tab=devices',
        permanent: true,
      },
      {
        source: '/feed',
        destination: '/community/feed',
        permanent: true,
      },
      {
        source: '/notifications',
        destination: '/app/settings?tab=preferences',
        permanent: true,
      },
      {
        source: '/settings/notifications',
        destination: '/app/settings?tab=preferences',
        permanent: true,
      },
      {
        source: '/forum',
        destination: '/help/forum',
        permanent: true,
      },
      {
        source: '/forum/popular',
        destination: '/help/forum?sort=popular',
        permanent: true,
      },
      {
        source: '/forum/recent',
        destination: '/help/forum?sort=recent',
        permanent: true,
      },
      {
        source: '/forum/unanswered',
        destination: '/help/forum?filter=unanswered',
        permanent: true,
      },
      {
        source: '/forum/my-posts',
        destination: '/help/forum?filter=mine',
        permanent: true,
      },
      {
        source: '/forum/:path*',
        destination: '/help/forum/:path*',
        permanent: true,
      },
      {
        source: '/community/forum/popular',
        destination: '/help/forum?sort=popular',
        permanent: true,
      },
      {
        source: '/community/forum/recent',
        destination: '/help/forum?sort=recent',
        permanent: true,
      },
      {
        source: '/community/forum/unanswered',
        destination: '/help/forum?filter=unanswered',
        permanent: true,
      },
      {
        source: '/community/forum/my-posts',
        destination: '/help/forum?filter=mine',
        permanent: true,
      },
      {
        source: '/community/forum/category/:slug',
        destination: '/help/forum/category/:slug',
        permanent: true,
      },
      {
        source: '/community/forum/thread/:id',
        destination: '/help/forum/thread/:id',
        permanent: true,
      },
      {
        source: '/community/forum/new',
        destination: '/help/forum/new',
        permanent: true,
      },
      {
        source: '/community/forum',
        destination: '/help/forum',
        permanent: true,
      },
      {
        source: '/community/forum/:path*',
        destination: '/help/forum/:path*',
        permanent: true,
      },
      {
        source: '/community/messages',
        destination: '/messages',
        permanent: true,
      },
      {
        source: '/community/referrals',
        destination: '/app/settings?tab=referrals',
        permanent: true,
      },
      {
        source: '/community/feed',
        destination: '/help/community/archive/feed',
        permanent: true,
      },
      {
        source: '/community/beta',
        destination: '/help/community/archive/beta',
        permanent: true,
      },
      {
        source: '/contact',
        destination: '/help/contact',
        permanent: true,
      },
      {
        source: '/guidelines',
        destination: '/help/guidelines',
        permanent: true,
      },
      {
        source: '/marketplace/agents',
        destination: '/dashboard/agents',
        permanent: true,
      },
      {
        source: '/marketplace/agents/:path*',
        destination: '/dashboard/agents',
        permanent: true,
      },
      {
        source: '/agents',
        destination: '/dashboard/agents',
        permanent: true,
      },
      {
        source: '/agents/:path*',
        destination: '/dashboard/agents',
        permanent: true,
      },
      {
        source: '/friends',
        destination: '/community/friends',
        permanent: true,
      },
      {
        source: '/dashboard/settings',
        destination: '/app/settings',
        permanent: true,
      },
      {
        source: '/dashboard/profile',
        destination: '/app/settings',
        permanent: true,
      },
      {
        source: '/dashboard/security',
        destination: '/app/settings?tab=security',
        permanent: true,
      },
      {
        source: '/dashboard/feed',
        destination: '/help/community/archive/feed',
        permanent: true,
      },
      {
        source: '/dashboard/messages',
        destination: '/messages',
        permanent: true,
      },
      {
        source: '/leaderboards',
        destination: '/explorer/leaderboard',
        permanent: true,
      },
      {
        source: '/settings',
        destination: '/app/settings',
        permanent: true,
      },
      {
        source: '/settings/referrals',
        destination: '/app/settings?tab=referrals',
        permanent: true,
      },
      {
        source: '/onboarding',
        destination: '/app',
        permanent: true,
      },
      {
        source: '/orders/:id',
        destination: '/marketplace/orders/:id',
        permanent: false,
      },
      {
        source: '/dashboard/orders/:id',
        destination: '/marketplace/orders/:id',
        permanent: false,
      },
    ];
  },
};

const withBundleAnalyzer = analyze
  ? require("@next/bundle-analyzer")({ enabled: true })
  : (config: NextConfig) => config;

export default withBundleAnalyzer(nextConfig);
