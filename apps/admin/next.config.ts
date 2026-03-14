import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // API_URL is a plain server-only var — read at runtime, not baked in at build time.
        // NEXT_PUBLIC_API_URL serves as fallback for local dev (.env.local).
        destination: `${process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
