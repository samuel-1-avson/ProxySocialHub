# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /repo/apps/docs
RUN apk add --no-cache libc6-compat
COPY apps/docs/package.json apps/docs/package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /repo/apps/docs
COPY apps/docs/ ./
COPY packages/design-system/ /repo/packages/design-system/
COPY docs/openapi.yaml /repo/docs/openapi.yaml
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /repo/apps/docs/public ./apps/docs/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/docs/.next/static ./apps/docs/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "apps/docs/server.js"]
