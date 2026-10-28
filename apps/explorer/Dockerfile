# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /repo/apps/explorer
COPY apps/explorer/package.json apps/explorer/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /repo/apps/explorer
COPY --from=deps /repo/apps/explorer/node_modules ./node_modules
COPY apps/explorer/ ./
COPY packages/design-system/ /repo/packages/design-system/
ARG NEXT_PUBLIC_APP_URL=https://proxyhubb.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
ARG BUILD_REVISION=unknown
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
ENV EXPLORER_BUILD_REVISION=$BUILD_REVISION
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /repo/apps/explorer/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/explorer/.next/static ./apps/explorer/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "apps/explorer/server.js"]
