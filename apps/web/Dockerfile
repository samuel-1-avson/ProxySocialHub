# Dockerfile for Web App (Next.js 15)
# Multi-stage build for production

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
# Install build tools needed for native addons (usb, lightningcss, etc.)
RUN apk add --no-cache python3 make g++ linux-headers eudev-dev
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
ARG NEXT_PUBLIC_SOLANA_PROGRAM_ID=2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL=http://localhost:18080
ARG NEXT_PUBLIC_WS_URL=ws://localhost:18080
ARG NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED=false
ARG NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED=false
ARG NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=false
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
ENV NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED=${NEXT_PUBLIC_EXPLORER_PUBLIC_SESSIONS_ENABLED}
ENV NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED=${NEXT_PUBLIC_EXPLORER_PUBLIC_EARNINGS_ENABLED}
ENV NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=${NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED}

# Build the application
RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

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
CMD ["node", "server.js"]
