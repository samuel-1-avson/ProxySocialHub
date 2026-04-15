import type { NextConfig } from "next";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

if (!walletConnectProjectId && process.env.NODE_ENV !== "test") {
  console.warn("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. WalletConnect-backed EVM wallets will be unavailable in the web app, but Solana wallet login still works.");
}

const nextConfig: NextConfig = {
  compress: true,
  output: "standalone",
  trailingSlash: false,
  reactCompiler: true,
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
  // CORS headers for API communication
  async headers() {
    return [
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
      {
        source: '/dashboard/settings',
        destination: '/dashboard/settings/identity',
        permanent: true,
      },
      {
        source: '/dashboard/profile',
        destination: '/dashboard/settings/identity',
        permanent: true,
      },
      {
        source: '/dashboard/security',
        destination: '/dashboard/settings/security',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
