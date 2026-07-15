# ProxyHubb

Decentralized residential proxy marketplace: buyers fund sessions via Solana; providers run `provider-node` and `edge-gateway` tunnels; **control-api** (Go) is the control plane; **apps/web** (Next.js) is the product UI.

## Documentation

| Start here | Purpose |
|------------|---------|
| [docs/README.md](docs/README.md) | Full documentation index |
| [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md) | Canonical live status (D1–D4, risks, next steps) |
| [docs/reports/PHASE_IMPLEMENTATION_STATUS.md](docs/reports/PHASE_IMPLEMENTATION_STATUS.md) | Phase checklist (governance, marketplace catalog, network) |
| [docs/openapi.yaml](docs/openapi.yaml) | Authoritative HTTP contract for `/v1` |

## Quick start (local Docker)

```powershell
# From repo root — see docs/STAGING_ENFORCE_RUNBOOK.md for full checklist
docker compose up -d --build
```

Typical local URLs: API **18080**, web **3009** (compose) or **4011** (`npm run dev` in `apps/web`), edge gateway host **18090** when `EDGE_GATEWAY_PORT=18090`.

## Monorepo layout

| Path | Role |
|------|------|
| `apps/web` | Next.js frontend |
| `services/control-api` | REST API, auth, listings, orders, wallet, governance |
| `services/edge-gateway` | Buyer CONNECT, provider tunnels, admission |
| `provider-node` | Yamux/QUIC tunnel client, signed heartbeats |
| `migrations/` | Postgres schema (repo root) |
| `docs/` | Runbooks, ADRs, API notes |
| `scripts/` | Bootstrap, verify, E2E helpers |

## Verification

```powershell
.\scripts\verify-provider-phase1.ps1
.\scripts\local-verification.ps1
```

See [docs/SECURITY_GATES.md](docs/SECURITY_GATES.md) before pushing secrets or keypairs.
