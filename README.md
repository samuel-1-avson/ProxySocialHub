# ProxyHubb

Solana-settled residential proxy marketplace. Buyers discover listings, fund escrow, and pull traffic through the edge gateway — from the web app, the SDKs, or the Chrome extension. Providers run a tunnel daemon that advertises capacity and earns from usage.

| Surface | URL |
|---------|-----|
| Web | https://proxyhubb.com |
| Docs | https://docs.proxyhubb.com |
| API | https://api.proxyhubb.com |
| API contract (redirect) | https://api.proxyhubb.com/openapi.json → docs proxy |
| Buyer proxy | `proxy.proxyhubb.com:8090` (HTTP CONNECT / SOCKS5 only — [docs/buyer-proxy.md](docs/buyer-proxy.md)) |
| Browser extension | Chrome Web Store (unlisted) or load-unpacked — [docs/product/EXTENSION_UNPACKED.md](docs/product/EXTENSION_UNPACKED.md) |

Repo: [samuel-1-avson/ProxySocialHub](https://github.com/samuel-1-avson/ProxySocialHub)

---

## Architecture

```
┌─────────────┐     JWT / X-API-Key      ┌──────────────────┐
│  apps/web   │ ───────────────────────► │  control-api     │
│  (Next.js)  │                          │  (Go, /v1)       │
└─────────────┘                          └────────┬─────────┘
┌─────────────┐   chrome.runtime / HMAC           │
│ apps/       │ ───────────────────────►          │
│ extension   │                                   │
└─────────────┘                                   │
     ┌────────────────┬───────────────────────────┼──────────────┐
     ▼                ▼                           ▼              ▼
┌──────────┐   ┌─────────────┐            ┌─────────────┐  ┌──────────┐
│ Postgres │   │ Redis/NATS  │            │edge-gateway │  │ Solana   │
└──────────┘   └─────────────┘            │   (Rust)    │  │ programs │
                                          └──────┬──────┘  └──────────┘
                                                 │ Yamux/QUIC
                                          ┌──────▼──────┐
                                          │provider-node│
                                          │   (Rust)    │
                                          └─────────────┘
```

- **control-api** — auth, marketplace, orders/escrow FSM, wallets, bulk pools, subscriptions, governance, explorer, OpenAPI redirect
- **edge-gateway** — buyer HTTP CONNECT / SOCKS5 admission and provider tunnels (no absolute-URI forward proxy)
- **provider-node** — provider daemon (heartbeats, capacity, tunnel)
- **apps/web** — marketplace, provider dashboard, agents, explorer UI
- **apps/extension** — Chrome extension: pair with a purchased order, answer 407 HMAC challenges, one-click CONNECT per Chrome profile

---

## Monorepo layout

| Path | Role |
|------|------|
| `apps/web` | Next.js product UI |
| `apps/extension` | Chrome MV3 extension (HMAC CONNECT client) |
| `apps/docs` | Public docs site (Fumadocs → docs.proxyhubb.com) |
| `services/control-api` | Go REST control plane (`/v1`) |
| `services/edge-gateway` | Buyer CONNECT + provider tunnels |
| `services/provider-node` | Provider tunnel client |
| `services/solana-programs` | On-chain escrow / registry programs (Anchor) |
| `services/zk-prover` | Optional Halo2 prover (compose profile) |
| `cli/` | Provider CLI binaries (GitHub Releases; not crates.io) |
| `sdks/nodejs` | `@proxyhubb/sdk` (npm) |
| `sdks/python` | `proxyhubb` (PyPI) |
| `sdks/go` | Go module `github.com/samuel-1-avson/ProxySocialHub/sdks/go` |
| `migrations/` | Postgres schema (numbered migrations) |
| `docs/` | OpenAPI, ADRs, marketplace/B2B/subscription runbooks, audit + ops evidence |
| `scripts/` | Local verify + GCP provision/deploy helpers |
| `infra/` | Observability and infra helpers |
| `config/` | Env templates (e.g. GCP testnet) |

---

## Features

- **Marketplace** — listings, catalog products/offers, map discovery, Solana escrow orders
- **Browser extension** — pair-and-connect buyer flow, per-profile proxy switch, session expiry warnings
- **Provider ops** — setup wizard, CLI downloads, node heartbeats, earnings
- **Bulk proxy pools** — machine API with `phub_` keys (`proxy:read` / `proxy:write`)
- **B2B purchase** — API keys scoped `orders:create` + optional sandbox buy
- **Buyer subscriptions** — wallet-SOL plan SKUs (`free` / `pro` / `scale`) with listing & bandwidth entitlements
- **Agents** — top-level `/agents` marketplace and instances
- **Funnel analytics** — admin/seller dashboards on `marketplace_funnel_events`
- **Network explorer & governance** — transparency and on-chain related surfaces
- **Honest metrics** — listing SLA fields carry provenance (`sla_source`: `gateway` / `explorer` / `provider` = live, `listing` = unmeasured); unmeasured values render as "Unmeasured" in the UI. Seller blocks on public listing reads carry real `created_at` / `is_online` / rating counts. Pre-purchase privacy labels read `Hidden until session` (the signed country/ISP is revealed only via the session handshake).

Marketplace Phase 3 (catalog, order FSM, growth) is complete — see [docs/reports/MARKETPLACE_PHASE3_COMPLETE.md](docs/reports/MARKETPLACE_PHASE3_COMPLETE.md).

---

## Solana escrow (devnet)

Program: `AZGhGfvsiGJQ5S91nkdhGi9qvSNKv3sBZyVJ63KQLfvu` (devnet, upgradeable).

- **Lifecycle** — `initialize_escrow` (buyer+seller PDA) or `initialize_escrow_multisig` (unique PDA per purchase, seeds include `expires_at`) → `settle_escrow` / `refund_escrow` → **account closed, rent reserve returned to the buyer**.
- **CLOSE01 upgrade (2026-08-21)** — settle/refund now close the escrow account (`close = buyer`), so a buyer+seller pair can transact again after a terminal escrow (previously the legacy PDA stayed on-chain and blocked re-initialization). A new `close_escrow` instruction closes pre-upgrade terminal escrows and frees their PDAs. Evidence: [docs/ops/evidence/PHASE_C_money_loop_20260820.md](docs/ops/evidence/PHASE_C_money_loop_20260820.md).
- **Backend reconciliation** — the escrow-cleaner worker cancels unfunded `pending_payment` orders after `PROXYHUB_UNFUNDED_ESCROW_TIMEOUT` and refunds expired funded escrows; self-purchases and cancellation of funded pending escrows are rejected.
- **Frontend guards** — wrong-cluster wallets and insufficient devnet SOL are caught before the Phantom prompt, with user-facing errors.

---

## Security surface

- **`/metrics` locked down** — Prometheus endpoints require an internal scrape or bearer token (`internal/middleware/metrics_auth.go`); the public host returns 404 via Caddy.
- **OpenAPI reachable** — `api.proxyhubb.com/openapi.json` and `/openapi.yaml` redirect to the docs-site spec (override with `PROXYHUB_OPENAPI_URL`), so the API and docs can never drift.
- **Healthcheck convention** — API serves `/health`; web serves `/api/health`. Compose healthchecks and docs follow it.
- **NATS localhost-only** — in `docker-compose.prod.yml`, NATS client/monitor ports bind to `127.0.0.1` (full NATS auth lands before any second host joins).
- **Secrets hygiene** — gitleaks runs on commit/push; treasury keypairs and slash/capability envs stay off the repo and VMs.

Audit context: [docs/audit/2026-08-20-progress-and-bottlenecks.md](docs/audit/2026-08-20-progress-and-bottlenecks.md) → [docs/audit/2026-08-20-implementation-roadmap.md](docs/audit/2026-08-20-implementation-roadmap.md).

---

## Authentication

| Method | How |
|--------|-----|
| Wallet session | `POST /v1/auth/wallet/challenge` → `wallet/login` → `Authorization: Bearer <access_token>` |
| API key | `X-API-Key: phub_…` (or Bearer `phub_` / legacy `pk_`) |

Mint partner keys with a user JWT:

```http
POST /v1/bulk/api-keys
Authorization: Bearer <access_token>
{ "name": "partner", "scopes": "orders:create" }
```

Email/password login is not an active runtime flow. Supabase Auth is not used.

---

## SDKs

Installable buyers clients for **Connect session intents**, marketplace credentials, and bulk pools. Shared surface: [`sdks/README.md`](sdks/README.md).

```bash
npm install @proxyhubb/sdk@0.2.0
pip install proxyhubb==0.2.0
go get github.com/samuel-1-avson/ProxySocialHub/sdks/go@v0.2.0
```

Default API base: `https://api.proxyhubb.com`. Buyer CONNECT: `proxy.proxyhubb.com:8090`. Publish: [`.github/workflows/sdk-publish.yml`](.github/workflows/sdk-publish.yml) / [`sdks/PUBLISH.md`](sdks/PUBLISH.md).

---

## Quick start (local)

```bash
cp .env.example .env
# Fill required secrets (see below), then:
docker compose up -d --build
```

**Required in `.env` (compose):** `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `TOKEN_HMAC_SECRET`, `REDIS_PASSWORD`, `GATEWAY_SHARED_SECRET`

| Service | Default URL / port |
|---------|-------------------|
| API | http://localhost:18080 |
| Web (compose) | http://localhost:3009 |
| Web (`npm run dev` in `apps/web`) | http://localhost:4011 |
| Edge buyer CONNECT | localhost:8090 |
| Provider tunnel | localhost:3128 |

Migrations run via the `db-migrate` service (`AUTO_MIGRATE` / `MIGRATE_ONLY`). Schema lives in `migrations/`.

Optional overlays: `docker-compose.dev.yml`, `docker-compose.minimal.yml`, `docker-compose.full.yml`, `docker-compose.local-solana.yml`, `docker-compose.web-dev.yml`.

### Extension (local testing)

Load `apps/extension` unpacked (`chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist` after `npm run build`), then paste its ephemeral ID into the marketplace connect card. Full steps: [docs/product/EXTENSION_UNPACKED.md](docs/product/EXTENSION_UNPACKED.md).

### Verification

```powershell
.\scripts\local-verification.ps1
.\scripts\verify-provider-phase1.ps1
```

---

## Live stack (GCP testnet)

Production traffic for this project runs on GCE (`proxyhubb-testnet`), not Vercel.

```text
docker-compose.yml
+ docker-compose.testnet.yml
+ docker-compose.gcp-testnet.yml
(+ docker-compose.gcp-images.yml for GHCR pulls)
```

**Web policy (one frontend):**

| Rule | Detail |
|------|--------|
| Canonical URL | `https://proxyhubb.com` (apex) |
| Aliases | `www` / `app` → 301 to apex (`config/gcp/Caddyfile.example`) |
| Canonical deploy | GHCR pull — never mix with ad-hoc VM tarball rebuilds |
| CORS / FRONTEND_URL / APP_URL | Point at the apex only |

Useful scripts:

| Script | Purpose |
|--------|---------|
| `scripts/gcp-testnet-provision.sh` | VM / IP / firewall |
| `scripts/gcp-deploy-web.sh` | **Canonical** web-only GHCR roll |
| `scripts/gcp-compose-pull-deploy.sh` | Pull pinned images + migrate + full stack roll |
| `scripts/gcp-deploy-web-emergency-build.sh` | Emergency VM build (`ALLOW_EMERGENCY_WEB_BUILD=1`) |
| `scripts/gcp-verify-web-deploy.sh` | Image source + route + hostname redirect checks |
| `scripts/gcp-testnet-verify.sh` | Smoke checks |
| `scripts/gcp-postgres-backup.sh` | DB backups |
| `scripts/gcp-ha-lite-install.sh` | Backup verify + Redis copy cron (HA lite) |
| `scripts/gcp-deploy-metrics-lock.sh` | `/metrics` lockdown roll (D.1) |
| `scripts/gcp-deploy-d3-openapi.sh` | OpenAPI redirect roll (D.3) |
| `docs/ops/GCP_HA_LITE.md` | Single-VM recovery limits (not multi-node HA) |

Env template: `config/gcp-testnet.env.example`.

---

## API contract

Authoritative OpenAPI: [docs/openapi.yaml](docs/openapi.yaml) — also reachable live via `https://api.proxyhubb.com/openapi.json` (redirect).

Selected `/v1` areas:

- Auth & sessions — `/v1/auth/*`, `/v1/sessions/*`
- Marketplace — `/v1/listings`, `/v1/catalog/*`, `/v1/orders/*`
- Bulk — `/v1/bulk/pools`, `/v1/bulk/api-keys`
- Subscriptions — `/v1/subscriptions/*`
- Analytics funnel — `/v1/moderation/marketplace/funnel`, `/v1/analytics/marketplace/funnel`
- Provider — `/v1/provider/*`

---

## Documentation

| Doc | Topic |
|-----|-------|
| [docs/openapi.yaml](docs/openapi.yaml) | HTTP contract |
| [docs/adr/0005-marketplace-catalog-layer.md](docs/adr/0005-marketplace-catalog-layer.md) | Catalog projection |
| [docs/adr/0006-order-status-fsm.md](docs/adr/0006-order-status-fsm.md) | Order status FSM |
| [docs/MARKETPLACE_DISCOVERY_API.md](docs/MARKETPLACE_DISCOVERY_API.md) | Discovery / listings / metric-honesty contract |
| [docs/MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md](docs/MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md) | Catalog migrate/backfill |
| [docs/BUYER_SUBSCRIPTION_PLANS.md](docs/BUYER_SUBSCRIPTION_PLANS.md) | Plan SKUs & entitlements |
| [docs/B2B_SANDBOX_PURCHASE.md](docs/B2B_SANDBOX_PURCHASE.md) | Partner purchase + sandbox |
| [docs/product/EXTENSION_UNPACKED.md](docs/product/EXTENSION_UNPACKED.md) | Load-unpacked extension testing |
| [docs/product/EXTENSION_CWS.md](docs/product/EXTENSION_CWS.md) | Chrome Web Store packaging |
| [docs/audit/2026-08-20-implementation-roadmap.md](docs/audit/2026-08-20-implementation-roadmap.md) | Audit remediation plan (Phases A–G) |
| [docs/ops/evidence/](docs/ops/evidence/) | Dated deployment / money-loop evidence |
| [docs/reports/MARKETPLACE_PHASE3_COMPLETE.md](docs/reports/MARKETPLACE_PHASE3_COMPLETE.md) | Phase 3 soak / exit |

---

## Development notes

- Prefer JWT or `phub_` API keys for machine access; never mint keys with another API key.
- Sandbox escrow activation requires `PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE=true` (off in production/testnet by default).
- Do not commit `.env`, keypairs, or secrets — hooks run gitleaks on commit/push.
- Provider CLI artifacts ship via GitHub Releases / `/v1/cli/download`, not crates.io.
- Solana program work: build/test via Docker (`services/solana-programs/proxyhub/scripts/build-in-docker.sh`) — Windows lacks the symlink privileges `solana-test-validator` needs. Upgrade devnet with `scripts/upgrade-proxyhub-close01-devnet.sh`.
- When touching listing payloads, keep the metric-honesty contract: never render unmeasured defaults as real numbers (see `sla_source` in [docs/MARKETPLACE_DISCOVERY_API.md](docs/MARKETPLACE_DISCOVERY_API.md)).

---

## License

See repository license file. SDKs under `sdks/` are MIT unless noted otherwise in package metadata.
