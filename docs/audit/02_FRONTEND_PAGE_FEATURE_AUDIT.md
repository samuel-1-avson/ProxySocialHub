# 02 — Frontend Page & Feature Audit

**App:** `apps/web` — Next.js 16 App Router, React Query, Zustand, Solana wallet adapter.
**API access pattern:** same-origin relative `/v1/*` → Next rewrites (`next.config.ts:61-77`) → `API_URL` (default `http://localhost:18080`). Auth = wallet-challenge JWT; access token in memory, refresh via HttpOnly cookie; middleware guards via `proxyhubb_token` cookie + `lib/navigation/policies.ts`.

## 1. Page / Route Inventory

Status: **works** (wired to real API), **partial** (works with degradation), **mock** (placeholder/hardcoded), **redirect**.

| Route | Role | Main features | API calls | WS | Status | Problems |
|-------|------|---------------|-----------|----|--------|----------|
| `/` | public | Landing, CTAs, network feed | NetworkFeed | — | partial | Hardcoded hero stats `page.tsx:69-73` (FE-07) |
| `/login`, `/register` | public | Wallet challenge login | `/v1/auth/wallet/*`, `/v1/auth/me` | — | works | Wallet-only; role choice UI-only |
| `/marketplace` | public | Browse, filters, facets, collections, SmartMatch | `/v1/listings*`, `/v1/smart-match` | — | works | — |
| `/marketplace/[id]` | public | Detail, buy, social, QA | `/v1/listings/:id`, social/qa, orders | — | works | — |
| `/marketplace/map` | public | Geo map + buy | `/v1/marketplace/map` | optional | works | Live WS flag-gated |
| `/marketplace/create` | provider | Create listing + offer sign | `/v1/listings`, sign-offer | — | works | — |
| `/marketplace/manage` (+`/products`) | provider | Listings CRUD, catalog | `/v1/listings/my`, `/v1/catalog/products*` | — | works | — |
| `/marketplace/orders` (+`/[id]`) | auth | Orders, credentials, cancel | `/v1/orders*` | — | works | — |
| `/marketplace/saved` | auth | Saved listings | `/v1/saved` | — | works | — |
| `/agents`, `/agents/instances` | public/auth | Agent rental, execute | `/v1/agents*` | — | works | — |
| `/network` | public | Unified network shell | map/feed/governance | explorer WS | partial | Redirects if flag off |
| `/dashboard` | auth | Overview, wallet summary | `/v1/analytics/overview`, wallet | — | works | — |
| `/dashboard/admin` | admin/mod | Listing moderation, funnel | `/v1/moderation/*` | — | works | Needs moderator role |
| `/dashboard/agents` | auth | Agent console | agents APIs | — | works | — |
| `/dashboard/analytics` | auth | Usage charts | analytics + `/v1/network/status` | — | partial | **`/v1/network/status` missing in backend (FE-05)** |
| `/dashboard/monitoring` | auth | Ops metrics | `/v1/monitoring/*` | — | works | — |
| `/dashboard/proxy` | auth | Session intents/connect | `/v1/sessions*` | — | works | — |
| `/dashboard/sessions` | auth | Session list | `/v1/sessions` | intended | partial | Realtime depends on broken `/v1/ws` (FE-01) |
| `/dashboard/usage` | auth | Usage billing | `/v1/usage/*` | — | works | — |
| `/dashboard/subscriptions` | auth | Plans CRUD | `/v1/subscriptions*` | — | works | — |
| `/dashboard/trustless` | auth | Usage proofs | `/v1/trustless/*` | — | works | — |
| `/dashboard/wallet` (+`/callback`) | auth | Balance, deposit, withdraw, whitelist | `/v1/wallet*` | explorer WS | partial | WS reachability (FE-02) |
| `/dashboard/become-provider` | auth | Provider application | `/v1/provider/apply` | — | works | — |
| `/dashboard/provider` (+`/setup`,`/nodes`,`/health`,`/analytics`,`/earnings`,`/services`,`/circle`,`/relationships`,`/tokens`,`/cli`) | provider | Full provider suite | `/v1/provider/*`, `/v1/circles*`, `/v1/cli/downloads*` | — | works | CLI download URL may use `NEXT_PUBLIC_API_URL` (FE-08) |
| `/dashboard/settings/identity`,`/account`,`/notifications`,`/api-keys`,`/devices`,`/security` | auth | Settings suite | profile, prefs, `/v1/api-keys`, `/v1/security/sessions`, `/v1/2fa*` | notif WS | partial | Inconsistent `NEXT_PUBLIC_API_URL` prefixing (FE-08) |
| `/community/feed`,`/messages`,`/forum/*` | public/auth | Social surface | `/v1/feed`, `/v1/conversations*`, `/v1/forum/*` | new_message | partial | DMs realtime broken (FE-01) |
| `/community/beta` | public | Beta tasks | `/v1/beta-program*` | — | works | — |
| `/explorer` (+map,nodes,transactions,blocks,wallets,contracts,analytics,health,leaderboard,search) | public | Chain/network explorer | `/v1/explorer/*` | explorer WS | works | sessions/earnings flag-gated |
| `/governance` (+`/[id]`,`/create`) | public/auth | Proposals, votes | `/v1/governance/*` | — | works | — |
| `/treasury` | public | Public treasury | `/v1/treasury/public` | — | works | — |
| `/providers/[id]` | public | Provider profile | profile, listings, social | — | partial | **Hardcoded uptime 99.8% (FE-06)** |
| `/profile`, `/profile/[username]` | auth/public | Profiles | `/v1/profile`, `/v1/users/:id` | — | works | — |
| `/help`,`/guidelines`,`/contact`,`/terms`,`/privacy` | public | Static | — | — | works | — |
| BFF: `/api/health`, `/api/proxy/test`, `/api/sessions/stream` | — | Health/SSE proxy | — | — | works | — |

## 2. Auth Flow (verified)

1. Solana wallet → `POST /v1/auth/wallet/challenge` → sign → `POST /v1/auth/wallet/login` → JWT + user (`auth.tsx:376-437`).
2. Access token in-memory only; legacy localStorage migrated away (`auth.tsx:114-167`) — **good**.
3. Refresh: `/v1/auth/refresh` (HttpOnly cookie), 60s leeway; `fetchWithAuth` retries once on 401 (`auth.tsx:477-507`).
4. Route guards: `middleware.ts` + role policies; e2e bypass cookie restricted to localhost.

## 3. Mock / Hardcoded / Placeholder Inventory

| Location | Issue | Severity |
|----------|-------|----------|
| `src/app/page.tsx:69-73` | Hardcoded landing stats (`99.9%`, `<50ms`, `0.5 SOL`) | Low |
| `src/app/providers/[id]/page.tsx:83` | Hardcoded `avgUptime="99.8%"` | Medium (trust signal) |
| `src/lib/api/marketplace.ts:677-684` | Client-local fake ZK verify tokens `ph-local-zk-*` | Medium |
| `src/lib/solana.ts:93-101`, `BuyListingModal.tsx:84-120` | E2E mock escrow buy when `NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY=1` | Medium (flag hygiene) |
| `src/lib/api/presence.ts:185-187` | Presence WS placeholder | Low |
| `e2e/fixtures/marketplace-purchase.ts` | Playwright mock orders/credentials | Test-only |
| `src/lib/geo/regional-hubs-data.ts` | Static geo hub data (intentional mirror) | Info |

## 4. Realtime / WebSocket Audit

| Client | URL | Auth | Reconnect | Verdict |
|--------|-----|------|-----------|---------|
| `useExplorerWS` | `/v1/explorer/ws` | none (public) | backoff | works when WS reaches API |
| `useWalletWS` | explorer hub, subscribes `user.wallet.<id>` | none | backoff | works when WS reaches API |
| `useWebSocket` / RealtimeProvider | `/v1/ws` | **token fetched, never sent** | 3s retry | **broken (FE-01)** |
| Presence | `/v1/ws` | none | none | stub |

WS URL resolution (`lib/ws-url.ts`): `NEXT_PUBLIC_WS_URL` → `NEXT_PUBLIC_API_URL` → same-origin. Same-origin fails because Next rewrites are HTTP-only; Dockerfile bakes `ws://localhost:18080` (unreachable from users' browsers). **FE-02**.

## 5. Findings

| ID | Title | Severity | Files | Status |
|----|-------|----------|-------|--------|
| FE-01 | `/v1/ws` client never sends credentials → authenticated realtime dead | High | `lib/websocket.tsx`, `lib/ws-url.ts` | **Remediated** (ticket/token query; 2026-07-31 + Sprint A apex→api WS derivation) |
| FE-02 | Same-origin WS cannot traverse Next rewrites | High | `ws-url.ts`, Caddy `api.*` | **Remediated in Sprint A** — browser uses `wss://api.proxyhubb.com/v1/ws` from apex |
| FE-02 | Same-origin WS can't traverse Next rewrites; Docker bakes localhost WS URL | High | `lib/ws-url.ts`, `Dockerfile:43` | Open |
| FE-03 | E2E Solana wallet secret via `NEXT_PUBLIC_*` (bundle leak risk) | Critical→mitigated | `providers/SolanaWalletProvider.tsx:29-46` | **Fixed** (prod guard) |
| FE-04 | Client-side fake ZK reputation verification | Medium | `lib/api/marketplace.ts` (501); UI de-claim 2026-08-08 | **Closed** (fake tokens removed; copy no longer claims trustless ZK) |
| FE-05 | `/v1/network/status` called, not implemented in backend | Medium | `dashboard/analytics/page.tsx:148` | Open |
| FE-06 | Hardcoded provider uptime on public profile | Medium | `providers/[id]/page.tsx:83` | Open |
| FE-07 | Hardcoded landing stats | Low | `page.tsx:69-73` | Open |
| FE-08 | Inconsistent `NEXT_PUBLIC_API_URL` prefixing vs relative `/v1` | Medium | settings/security, analytics, `lib/api/provider.ts:184` | Open |
| FE-09 | Mock-buy flag could ship to non-prod envs | Medium | `BuyListingModal.tsx:84-87`, `lib/solana.ts:93-101` | Open |
| FE-10 | Presence realtime stub | Low | `lib/api/presence.ts:185-187` | Open |
| FE-11 | Supabase stubs + dead public env | Info | `lib/supabase/*`, Dockerfile | Open |
| FE-12 | `Access-Control-Allow-Origin: *` on Next `/api/*` | Low | `next.config.ts:45-55` | Open |
| FE-13 | `Dockerfile.simple` swallows build failure | Medium | `Dockerfile.simple:20` | Open |

## 6. E2E Test Assessment

- Suites: smoke (`app`, `features`, `route-policy`), auth (real API if up), marketplace map/browse/buy/catalog/moderation/credentials (**mocked purchase fixtures**), devnet live buy/governance (real when env present), explorer/topology, social, agents, provider.
- `npm run test:e2e` boots `dev:e2e` on `:4011` with mock-buy + auth bypass → **most marketplace suites do NOT require a live backend**; devnet specs do.
- Consequence: UI regressions caught; API-contract regressions largely not.

## 7. Verdict

The frontend is a genuine, largely complete control-api client for every core buyer/provider flow. It is **not** the source of the platform's biggest risks. Priority fixes: FE-01/FE-02 (realtime), FE-05 (missing route), FE-06/07 (trust-signal honesty), FE-08 (URL consistency). FE-03 was remediated in this audit.
