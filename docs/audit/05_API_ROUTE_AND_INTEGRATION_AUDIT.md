# 05 — API Route & Integration Audit

**Surface:** control-api REST `/v1` (Gin), two WebSocket hubs, no GraphQL, gRPC contract exists but unused. Registration: `services/control-api/main.go:405-556`. OpenAPI: `docs/openapi.yaml` (~155KB, 3.1.0) — completeness not machine-verified; known drift listed below.

## 1. Route Inventory (condensed by domain — full data in `data/api_routes.csv`)

Auth legend: **Pub** optional-auth group · **JWT** RequireAuth · **Key** JWT-or-API-key · **Prov** provider role · **GW** X-Gateway-Auth · **Admin** admin JWT (env-gated).

| Domain | Routes (method + path) | Auth | Notes |
|--------|------------------------|------|-------|
| Health | GET `/health`, `/ready`, `/v1/health/*`, `/metrics*` | Pub | ✅ |
| Auth | POST `/v1/auth/wallet/challenge|wallet/login|refresh|logout`, GET `/v1/auth/me` | Pub/self | ✅ |
| Listings | GET/POST `/v1/listings`, GET/PATCH/DELETE `/v1/listings/:id`, `featured|search|my|facets|collections*`, POST/DELETE `:id/save`, GET `/v1/saved`, social/qa/inquire | Pub/self | ✅ index gaps DB-05 |
| Marketplace | GET `/v1/marketplace/map|geo|proof-policy|funnel`, POST `/v1/marketplace/funnel-events`, GET `/v1/map/points|links` | Pub/JWT | ✅ |
| Catalog | `/v1/catalog/products*` CRUD | self/seller | ✅ |
| Sessions | POST `/v1/sessions|intent|instant|from-listing`, GET `/v1/sessions[/:id]|intents[/:id]`, POST/DELETE `:id/terminate`, GET `/v1/sessions/stream` (SSE) | JWT | ✅ dual trailing-slash debt |
| Gateway | POST `/v1/gateway/nodes/register`, `:id/heartbeat|status`, `session-intents/:id/state|usage`, `usage/report` | GW | ✅ shared-secret only |
| Usage | POST `/v1/usage/sign`, GET `/v1/usage/session/:id`, `/v1/usage/me` | JWT | ✅ |
| Orders | POST `/v1/orders|orders/sandbox-buy`, GET `/v1/orders[/:id[/credentials]]`, POST `:id/pay/solana|cancel|activate-dev`, GET `/v1/sales` | JWT/Key | ⚠️ order-create authority header missing (TEST-01) |
| Escrow | GET `/v1/escrow/:orderId`, POST `:orderId/release|dispute`, GET `/v1/escrow/disputes`, jury paths; `jury-vote|resolve` legacy hard-disabled | JWT | ✅ |
| Disputes | POST/GET `/v1/disputes*`, POST `/v1/admin/disputes/:id/resolve|dismiss` | JWT (+admin check) | ⚠️ admin on user-JWT group (BE-03) |
| Wallet | GET `/v1/wallet`, POST `transfer|deposit/crypto|withdraw/sol|link`, limits*, withdrawal-security*, `/v1/wallets*` multi-link | JWT | ✅ rate-limited mutations |
| Crypto/treasury | `/v1/crypto/*` (batch settle, pause), `/v1/treasury/multisig/*`, GET `/v1/treasury/public` | JWT/admin | ✅ |
| Staking/referral/milestones | `/v1/staking/*`, `/v1/referral/*`, `/v1/milestones*` | JWT/Pub | ✅ |
| Circles | `/v1/circles*` (pool, quotes, sessions, revenue), stub aliases `/v1/circle/*` | JWT/Pub | ⚠️ aliases stubbed (BE-05) |
| Provider | `/v1/provider/nodes*|tokens*|lease|earnings*|claim*|services*|relationships*|auth|readiness|gateway-token` | Prov/Pub(auth, gateway-token) | ✅ |
| Bulk/B2B | `/v1/bulk/pools*`, `/v1/bulk/api-keys*` | Key (`proxy:*`) | ✅ dev HMAC fallback (BE-06) |
| Admin | `/v1/admin/login|logout|me|users*|nodes*|payouts*|stats*|escrow/reconciliation*|provider/applications*` | Admin | ✅ env-gated |
| Moderation | `/v1/moderation/listings*`, `/v1/moderation/marketplace/funnel` | JWT moderator | ✅ (parallel to admin paths) |
| Explorer | `/v1/explorer/metrics|stats|transactions|wallets|blocks|nodes|validators|contracts|bandwidth|analytics|leaderboard|sessions|earnings|health/history`, WS `/v1/explorer/ws` | Pub, rate-limited | ✅ sessions/earnings flag-gated |
| Social | `/v1/forum/*`, `/v1/conversations*`, `/v1/messages*`, `/v1/friends*`, `/v1/feed|discover|trending`, `/v1/notifications*`, `/v1/users/:id/*` | Pub/JWT | ✅ |
| Governance | `/v1/governance/*` | Pub read / JWT write | ✅ |
| Misc | `/v1/agents*`, `/v1/subscriptions*`, `/v1/trustless/*`, `/v1/channels/*`, `/v1/smart-match`, `/v1/matching/*`, `/v1/kyc/*`, `/v1/security/*`, `/v1/2fa/*`, `/v1/api-keys`, `/v1/gdpr/delete-account`, `/v1/audit/*`, `/v1/system/*`, `/v1/cli/downloads*` | mixed | ✅ |
| WS hub | GET `/v1/ws` | JWT | ❌ client never authenticates (FE-01) |

## 2. Cross-checks vs Frontend Usage

| Check | Result |
|-------|--------|
| Frontend calls with no backend route | **`/v1/network/status`** (dashboard analytics) — only one found |
| Backend routes never called by frontend | Admin treasury ops, bulk pools (used by SDKs instead), several `/v1/circle/*` aliases, jury legacy endpoints (disabled), unwired `Register*` (no route at all) |
| Schema mismatches | None blocking found in core flows; wallet/order/listing responses consumed consistently |
| Duplicate/alias debt | sessions `""`+`"/"`; `/v1/circles` vs `/v1/circle`; `/v1/admin/*` vs `/v1/moderation/*`; sales JWT-only vs orders JWT-or-key |
| Versioning | single `/v1` prefix — consistent; no deprecation policy documented |
| Error model | ad-hoc `gin.H{"error"}` — inconsistent codes/shape |
| Pagination | listings clamp 1-100; several secondary lists unbounded (subscription plans, badges, some admin payouts, circle members) |
| Rate limiting | WAF/DDoS + endpoint RL on wallet mutations; explorer rate-limited; bulk key RL via Redis ZSET |
| Idempotency | orders idempotency via pending_transactions; ledger uniques (000102/000109); receipts (session,nonce) unique |
| WebSocket auth | explorer hub public OK; **`/v1/ws` broken client-side (FE-01)**; server side behind RequireAuth |
| CORS/CSRF | CORS whitelist + dev localhost-reflect; cookie-based auth on same-origin → CSRF token not implemented for cookie flows (mitigated by Bearer-token primary auth); `ACAO: *` on Next `/api/*` (FE-12) |
| File uploads | none found in surface |
| OpenAPI accuracy | ~155KB spec exists; known drift: `/v1/network/status` absent from impl; gateway metering + treasury multisig paths under-documented |

## 3. Internal Integration Security

| Link | Mechanism | Assessment |
|------|-----------|------------|
| edge-gateway → control-api | `X-Gateway-Auth` shared secret + Ed25519 usage sig | Secret is static per env; rotate + move to mTLS or signed-JWT; signature now fail-closed |
| provider-node → control-api | provider token → scoped JWT (`/v1/provider/auth`, `/v1/provider/gateway-token`) | OK; lease enforcement optional (PN-04) |
| control-api → Solana RPC | public RPC endpoints | RPC outage blocks deposits/withdrawals/settlement; failover helper exists (`withFailover`) |
| control-api → NATS | no auth in compose | enable NATS auth for prod (SEC-07 ports now loopback) |
| SDKs → control-api | `X-API-Key` | OK; scoped `proxy:*` |

## 4. Findings Specific to API Layer

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| API-01 | `/v1/network/status` consumed but unimplemented | Medium | Open |
| API-02 | `/v1/ws` unreachable for authenticated clients (no credential pass) | High | Open |
| API-03 | Admin dispute routes mounted on user-JWT group | Medium | Partially fixed (authz via BE-02) |
| API-04 | Unwired `Register*` packages = phantom capabilities | Medium | Open |
| API-05 | No typed error envelope; inconsistent error shapes | Low | Open |
| API-06 | Unbounded list endpoints on secondary resources | Low-Med | Open |
| API-07 | OpenAPI drift (network/status, gateway, treasury paths) | Low | Open |
| API-08 | Gateway link security = static shared secret | Medium | Open |
