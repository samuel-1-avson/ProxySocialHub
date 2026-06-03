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
| `npm run test:e2e:map` | Marketplace map proof + mock buy |
| `npm run test:e2e:map-buy` | Map buy flow only |
| `npm run test:e2e:map-buy:devnet` | Live devnet map buy (requires env; see `e2e/check-live-map-buy-env.mjs`) |

Install Playwright browsers once: `npx playwright install chromium`.

## Map UI

Shared map canvas: [`src/components/map/ProxyMapCanvas.tsx`](src/components/map/ProxyMapCanvas.tsx). Explorer and marketplace routes compose it from `src/app/explorer/map/` and `src/app/marketplace/map/`. See [`docs/EXPLORER_IMPLEMENTATION_PLAN.md`](../../docs/EXPLORER_IMPLEMENTATION_PLAN.md).

## Generated artifacts

Do not commit `playwright-report/` or `test-results/` (gitignored).
