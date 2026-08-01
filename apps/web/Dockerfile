# Dockerfile for Web App (Next.js 15)
# Multi-stage build for production

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
# Install build tools needed for native addons (usb, lightningcss, etc.).
# Retry apk: Alpine CDN occasionally aborts mid-extract (e.g. python3-pycache-pyc0).
RUN set -eux; \
  for attempt in 1 2 3 4 5; do \
    if apk add --no-cache python3 make g++ linux-headers eudev-dev; then break; fi; \
    if [ "$attempt" -eq 5 ]; then exit 1; fi; \
    apk cache clean || true; \
    sleep $((attempt * 5)); \
  done
COPY package.json package-lock.json ./
RUN npm install

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies installed for the correct platform
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build arguments for environment variables.
# API_URL is a server-only var used by next.config.ts rewrites (never exposed
# to the browser bundle). It must be baked in at build time for standalone mode.
ARG API_URL=http://control-api:8080
ARG NEXT_PUBLIC_GATEWAY_URL
ARG NEXT_PUBLIC_ENABLE_EVM_WALLETS=false
ARG NEXT_PUBLIC_EVM_CHAIN=sepolia
ARG NEXT_PUBLIC_EVM_RPC_URL=
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_SOLANA_NETWORK=devnet
ARG NEXT_PUBLIC_SOLANA_PROGRAM_ID=AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Leave empty so the browser falls back to same-origin /v1 (via next.config.ts
# rewrites + WS-capable reverse proxy). Setting localhost here breaks real
# deployments: these values are baked into the public browser bundle.
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_WS_URL=
ARG NEXT_PUBLIC_PROXY_ENDPOINT=localhost:8090
ARG NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED=false
ARG NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED=false
ARG NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=false
ARG NEXT_PUBLIC_UNIFIED_NETWORK=false
ARG NEXT_PUBLIC_MAP_LIVE_ON_MARKETPLACE=false
ARG NEXT_PUBLIC_GLOBE_TOPOLOGY=false
ENV API_URL=${API_URL}
ENV NEXT_PUBLIC_GATEWAY_URL=${NEXT_PUBLIC_GATEWAY_URL}
ENV NEXT_PUBLIC_ENABLE_EVM_WALLETS=${NEXT_PUBLIC_ENABLE_EVM_WALLETS}
ENV NEXT_PUBLIC_EVM_CHAIN=${NEXT_PUBLIC_EVM_CHAIN}
ENV NEXT_PUBLIC_EVM_RPC_URL=${NEXT_PUBLIC_EVM_RPC_URL}
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
ENV NEXT_PUBLIC_SOLANA_NETWORK=${NEXT_PUBLIC_SOLANA_NETWORK}
ENV NEXT_PUBLIC_SOLANA_PROGRAM_ID=${NEXT_PUBLIC_SOLANA_PROGRAM_ID}
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_PROXY_ENDPOINT=${NEXT_PUBLIC_PROXY_ENDPOINT}
ENV NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED=${NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED}
ENV NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED=${NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED}
ENV NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=${NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED}
ENV NEXT_PUBLIC_UNIFIED_NETWORK=${NEXT_PUBLIC_UNIFIED_NETWORK}
ENV NEXT_PUBLIC_MAP_LIVE_ON_MARKETPLACE=${NEXT_PUBLIC_MAP_LIVE_ON_MARKETPLACE}
ENV NEXT_PUBLIC_GLOBE_TOPOLOGY=${NEXT_PUBLIC_GLOBE_TOPOLOGY}

# Build the application
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone preserves the app path when outputFileTracingRoot is above the project dir
# (monorepo root locally; filesystem root in this image). server.js is at app/server.js.
COPY --from=builder /app/public ./app/public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./app/.next/static

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:3000/ || exit 1

# Start the application
CMD ["node", "app/server.js"]
