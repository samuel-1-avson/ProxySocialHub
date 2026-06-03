# ProxyHubb web app

Next.js 16 frontend for marketplace, explorer, wallet flows, and provider tooling. Canonical project docs live in [`docs/README.md`](../../docs/README.md).

## Prerequisites

- Node.js 20+
- Control API and backing services (see [`docs/PROJECT_STATE.md`](../../docs/PROJECT_STATE.md) and [`docs/STAGING_ENFORCE_RUNBOOK.md`](../../docs/STAGING_ENFORCE_RUNBOOK.md))

Copy env from repo root `.env.example` / `.env.docker.example` as needed. The dev server defaults to port **4011**.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local dev server (`http://localhost:4011`) |
| `npm run dev:e2e` | Dev server with webpack (Playwright `webServer`) |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check (`tsconfig.typecheck.json`) |
| `npm run validate:routes` | Route/nav policy parity |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Full Playwright suite |
| `npm run test:e2e:map` | Marketplace map proof + mock buy + browse merchandising |
| `npm run test:e2e:moderation` | Admin listing approve queue (mocked API) |
| `npm run test:e2e:marketplace` | Map + browse + moderation in one Playwright run (shared `dev:e2e`) |
| `npm run test:e2e:map-buy` | Map buy flow only |
| `npm run test:e2e:map-buy:devnet` | Live devnet map buy (requires env; see `e2e/check-live-map-buy-env.mjs`) |

Install Playwright browsers once: `npx playwright install chromium`.

## Map UI

Shared map canvas: [`src/components/map/ProxyMapCanvas.tsx`](src/components/map/ProxyMapCanvas.tsx). Explorer and marketplace routes compose it from `src/app/explorer/map/` and `src/app/marketplace/map/`. See [`docs/EXPLORER_IMPLEMENTATION_PLAN.md`](../../docs/EXPLORER_IMPLEMENTATION_PLAN.md).

**Marketplace API (buyer):** use [`GET /v1/listings`](../../docs/MARKETPLACE_DISCOVERY_API.md) (+ `/featured`, `/facets`, `/collections`, `/search`). Do not integrate against deprecated `GET /v1/services`. Client helpers: [`src/lib/api/marketplace.ts`](src/lib/api/marketplace.ts); funnel events: [`src/lib/analytics/marketplace-funnel.ts`](src/lib/analytics/marketplace-funnel.ts).

**E2E:** `npm run test:e2e:marketplace` (map + browse + moderation, one Playwright process). Playwright starts fresh `dev:e2e` on port 4011 by default. To reuse an existing `npm run dev:e2e`, set `PLAYWRIGHT_REUSE_SERVER=1`. Stop plain `npm run dev` on :4011 — it breaks signed JWT / moderation tests.

## Generated artifacts

Do not commit `playwright-report/` or `test-results/` (gitignored).
