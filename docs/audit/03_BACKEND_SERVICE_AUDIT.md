# 03 — Backend Service Audit (control-api)

**Service:** `services/control-api` — Go/Gin monolith, GORM (Postgres), go-redis, NATS JetStream, solana-go oracle. Build target: `main.go` (`Dockerfile`, `-tags '!dev'`). `main_secure.go` is `//go:build ignore` — **dead**.

## 1. Capability Matrix

| Capability | Entry point | Handler(s) | Store | Events | Status | Issues |
|------------|-------------|------------|-------|--------|--------|--------|
| Wallet auth (challenge/login/refresh/logout/me) | `/v1/auth/*` | `auth.go`, `auth_refresh.go` | PG + Redis nonce | — | Real | — |
| API keys + scopes | middleware | `middleware/api_key.go` | PG | — | Real | — |
| Listings/marketplace | `/v1/listings*`, `/v1/marketplace/*` | `listings.go`, catalog, geo | PG + Redis cache | — | Real | Index gaps (DB-05) |
| Orders/escrow | `/v1/orders*`, `/v1/escrow/*` | `orders*.go`, `escrow*.go` | PG | on-chain settle | Real | order-create missing authority header (TEST-01) |
| Wallet/ledger | `/v1/wallet*` | `wallet.go`, `models/wallet_tx.go` | PG (row locks) | — | Real | Not double-entry; float64 (DB-01/02) |
| Withdrawals | `/v1/wallet/withdraw/sol` | `wallet.go:658+` | PG + oracle | outbox on failure | Real | Async chain settle divergence (BE-10) |
| Usage ingest | `/v1/gateway/usage/report` | `usage.go`, `billing/aggregator.go` | PG receipts + Redis | settlement.receipts | Real (hardened) | Soft-accept **fixed** (BE-01) |
| Sessions/intents | `/v1/sessions*` | `session*.go` | PG + Redis | sessions.created/terminated | Real | — |
| Gateway registry | `/v1/gateway/*` | `gateway.go` | PG + Redis | — | Real | Shared-secret auth only |
| Provider ops | `/v1/provider/*` (RequireProviderRole) | `provider_*.go` | PG | telemetry.heartbeat | Real | — |
| Admin API | `/v1/admin/*` (env-gated) | `admin*.go` | PG | — | Real | Dispute admin on wrong group (BE-03) |
| Explorer | `/v1/explorer/*` + WS | explorer pkg | PG (partitioned) | — | Real | — |
| Social/forum/messaging | `/v1/forum/*` etc. | social pkgs | PG | messaging.broadcast | Real | — |
| Treasury/multisig | `/v1/treasury/*`, `/v1/crypto/*` | treasury pkg | PG + chain | treasury.v1.* (**no stream**) | Real | EV-01 |
| KYC | `/v1/kyc/*` | `kyc.go` | PG + chain attestation | — | Real | Role key **fixed** (BE-02) |
| Disputes | `/v1/disputes*`, `/v1/admin/disputes/*` | `disputes.go` | PG | — | Partial | Wrong auth group (BE-03) |
| Staking/referral/milestones/circles | `/v1/staking/*` etc. | various | PG | — | Real/Partial | Circle aliases stubbed (BE-05) |

**Route registration:** `main.go:405-556`; all under `/v1`; three auth layers (optional-auth public, RequireAuth, RequireProviderRole) + env-gated admin group with separate JWT.

## 2. AuthN/AuthZ Detail

- JWT HS256 (`internal/crypto/jwt.go`); Ed25519 wallet challenge-login; refresh tokens opaque + SHA-256 stored; API keys `phub_`/`pk_` with scopes.
- RBAC middleware sets context key **`userRole`** (`middleware/supabase.go:48,59,91,99`; `admin_auth.go:42`).
- **Fixed (BE-02):** `kyc.go:340`, `disputes.go:228`, `websocket.go:76` previously read `c.Get("role")` — never set — so KYC admin override, dispute admin resolution, and WS role attribution silently failed (fail-closed). Now standardized on `userRole`.

## 3. Financial Core (summary — full detail in `10`)

- Helpers `LockWalletForUpdate` + `CreditWalletLocked`/`DebitWalletLocked` (`models/wallet_tx.go:12-65`) — good; some paths (`staking.go`, `escrow_listener.go`) bypass them.
- Migration `000109`: unique `(wallet_id,type,reference_id)` partial index + archive table — good.
- Withdrawal: lock → debit → ledger → chain send → compensating credit + outbox on failure — good pattern.
- **BE-01 (fixed):** `billing/aggregator.go` previously accepted any non-empty signature when `GATEWAY_USAGE_PUBLIC_KEY` unset and provider key missing/failed. Now fails closed (dev-only escape via `ALLOW_UNSIGNED_USAGE` + non-prod env), with 4 new regression tests.

## 4. Events / Messaging (control-api side)

- NATS JetStream streams: SESSIONS, SETTLEMENT, TELEMETRY, MESSAGING (`nats/connector.go:49-52`). Init soft-fails if NATS down.
- **BE-08/EV-01:** `proxy.treasury.v1.topup` and `proxy.treasury.v1.reconciliation` are published but match no stream → silently dropped.
- Redis streams: `bandwidth.consumed` consumed log-only; several declared event types have no producers.

## 5. Edge Gateway Integration

- Live path: HTTP `/v1/gateway/*` behind `X-Gateway-Auth` vs `GATEWAY_SHARED_SECRET` (`gateway.go:183-200`). Usage reports verified via `billing.Aggregator.VerifySignature` (now fail-closed).
- `proto/gateway.proto` gRPC **unused** by control-api (BE-11).

## 6. Error Handling / Observability / Lifecycle

- Errors: ad-hoc `gin.H{"error":...}` — no typed envelope (inconsistent codes).
- Logging/metrics/tracing present (OTel, circuit breakers, WAF); health `/health` `/ready` `/v1/health/*`.
- **Fixed (BE-07):** production `main.go` now drains HTTP on SIGINT/SIGTERM (30s) instead of bare `r.Run`.

## 7. Security Grep Highlights

| Item | Location | Severity |
|------|----------|----------|
| Dev bulk HMAC fallback secret string | `bulk.go:192` | Medium (if prod-mis-set) |
| CORS: whitelist + localhost-reflect only in `APP_ENV=dev`; `StrictCORS` any-origin in development | `main.go:272-298`, `middleware/security.go:78-81` | Low |
| OTLP `WithInsecure` | `middleware/tracing.go` | Low |
| Dev gates `ALLOW_UNSIGNED_USAGE`, `PROXYHUB_ALLOW_DEV_*` | aggregator, orders_dev_activate | Medium — compose defaults **fixed** |
| SQL | GORM parameterized; no string-concat queries in prod paths | OK |

## 8. Unwired Code (dead surface)

`RegisterPricingRoutes`, `RegisterFavoriteRoutes`, `RegisterSavedSearchRoutes`, `RegisterTeamRoutes`, `RegisterBadgeRoutes`, `RegisterSellerTierRoutes`, `RegisterSubtensorRoutes`, `RegisterIPAllowlistRoutes`, `RegisterAdminExtendedRoutes`, `RegisterAdminSessionStreamRoute`, `RegisterSystemAdminRoutes` — implemented but never registered (BE-04). Also `main_secure.go` (build-ignored) and `services/relayer` (exits 1).

## 9. Test Coverage (backend)

~125 `_test.go` files. Strong: wallet incl. withdrawal security, orders/purchase, listings/catalog, explorer hardening, gateway endpoints, messaging/forum, aggregator signatures (extended this audit), compensation outbox, concurrency. **Gaps:** end-to-end escrow race, admin RBAC for unwired modules, NATS producer/consumer contracts, circle-pool financial claims, ledger unique-conflict behavior, KYC/dispute admin authz (now fixed — add regression tests, see `15`).

## 10. Findings

| ID | Title | Severity | Files | Status |
|----|-------|----------|-------|--------|
| BE-01 | Usage signature soft-accept under gateway auth | High | `billing/aggregator.go:57-73` | **Fixed** + tests |
| BE-02 | Role context key mismatch (`role` vs `userRole`) | Medium | `kyc.go:340`, `disputes.go:227-230`, `websocket.go:76` | **Fixed** |
| BE-03 | Dispute admin routes on user-JWT group + blocked when admin API disabled | Medium | `disputes.go:20-21`, `main.go:469` | Partially fixed (authz works via BE-02); re-mount pending |
| BE-04 | 11 unwired `Register*` packages | Medium | various | Open |
| BE-05 | `/v1/circle/my-contributions`,`/revenues` return `[]` | Low-Med | `circle_pool.go:48-57` | Open |
| BE-06 | Dev HMAC fallback + dev-only flags | Medium | `bulk.go:190-192` | Open (compose defaults fixed) |
| BE-07 | No graceful shutdown in prod main | Medium | `main.go` | **Fixed** |
| BE-08 | Treasury NATS subjects without stream | Low-Med | `nats/connector.go`, `treasury_manager.go:261` | Open |
| BE-09 | float64 balances (mitigated by lamports helpers) | Low | `models/wallet.go:27` | Open |
| BE-10 | Async P2P on-chain settle post-commit | Low-Med | `wallet.go:600-611` | Open |
| BE-11 | gRPC gateway.proto unused | Info | `proto/gateway.proto` | Open |
| BE-12 | Relayer dead; oracle sole payout path | Info | `services/relayer/main.go` | Open |
| BE-13 | Escrow platform-fee DB/chain alignment flag drift | Low | `escrow.go:24-32` | Open |
