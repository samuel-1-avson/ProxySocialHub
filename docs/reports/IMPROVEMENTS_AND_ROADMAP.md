# ProxyHubb — improvements, achievements, and remaining work

**Report date:** 2026-06-02  
**Companion:** [DECENTRALIZATION_STATUS_REPORT.md](./DECENTRALIZATION_STATUS_REPORT.md), [../PROJECT_STATE.md](../PROJECT_STATE.md)

This document is a saved review artifact: what we improved, what we proved in ops, and what is still open.

---

## Achievements (by theme)

### Provider proofs and enforce mode (D1)

- Ed25519 proof envelope and verification for **heartbeats** and **listing offers**
- `PROVIDER_SIGNATURE_MODE=observe|enforce` with policy API `/v1/system/provider-proof-policy`
- Docker bootstrap: `bootstrap-provider-docker.ps1`, `verify-provider-proofs-docker.ps1`
- CLI signing: `sign-provider-listing.ps1`, `cmd/provider_sign_listing`
- **Enforce soak** script with log grep + policy check
- **Your verification:** heartbeats verified; listing `59876f32-…` with `listing_offer_verified = t` under enforce
- Web **marketplace create**: wallet sign, dev server sign (`sign-offer`), policy flag `dev_server_signing`
- E2E: provider proof badges on map pin detail

### Registry (D2)

- `reconcileProviderNodeRegistry` on provider create/heartbeat and gateway register/reconnect/heartbeat
- Documented canonical rules in `NODE_REGISTRY.md`
- Marketplace geo joins provider/gateway/explorer linkage
- `provider_nodes` now carries gateway runtime fields and is returned as the canonical gateway registration ID
- `nodes` remains as a compatibility mirror linked by `provider_node_id`

### Edge gateway (D3)

- P1–P6 phase sign-offs (performance, multipod, transport, OTEL, ingress experiments)
- `FULL_DECENTRALIZATION` and explorer decentralization status endpoints
- `PROXYHUB_REQUIRE_SIGNED_HEARTBEATS` aligned with provider proofs
- Compose: metrics host port default **9092** to reduce Prometheus conflicts

### Web application

- Route registry expansion + `npm run validate:routes`
- Sidebar / mobile nav alignment and active-route helper
- Marketplace API client consolidation; public vs authenticated split
- **Unified map:** `GET /v1/marketplace/map`, shared `ProxyMapCanvas`, `/marketplace/map` as canonical buy map
- Deep link `?listing=<uuid>` on marketplace map
- **Buy-from-map E2E** (modal open + mocked purchase → credentials UI)
- **Live devnet map-buy E2E harness** (opt-in, real control-api + Solana test wallet)
- **UX fix:** map page no longer dismisses buy modal before credentials success screen

### Wallet / Solana (parallel track)

- Phases 1–4 largely complete per `WALLET_STATUS.md` (treasury, withdraw, fiat removal, tests)
- D4 buyer flow now creates usage proofs on escrow-backed session termination and routes on-chain settlement through the shared finalization hook

---

## Improvements delivered in this session (2026-06-02)

| Change | Why it matters |
|--------|----------------|
| `e2e/marketplace-map-buy.spec.ts` + fixtures | Regression guard for map → buy → credentials |
| `data-testid` on buy modal / start connection | Stable selectors when role text is enough |
| E2E mock buy flag (`NEXT_PUBLIC_PLAYWRIGHT_E2E_MOCK_BUY` + `window.__PROXYHUB_E2E_MOCK_BUY__`) | Full purchase flow without Solana in CI |
| Map `onSuccess` only refetches (modal stays for Done) | Buyers actually see proxy credentials |
| Shared `e2e/fixtures/marketplace-map.ts` | Proof + buy specs stay in sync |
| `docs/reports/*` | Saved reports for walkthroughs |
| Updated `PROJECT_STATE.md` | Single canonical progress record |
| Canonical trustless proof signing | Web signs backend `PROXYHUB_USAGE_PROOF:v1` messages with base58 Ed25519 signatures |
| `000092_provider_nodes_runtime_merge` | `provider_nodes` becomes canonical runtime node identity |
| `STAGING_ENFORCE_RUNBOOK.md` | One staging checklist for enforce, registry, D4, and live devnet E2E |

---

## Current progress snapshot

| Area | Rating | Notes |
|------|--------|-------|
| **Overall product** | 8.0 / 10 | Decentralization wiring complete; staging validation remains |
| **D1 Provider identity** | 9 / 10 | Enforce proven in your Docker run |
| **D2 Registry** | 8 / 10 | `provider_nodes` runtime merge implemented; legacy mirror retained |
| **D3 Edge** | 8 / 10 | Strong infra; ops complexity |
| **D4 Settlement** | 7 / 10 | Proof + settlement wired; live devnet staging needed |
| **Web / map** | 8 / 10 | Unified map + mocked and live-devnet E2E harnesses |

---

## Remaining work (prioritized)

### P0 — Operations and enforce

- [x] Staging/prod runbook: enforce only after `latest_heartbeat_verified` and signing key aligned
- [x] Document host ports: API **18080**, gateway **18090** (if `.env` says so), web **4011** / **3009**
- [ ] UI listing create under enforce with `PROXYHUB_PROVIDER_SIGNING_KEY` on control-api

### P1 — Product hardening

- [x] Navigation policy source parity (`nav.ts` derives policy from `policies.ts`) + dynamic route prefixes
- [x] Marketplace lifecycle integration tests (map → order → session credentials, mocked fast path)
- [x] Optional: live (non-mocked) map buy E2E against dev stack with test buyer JWT
- [ ] Complete remaining `ProxyMapPoint` contract cleanup in code paths that still use legacy map DTOs

### P2 — Decentralization completion

- [x] **D4:** Wire session completion → usage proof → settlement with D1 signer identity
- [x] Registry: `provider_nodes` runtime merge migration + compatibility mirror
- [ ] Production provider key management (rotation, HSM)

### P3 — Release engineering

- [ ] Split large git diff into reviewable PRs (web / control-api / edge / docs)
- [x] Exclude `target/`, binaries, playwright artifacts from commits
- [ ] Dependency audit; Node 20/22 for web Docker image

---

## How to verify (quick)

```powershell
# Provider proofs (Docker)
.\scripts\bootstrap-provider-docker.ps1 -StartProvider
.\scripts\verify-provider-proofs-docker.ps1
.\scripts\soak-enforce-monitor.ps1
.\scripts\post-signed-listing-docker.ps1

# Map E2E (from apps/web)
npm run test:e2e:map          # proof badges + buy flow
npm run test:e2e:map-buy      # buy flow only
npm run test:e2e:map-buy:devnet:check
npm run test:e2e:map-buy:devnet # requires live devnet env/secrets

# Control-api unit tests
cd services\control-api
$env:GIN_MODE='test'
go test ./internal/api/ -run "ReconcileProviderNodeRegistry|SignListingOfferDev" -count=1
```

---

## Documentation index

| Report | Path |
|--------|------|
| Decentralization status (this cycle) | `docs/reports/DECENTRALIZATION_STATUS_REPORT.md` |
| Achievements + roadmap | `docs/reports/IMPROVEMENTS_AND_ROADMAP.md` |
| Living project state | `docs/PROJECT_STATE.md` |
| Provider proofs ops | `docs/PROVIDER_PROOFS_DOCKER.md` |

---

*Update this file after major milestones (enforce in prod, D4 buyer flow, registry decision).*
