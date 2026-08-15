# ProxyHubb — production system audit

**Date:** 2026-07-26 (initial) · **Re-audit:** 2026-07-26 evening
**Environment assessed:** live GCP deployment (`proxyhubb.com`, `api.proxyhubb.com`), single Compute Engine VM running Docker Compose
**Method:** static code review across control-api, edge-gateway, provider-node, apps/web, migrations, and infrastructure. No live penetration test or load test was run.
**Supersedes for status purposes:** `PRODUCTION_READINESS_VERDICT_2026-07-18.md` (which assessed a local-only stack)
**GitHub:** `samuel-1-avson/ProxySocialHub`

---

## Re-audit verdict (current)

The original five money/data P0s are **closed in code**, and backups are **verified on the live VM** (cron + GCS + snapshot schedule + restore drill). Remaining risk has shifted from “silent double-spend / no backups” to **data-plane security and single-VM ops**.

| Original P0 | Status |
|-------------|--------|
| No Postgres backups | **FIXED** — live cron, GCS, disk snapshots, restore drill |
| Admin payout RMW | **FIXED** — `FOR UPDATE` + atomic `Expr` |
| Unsigned `/v1/usage/report` | **FIXED** — `X-Gateway-Auth` + gateway metering |
| Public `/v1/health/nodes*` | **FIXED** — admin-only + redacted |
| Untrusted `X-Forwarded-For` | **FIXED** — `SetTrustedProxies` |

Also closed since the morning pass: wallet locks (subscriptions/referral/staking/circle/escrow milestones), Next.js 16.2.11, compose mem/CPU/`nofile`, log rotation overlay, KYC/milestone fail-closed, `userRole` for admin, CORS staging/prod require origins, marketplace order auth policy, Playwright prod guard, web `node` healthcheck, migrate-before-deploy, GHCR pull-deploy script, uptime-probe workflow, `cache.Client` + `StartSystemMonitor`, HTTP timeouts/graceful shutdown, `/ready`.

**Current ranked remaining risks**

| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | High | Buyer CONNECT TLS | **FIXED** (GCP require + cert helper) |
| 2 | High | Provider IPv6-mapped SSRF | **FIXED** |
| 3 | High | Refresh token httpOnly | **FIXED** (`Set-Cookie` + `/v1/auth/logout`) |
| 4 | High | User WebSocket origin / `userRole` | **FIXED** |
| 5 | High | NATS volume + Postgres buffers | **FIXED** |
| 6 | High | Observability profile-gated | **FIXED** (GCP default-on; set Slack/PD) |
| 7 | High | GHCR owner mismatch | **FIXED** (`samuel-1-avson`) |
| 8 | Medium | Billing settle claim | **PARTIAL** — SETNX + Del after commit; cron jobs use Redis leader lease (`WORKER_LEADER_LEASE`) |
| 9 | Medium | Map 5000-row joins / SSE DB poll | **MITIGATED** — singleflight + LIMIT 2000; SSE 10s + skip unchanged |
| 10 | Medium | Dead `api.RegisterMetricsEndpoint` helper | **FIXED** — no-op (monitoring owns `/metrics`) |

Topology is still Phase A: one VM, one disk, one of everything. Backups + snapshots make disk loss recoverable; they do not make the box HA.

---

## Original verdict (morning — historical)

The system is **functionally live and architecturally sound**, but it is running production traffic on a topology that `GCP_TESTNET_PHASE_A.md` explicitly scopes as a credit-funded testnet, and there were **five defects that can lose money or data** (all closed in the re-audit table above).

The single most important fact at original write time: **there are no database backups.** That is no longer true on the live VM — see §2.1 status.

Ranked by expected loss (original):

| # | Issue | Consequence |
|---|-------|-------------|
| 1 | No Postgres backup of any kind | Total, unrecoverable data loss |
| 2 | Admin payout is a non-atomic read-modify-write | Silent double-spend of provider payouts |
| 3 | `POST /v1/usage/report` accepts unsigned reports from any logged-in user | Arbitrary billing inflation against any buyer |
| 4 | `/v1/health/nodes*` is public and mutable | Provider residential IPs leaked; node state changed by anyone |
| 5 | `X-Forwarded-For` is trusted from any source | WAF, all rate limits, and IP bans are bypassable |

---

## 1. Deployment reality

Production is one `e2-standard-4` VM (4 vCPU, 16 GB RAM, 80 GB disk) in `us-central1-a`, running roughly eleven containers under Docker Compose, with host-level Caddy terminating TLS.

```
Internet
  ├─ 443 ──► Caddy ──► web :3000 (127.0.0.1)
  │            └────► control-api :8080 (127.0.0.1)
  ├─ 8090 ─────────► edge-gateway  (buyer CONNECT, plaintext)
  └─ 3128 ─────────► edge-gateway  (provider tunnel, TCP + QUIC)
```

Postgres and Redis are correctly unpublished in the GCP overlay. Boot disk now has a **daily snapshot schedule**; Postgres dumps go to GCS. NATS JetStream still has **no named volume**.

Three structural consequences remain:

**Everything is a single point of failure.** One VM, one static IP, one instance of every service. Deploys are still outages; backups change RPO, not RTO under HA.

**Capacity is partially bounded.** GCP overlay now sets `mem_limit`/`cpus` and edge `nofile`, plus log rotation — but base Postgres still uses `shared_buffers=1GB` / `effective_cache_size=3GB` unless overridden.

**Observation is optional.** Prometheus/Grafana remain behind `--profile observability`. `StartSystemMonitor` **is** called; Slack/PagerDuty still need real env values. External probe workflow exists (`uptime-probe.yml`) but needs `UPTIME_API_BASE_URL`.

---

## 2. P0 — fix this week

### 2.1 No database backups

The only reference to `pg_dump` anywhere in the repository is one prose line in `GCP_TESTNET_PHASE_A.md:200` suggesting a manual weekly cron. There is no script, no cron entry, no GCS bucket, no WAL archiving, and no GCP disk snapshot schedule. Current RPO is unbounded and RTO is "rebuild from scratch and accept the loss."

Data that exists only on that disk: Postgres (users, orders, wallets, escrow), Redis AOF, `infra/oracle-keypair.json` (the Solana signing key), the plaintext `.env`, and NATS JetStream — which has **no volume at all**, so settlement and telemetry streams are lost on any container recreate despite being configured for file storage.

Do today: a `pg_dump -Fc` cron to a versioned GCS bucket, plus a GCP scheduled snapshot policy on the boot disk. Then actually restore one into a scratch instance, because an untested backup is a guess.

**Status (2026-07-26):** Verified on live `proxyhubb-testnet` VM — daily cron, local `pg_dump -Fc` + sha256, GCS upload to `gs://proxyhubb-<project>-postgres-backups`, boot-disk snapshot schedule `proxyhubb-daily-boot-snap`, and restore drill into `proxyhubb_restore_drill` (smoke: `auth.users` / `wallets` / `orders` / `sessions`). Scripts: `scripts/gcp-postgres-backup*.sh`, `gcp-testnet-provision-backups.sh`. See `docs/GCP_TESTNET_PHASE_A.md`.

### 2.2 Admin payout can double-spend

```374:385:services/control-api/internal/api/admin.go
	// Deduct from wallet
	wallet.BalanceSOL -= req.Amount
	db.DB.Save(&wallet)

	// Create ledger entry
	ledger := models.WalletLedgerEntry{
		WalletID:    wallet.ID,
		Type:        models.TransactionPayout,
		Amount:      -req.Amount,
		Description: "Provider payout to " + req.Phone, // Payout in SOL
	}
	db.DB.Create(&ledger)
```

Four defects compound here. There is no transaction and no row lock, so concurrent payouts both read the same balance and the second write erases the first — the balance falls by one payout while two are disbursed. GORM's `Save` writes the full struct, so it also clobbers any concurrently-modified column on that row, including the spending limits. Neither write's error is checked, so a failed balance update still creates a ledger entry and returns HTTP 200 `"status": "processed"`. And `reference` on line 372 is a second-resolution timestamp that is never stored in the ledger row's `ReferenceID`, so there is no idempotency key and no way to detect a duplicate afterward.

The minimal fix is a conditional atomic update, which also collapses the check-then-act gap on lines 366-369:

```sql
UPDATE wallets SET balance_sol = balance_sol - $1
WHERE user_id = $2 AND balance_sol >= $1
RETURNING balance_sol;
```

No rows returned means insufficient balance. Wrap the ledger insert in the same transaction and set `ReferenceID` to a client-supplied idempotency key.

The same read-modify-write pattern appears in `escrow_milestones.go:56-96`, `milestones.go:184-196`, `subscriptions.go:129-133` and `:233-245`, `referral.go:168-174`, `staking.go:156-159`, and `circle_pool.go:692-701`. By contrast the billing worker, P2P transfer, withdrawal, crypto deposit, and escrow release paths **do** lock correctly — so the pattern is understood, it just was not applied uniformly.

`milestones.go` has an additional ordering bug: the milestone is marked claimed at line 178 *before* the credit is attempted, and the entire credit is wrapped in `if err == nil`. A failed wallet lookup consumes the milestone, credits nothing, and returns `"Reward claimed successfully"`.

### 2.3 Billing can be inflated by any authenticated user

```34:37:services/control-api/internal/billing/aggregator.go
func (a *Aggregator) VerifySignature(sessionUsername string, bytesUp, bytesDown int64, nonce uint64, signatureHex string) error {
	if signatureHex == "" {
		return nil // no signature supplied; treated as trusted (internal gateway)
	}
```

`POST /v1/usage/report` is registered on the user-authenticated route group, not behind `requireGatewayAuth`. Combined with the above, any buyer's JWT can post arbitrary usage against any session username and have it accepted as trusted. The comment's assumption — that an unsigned report must have come from the internal gateway — is not enforced by the route's authentication.

Move the endpoint to `/v1/gateway/*` behind the existing `X-Gateway-Auth` check (which is correctly implemented with a constant-time compare at `gateway.go:184-197`), and reject empty signatures when `APP_ENV` is not development.

### 2.4 Public, mutable infrastructure endpoints

`RegisterHealthRoutes(v1)` is mounted at `main.go:392` under `SupabaseAuthMiddlewareOptional`, which does not abort on a missing token. That makes all four routes public:

- `GET /v1/health/nodes` returns the full `models.Node` struct — including `ip_address`, `user_id`, and `provider_user_id` — for every node, with no `LIMIT`. Residential provider IPs are the most sensitive data this platform holds.
- `GET /v1/health/nodes/:id` same, per node.
- `POST /v1/health/nodes/:id/check` and `POST /v1/health/nodes/:id/reactivate` are **unauthenticated state changes**.

Also public through Caddy: `/metrics` and `/metrics/json`, registered on the root engine at `monitoring/metrics.go:344-353` with no auth.

`GET /v1/usage/session/:session_id` (`usage.go:496-533`) reads Redis and returns bytes used and cost for any session id with no ownership check at all.

### 2.5 Client IP is attacker-controlled

`SetTrustedProxies` is never called anywhere in the repository. Gin therefore trusts `X-Forwarded-For` from any source, and `c.ClientIP()` returns the leftmost, attacker-supplied value. The WAF whitelists `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16` at `middleware/waf.go:61`, so a single header — `X-Forwarded-For: 10.0.0.1` — bypasses the SQL-injection, XSS, and path-traversal filters entirely, along with every rate limiter, the IP reputation ban list, and the KYC webhook IP allowlist.

It is also an integrity problem in the other direction: an attacker can spoof a victim's IP to get it banned for 24 hours, and every IP in `audit_logs` is untrustworthy as evidence.

One line fixes it, placed before the middleware stack:

```go
r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
```

### 2.6 No HTTP server timeouts and no graceful shutdown

```843:849:services/control-api/main.go
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	r.Run(":" + port)
```

`gin.Run` uses Go's default `http.Server`, which sets no `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, or `IdleTimeout`. A public API with no read-header timeout is Slowloris-able by a laptop. There is also no `signal.Notify` + `srv.Shutdown()`, so every `docker compose up -d` severs in-flight requests — including order creation and escrow calls — mid-flight.

### 2.7 Next.js is six days behind a security release

`apps/web` is on Next.js **16.2.2**. Vercel's coordinated release on 2026-07-20 patched nine CVEs (four high) in **16.2.11**; the affected range is `>=16.0.0 <16.2.11`.

Of the four high-severity issues, the one that most plausibly applies is **CVE-2026-64642**, a middleware/proxy authorization bypass, because this app relies on `middleware.ts` for route authorization and runs App Router with a single locale. **CVE-2026-64645 (SSRF via rewrites) does not apply** — the rewrite destination at `next.config.ts:62` is built from the `API_URL` environment variable, not from request data.

```bash
npm install next@16.2.11 eslint-config-next@16.2.11
```

---

## 3. Bottlenecks and capacity

### Where the ceiling is

`GCP_TESTNET_PHASE_A.md:225` states the move to Phase B is warranted above roughly **50 concurrent buyer sessions**. That is the honest number for this hardware. What breaks, in order:

**Memory, first and hardest.** No container limits, Postgres tuned for a dedicated host, a 100,000-entry session cache in the gateway, and a halo2 prover on the same 16 GB. The OOM killer picks the victim, and it may well pick Postgres.

**Disk, quietly.** No `logging:` driver options in any compose file and no `/etc/docker/daemon.json`, so container logs grow without bound against 80 GB shared with Postgres, Prometheus TSDB, and `--build` image layers accumulated on every deploy.

**Edge-gateway CPU and file descriptors.** `MAX_CONCURRENT_CONNECTIONS` defaults to 8192 (`config.rs:385-388`) with no `ulimits.nofile` anywhere in compose. That cap is unreachable on 4 vCPU, so the box will exhaust memory or FDs before the semaphore ever engages.

**Every API call traverses Node.** The `/v1/*` rewrite in `next.config.ts:61-80` proxies all browser API traffic through the Next.js server. This is a good security design — `API_URL` stays server-only and the browser never contacts the backend directly — but it puts a Node process in the hot path for every request, on the same four cores as Postgres and the proxy.

### Specific hot paths worth fixing

**The listing cache does not exist.** `cache.Client` is assigned only in `internal/testutil/testutil.go` and never in production code, so every `cache.Get`/`cache.Set` in `listings.go:68-112` silently no-ops and the 60-second cache never engages. The same bug makes `/v1/health/system` report Redis permanently unhealthy, because `health/system.go:70-78` pings `cache.Client` rather than the `redisClient.Client` the rest of the service uses. One assignment at startup fixes both.

**Circuit breakers are decorative.** `CircuitBreakerMiddleware` at `main.go:363-365` only stores a breaker object in the Gin context. `ProtectedServiceCall` — the function that would actually gate a call — is defined at `middleware/circuitbreaker.go:161` and never invoked. Requests proceed normally with every breaker open, and `/metrics/circuit-breakers` reports state nobody acts on.

**Map endpoints run large lateral joins.** Marketplace geo/map and explorer node-geo previously fetched up to 5000 rows with no fill coalescing. **Mitigated (2026-07-27):** Redis cache + `singleflight` (`loadCachedOrBuild` / `cache.GetOrLoad`), query limit lowered to 2000.

**SSE streams poll the database per client.** Previously every 3s per connection. **Mitigated (2026-07-27):** 10s poll + skip unchanged payloads (keepalive comment). Pub/sub-driven SSE remains a Phase B improvement.

**The health monitor scans every node every minute** and spawns one goroutine per node to TCP-dial it (`health/health.go:101-117`). This scales linearly with the provider fleet and would multiply per replica.

**Provider bridges have no idle timeout.** The gateway sets `proxy_idle_timeout_secs` (default 60s), but `provider-node/src/proxy/handler.rs:181` uses a bare `copy_bidirectional` with no idle bound, so half-open connections accumulate FDs on provider machines indefinitely.

**Neither Rust service sets a release profile.** No `[profile.release]` in `edge-gateway/Cargo.toml` or `provider-node/Cargo.toml`, so both build with default `codegen-units = 16` and no LTO. Adding `lto = "fat"`, `codegen-units = 1` is a one-time config change worth roughly 10-30% on the hot path.

### Missing indexes on hot queries

`services/control-api/migrations/` is **never executed**. The runner in `internal/db/migrate.go` reads only `*.up.sql` from the repo-root `migrations/` directory, and the Dockerfile copies only that directory. Consequently `20260121_database_improvements.sql` has never been applied, and the `zk_batches` table that `internal/models/zk_batch.go` references may not exist in production.

The most consequential gap is `orders.escrow_pda`, which the Solana escrow activator queries on every escrow event with no index. On a live database, add these with `CONCURRENTLY` so they do not lock:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_escrow_pda
  ON orders (escrow_pda) WHERE escrow_pda IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_listing_status
  ON sessions (listing_id, status) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nodes_healthy_quality
  ON nodes (is_healthy, quality_score DESC) WHERE deleted_at IS NULL AND is_healthy = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_status_created
  ON proxy_listings (status, created_at DESC) WHERE deleted_at IS NULL;
```

Note that **no existing migration uses `CONCURRENTLY`**, so every past index build locked writes on its table. Adopt it as the standard for anything applied from here on.

### Scaling beyond one replica is currently unsafe

Every cron-style worker starts unconditionally on each process with no leader election: billing settlement, payout retry, blockchain indexer, node sync, governance execution, liquidity management, ZK settlement, leaderboard refresh, heartbeat monitor. A second replica would double-settle billing and double-submit payouts.

Compounding it, `billing/worker.go:141-183` scans Redis pending keys and settles them with no `SETNX` claim, and there is no unique constraint on the ledger tying an entry to its session — so two workers can read the same key before either deletes it. Redis is also deleted inside the DB transaction at `worker.go:215-218`, so a rollback loses the pending bytes permanently.

Rate limiters, WAF counters, and WebSocket connection caps are all per-process `sync.Map` state, so limits multiply by replica count.

Before scaling: leader-elect the cron workers or split them into a `replicas: 1` deployment, add `SETNX` claims plus a unique ledger constraint on `(wallet_id, type, reference_id)`, and move the Redis delete after commit.

---

## 4. P1 — next two weeks

**Infrastructure.** Add `mem_limit` and `cpus` to every service (port the blocks that already exist in `docker-compose.secure.yml`). Configure Docker log rotation. Set `ulimits.nofile: 65536` on edge-gateway. Reduce Postgres `shared_buffers` to ~256MB for a shared host. Give NATS a named volume. Remove the public port bindings on NATS (4222/8222) and bind zk-prover to `127.0.0.1:8095` — the GCP VPC firewall is currently the only thing blocking them, and note that **UFW does not filter Docker-published ports**, so the rules in `gcp-testnet-vm-setup.sh` are not protecting these.

**Observability.** Turn on the observability profile. Point alerts at a real Slack webhook or the `PAGERDUTY_ROUTING_KEY` that `docker-compose.yml:135` already supports. Wire `health.StartSystemMonitor()`. Add blackbox probes against `https://api.proxyhubb.com/health` from outside the VM — an in-VM check cannot detect the VM being down. Add disk-full and certificate-expiry alerts.

**Deployment.** `.github/workflows/deploy.yml` targets AWS EKS, Vercel, and Supabase — none of which is your production environment. It builds and pushes perfectly good images to `ghcr.io` that the VM never pulls. Either point a workflow at the VM or delete the misleading one. Meanwhile, stop building on the production host: `docker compose pull` with pinned tags instead of `up -d --build` removes a CPU spike, disk churn, and a chunk of deploy downtime, and gives you a rollback target. Also worth noting `migrate-database` runs *after* `deploy-production`, which is backwards.

**Security follow-ups.** Fail closed when the Solana oracle is unavailable — `milestones.go:138-174` currently credits rewards without on-chain proof and `kyc.go:191-197` auto-approves KYC. Fix `isAdmin()` in `disputes.go:226-231` and `kyc.go:340`, which read context key `role` while the middleware sets `userRole`, so JWT admins are never recognized. CORS defaults should allow `proxyhubb.com` only (Vercel fallback removed). Restrict SSH to admin IPs or IAP. Reduce the 24-hour access-token TTL.

**Web.** Move refresh tokens to httpOnly cookies set by the backend rather than `document.cookie` (`auth.tsx:79-85`). Fix the middleware policy so `/marketplace/orders/[id]` is not matched as public by the blanket `/marketplace/` prefix rule (`policies.ts:93-96`). Guard `NEXT_PUBLIC_PLAYWRIGHT_SOLANA_WALLET_SECRET` behind a non-production check so a Solana private key can never be baked into a production bundle. Add `apk add wget` to the runner stage or replace the healthcheck — `wget` is not present in `node:20-alpine`, so the container healthcheck is failing. Wire an error reporter; `ErrorBoundary.tsx:113` tells users "our team has been notified" while `main` only calls `console.error`.

**Data plane.** Mirror the gateway's IPv4-mapped IPv6 unwrapping into `provider-node`'s `is_public_ipv6` (`handler.rs:379-386`) so `::ffff:169.254.169.254` cannot slip past post-DNS validation. Add an idle timeout to the provider bridge. Enforce `max_connections` locally on provider-node rather than only advertising it. Add jitter to the fixed 30-second reconnect interval to avoid a synchronized reconnect storm after any gateway restart.

---

## 5. P2 — architectural, plan deliberately

Move to managed services: Cloud SQL with PITR, Memorystore, and a load balancer in front of stateless control-api replicas. That is the only real fix for the SPOF and the deploy-is-an-outage problem, and the prerequisites are the worker leader-election and shared-state items in section 3.

Terminate TLS on the buyer proxy. Today `curl -x "http://USER:PASS@proxy.proxyhubb.com:8090"` sends proxy credentials in cleartext over the internet; `BUYER_TLS_ENABLE` exists and defaults to false.

Decide the port policy. `policy.rs:12-24` permits SSH (22), SMTP (25/465/587), FTP (21), and DNS (53) egress by default. For a marketplace selling residential exit IPs, that is meaningful abuse and legal exposure. Default-deny to HTTP/S and make anything wider an opt-in tier.

Wire up `DomainPolicy::check_domain`. The blocklist machinery — including `*.gov`, `*.mil`, `*.bank`, and a Redis-backed dynamic list at `proxy:blocklist:domains` — is fully implemented at `policy.rs:323-542` and **never called from any ingress path**. Until it is, you have no mechanism to block a destination in response to an abuse complaint.

Add retention. `wallet_ledger_entries`, `marketplace_funnel_events`, `login_attempts`, and `usage_records` all grow forever with no partitioning or cleanup. `explorer_transactions` is properly partitioned by month, so the pattern exists. Note also that the app writes to `audit_logs` while migrations only create `audit_logs_partitioned`, and the `pg_cron` partition job targets the latter — so audit retention is currently automated for a table nothing writes to.

Fix money arithmetic. Columns are correctly `NUMERIC(20,9)`, but the Go structs use `float64` (`models/wallet.go:27,51-52`), so all arithmetic is binary floating point and `balance_after` will drift from the true sum over time. `reconciliation_history` is worse — it stores SOL as `DOUBLE PRECISION` in the database itself (`000049_reconciliation_history.up.sql`). Integer lamports (`int64`) is the correct representation.

Consolidate the two migration directories, and add an advisory lock to `RunMigrations()` before anyone is tempted to set `AUTO_MIGRATE=true` on more than one replica.

Add SEO infrastructure. For a public marketplace there is no `sitemap.ts`, no `robots.ts`, no per-listing `generateMetadata`, and no OG tags — every page shares one title and description.

---

## 6. What is already well built

Worth stating explicitly, so effort is not spent re-doing it.

**SSRF defense is genuinely strong.** `edge-gateway/src/policy.rs` blocks loopback, RFC1918, link-local, `169.254.169.254`, `169.254.170.2`, `metadata.google.internal`, and IPv4-mapped IPv6, and it is enforced on all three ingress paths — HTTP CONNECT (`main.rs:839`), HTTP/3 (`h3.rs:169`), and SOCKS5 (`socks5.rs:119`). `provider-node` then re-validates after DNS resolution, which closes the rebinding hole that a gateway-only check would leave open. There is even a honeytoken registry for metadata probes. This is real defense in depth; the only gap is the IPv6-mapped case on the provider side noted above.

**Authentication is solid.** HS256 is pinned with an explicit algorithm check (`crypto/jwt.go:39-42`), refresh tokens are SHA-256 hashed at rest with rotation and family revocation on reuse detection, wallet login nonces are single-use in Redis, and the gateway control plane uses a constant-time comparison.

**The KYC webhook is properly layered** — IP allowlist, HMAC signature, timestamp tolerance, and Redis idempotency — and it fails closed on every one of them, including when the allowlist env var is unset.

**Money paths that were done right** include the billing worker, P2P transfer, withdrawal, crypto deposit, and escrow release, all using `SELECT ... FOR UPDATE`, with `SKIP LOCKED` on batch payout claiming. Crypto deposits verify on-chain amount, treasury recipient, and sender-wallet binding, with tx-hash idempotency. Order pricing is derived server-side from the listing rather than trusted from the client.

**SQL injection is properly handled.** Sort parameters are allowlisted with normalized direction (`discovery/query.go:185-232`) and queries are parameterized throughout — no `fmt.Sprintf` into SQL in production code.

**The explorer public API redacts correctly** via `publicNodeSummary()`, and session/earnings feeds are off by default. The contrast with `/v1/health/nodes` shows the right pattern already exists in the codebase.

**Frontend fundamentals are good:** standalone Docker output, strict TypeScript with no `ignoreBuildErrors`, heavy map/globe libraries dynamically imported, single-flight token refresh, and exponential backoff with jitter on WebSocket reconnect.

**Explorer WebSockets are production-grade** — per-IP and per-user caps, write deadlines, slow-client eviction, and ping/pong. The user WebSocket at `websocket.go:13-18` returns `true` from `CheckOrigin` and should adopt the same approach.

---

## 7. Suggested sequence

### Closed (do not re-open without regression)

Backups + restore drill · `SetTrustedProxies` · health/metrics lockdown · usage-report gateway auth · atomic payouts/wallet locks · Next 16.2.11 · compose limits + log rotation · `cache.Client` + system monitor · timeouts/shutdown · KYC/milestone fail-closed · admin `userRole` · CORS require origins · marketplace order auth · Playwright prod guard · web healthcheck · migrate-before-deploy · GHCR pull script · uptime-probe workflow.

### Next (re-audit priority)

1. ~~**Buyer TLS on `:8090`**~~ — GCP overlay defaults `BUYER_TLS_ENABLE` + `PROXYHUB_REQUIRE_BUYER_TLS`; use `./certs` or `scripts/gcp-buyer-tls-selfsigned.sh`.
2. ~~**Provider IPv6-mapped SSRF**~~ — `to_ipv4_mapped()` unwrap in provider-node.
3. ~~**httpOnly refresh cookies**~~ — backend `Set-Cookie` + `/v1/auth/logout`; web no longer writes refresh via `document.cookie`.
4. ~~**User WebSocket origin allowlist** + `userRole`~~ — shares `allowedOrigin` with explorer WS.
5. ~~**NATS named volume** + GCP Postgres `shared_buffers≈256MB`~~.
6. ~~**Align GHCR owner**~~ — `github.repository_owner` / default `samuel-1-avson`.
7. ~~**Observability default-on for GCP**~~ — Prometheus/Grafana start without profile; set Slack/PagerDuty + `UPTIME_API_BASE_URL`.
8. ~~**Billing worker SETNX + Del after commit**~~ — claim lock per session; Redis pending deleted only after successful commit.
9. ~~**Map/geo singleflight + SSE poll reduction**~~ — `loadCachedOrBuild` / LIMIT 2000; SSE 10s + unchanged skip.
10. ~~**Dead RegisterMetricsEndpoint**~~ — no-op; monitoring package owns scrapes.
11. ~~**Worker Redis leader lease**~~ — settlement, payout retry, escrow cleaner, heartbeat, tier eval, leaderboard MV, settlement aggregator (`WORKER_LEADER_LEASE=false` to disable). Full HA leader election still Phase B.

### Then

Indexes `CONCURRENTLY` · pub/sub-driven SSE · Wire Slack/PagerDuty on VM · Phase B (Cloud SQL / Memorystore / LB) · harden leader election before horizontal scale.

---

*Findings were verified by direct code reading where cited. Load and penetration testing were not performed; the capacity numbers are estimates derived from configuration and the project's own Phase A documentation. Re-audit evening pass confirmed the original P0 money/data items closed and re-ranked remaining High items above.*
