# ProxyHubb documentation

## Start here

| Document | Purpose |
|----------|---------|
| **[PROJECT_STATE.md](./PROJECT_STATE.md)** | Canonical status: decentralization foundation, web/marketplace progress, risks, next steps |
| **[reports/DECENTRALIZATION_STATUS_REPORT.md](./reports/DECENTRALIZATION_STATUS_REPORT.md)** | Saved decentralization layer report (D1–D4) for reviews |
| **[reports/IMPROVEMENTS_AND_ROADMAP.md](./reports/IMPROVEMENTS_AND_ROADMAP.md)** | Saved achievements list and remaining work |
| **[reports/COMPREHENSIVE_SYSTEM_ANALYSIS_REPORT.md](./reports/COMPREHENSIVE_SYSTEM_ANALYSIS_REPORT.md)** | Full architecture, subsystems, ecosystem, pros/cons, and workflows |
| **[STAGING_ENFORCE_RUNBOOK.md](./STAGING_ENFORCE_RUNBOOK.md)** | Staging enforce, registry, D4 settlement, and live devnet E2E checklist |
| **[SECURITY_GATES.md](./SECURITY_GATES.md)** | Pre-push secret/keypair checks and CI gates |
| **[reports/SECURITY_AUDIT.md](./reports/SECURITY_AUDIT.md)** | Secrets audit findings and remediation (2026-06-03) |
| **[reports/session_analysis_report.md](./reports/session_analysis_report.md)** | AI session postmortem: root causes, hotspots, severity (2026-06-03) |
| **[reports/prompt_improvement_tips.md](./reports/prompt_improvement_tips.md)** | Prompt templates from high-sufficiency sessions |

## Decentralization & providers

| Document | Purpose |
|----------|---------|
| [PROVIDER_PROOFS_DOCKER.md](./PROVIDER_PROOFS_DOCKER.md) | Bootstrap provider, signed heartbeats, enforce mode, listing sign |
| [NODE_REGISTRY.md](./NODE_REGISTRY.md) | Canonical `provider_nodes` runtime registry and legacy mirror troubleshooting |

## Wallet & Solana

| Document | Purpose |
|----------|---------|
| [WALLET_STATUS.md](./WALLET_STATUS.md) | Phases 1–4 completion summary |
| [WALLET_PRODUCTION_CLOSURE.md](./WALLET_PRODUCTION_CLOSURE.md) | Production readiness checklist |
| [MANUAL_DEVNET_SESSION.md](./MANUAL_DEVNET_SESSION.md) | Hands-on devnet wallet session |
| [DEV_SOLANA_SMOKE.md](./DEV_SOLANA_SMOKE.md) | Solana smoke tests |
| [WALLET_E2E_SMOKE.md](./WALLET_E2E_SMOKE.md) | Deposit / withdraw E2E |
| [TREASURY_4.1_AUDIT.md](./TREASURY_4.1_AUDIT.md) | Hot/cold treasury audit notes |

## Edge gateway

| Document | Purpose |
|----------|---------|
| [EDGE_GATEWAY_VNEXT_BLUEPRINT.md](./EDGE_GATEWAY_VNEXT_BLUEPRINT.md) | vNext architecture blueprint |
| [../services/edge-gateway/docs/REMAINING_PHASES.md](../services/edge-gateway/docs/REMAINING_PHASES.md) | Phase checklist (P1–P6) |
| [../services/edge-gateway/docs/P4_TRANSPORT_SOAK_RUNBOOK.md](../services/edge-gateway/docs/P4_TRANSPORT_SOAK_RUNBOOK.md) | Provider transport soak |
| [adr/](./adr/) | Architecture decision records |

## Marketplace (Phase 2 complete)

| Document | Purpose |
|----------|---------|
| [MARKETPLACE_PHASE2_SCOPE.md](./MARKETPLACE_PHASE2_SCOPE.md) | Phase 2 execution scope (WS-A–E) |
| [reports/MARKETPLACE_SYSTEM_ANALYSIS_REPORT.md](./reports/MARKETPLACE_SYSTEM_ANALYSIS_REPORT.md) | Analysis, gaps, §12 checklist |
| [MARKETPLACE_DISCOVERY_API.md](./MARKETPLACE_DISCOVERY_API.md) | **Canonical buyer discovery:** `GET /v1/listings` (not `/v1/services`) |
| [MARKETPLACE_MODERATION.md](./MARKETPLACE_MODERATION.md) | `pending_review` + admin approve/reject |
| [MARKETPLACE_FUNNEL_METRICS.md](./MARKETPLACE_FUNNEL_METRICS.md) | Funnel events + SQL examples |
| [MARKETPLACE_CREDENTIAL_GATING.md](./MARKETPLACE_CREDENTIAL_GATING.md) | Order/credential policy |

New integrations should use **`/v1/listings`** per [openapi.yaml](./openapi.yaml). `/v1/services` remains as a deprecated wrapper (90-day sunset).

## Product & architecture

| Document | Purpose |
|----------|---------|
| [SYSTEM_ARCHITECTURE_AND_PRODUCT_DEEP_DIVE.md](./SYSTEM_ARCHITECTURE_AND_PRODUCT_DEEP_DIVE.md) | Product-oriented architecture entry |
| [SYSTEM_ANALYSIS_REPORT.md](./SYSTEM_ANALYSIS_REPORT.md) | API route index, migrations, env matrix |
| [EXPLORER_IMPLEMENTATION_PLAN.md](./EXPLORER_IMPLEMENTATION_PLAN.md) | Explorer phased delivery |
| [EXPLORER_REFRESH_STRATEGY.md](./EXPLORER_REFRESH_STRATEGY.md) | Explorer WS/REST/metrics refresh semantics |

## Web app (`apps/web`)

| Document | Purpose |
|----------|---------|
| [../apps/web/README.md](../apps/web/README.md) | Dev server, scripts, Playwright map E2E, shared map components |

Public API contract (authoritative): [openapi.yaml](./openapi.yaml). Legacy Swagger tree: [../services/control-api/docs/README.md](../services/control-api/docs/README.md) (non-authoritative).

## Operations

| Document | Purpose |
|----------|---------|
| [DOCKER_REBUILD.md](./DOCKER_REBUILD.md) | Docker rebuild notes |
| [EXPLORER_VERIFICATION.md](./EXPLORER_VERIFICATION.md) | Explorer verification |
| [CI_WALLET_STEPS.md](./CI_WALLET_STEPS.md) | CI wallet steps (when CI enabled) |

## Removed / merged (2026-06-02)

The following were redundant with **PROJECT_STATE.md** or **WALLET_STATUS.md** and were deleted:

- `PROJECT_REVIEW_REPORT.md` (repo root)
- `IMPLEMENTATION_PROGRESS_AND_CURRENT_STATE_REPORT.md`
- `WALLET_PHASE1_STATUS.md` … `WALLET_PHASE4_STATUS.md`
- `WEB_APP_DEEP_DIVE_REPORT.md`
- `NETWORK_SOCIAL_MARKETPLACE_DATA_DEEP_DIVE.md`
- `EXPLORER_DEEP_ANALYSIS.md`
- `apps/web/src/app/explorer/map/INTEGRATION_GUIDE.md`
- `apps/web/src/app/explorer/map/README.md` — stale Phase 1–6 integration guide; use `EXPLORER_IMPLEMENTATION_PLAN.md` and `apps/web/README.md`

## Removed / merged (2026-06-03)

- `EDGE_GATEWAY_DEEP_DIVE.md` — superseded by blueprint + phase sign-offs (`REMAINING_PHASES.md`)
- `WALLET_SYSTEM_DEEP_DIVE_REPORT.md` — superseded by `WALLET_STATUS.md` + `WALLET_PRODUCTION_CLOSURE.md`
- `services/edge-gateway/docs/P1_BASELINE.md` — trimmed; raw criterion logs removed (see `P1_SIGNOFF.md`)
- `WALLET_IMPLEMENTATION_PLAN.md` — superseded by `WALLET_STATUS.md` and `WALLET_PRODUCTION_CLOSURE.md`
- `NEXT_STEPS_TRACKER.md` — superseded by `STAGING_ENFORCE_RUNBOOK.md` and `MANUAL_DEVNET_SESSION.md`
- `MARKETPLACE_NODE_MAP_MERGE_PLAN.md` — completed/stale; remaining cleanup tracked in `reports/IMPROVEMENTS_AND_ROADMAP.md`
- `PROVIDER_SYSTEM_DEEP_DIVE.md` — stale after provider proof + registry merge work; replaced by `NODE_REGISTRY.md` and `PROVIDER_PROOFS_DOCKER.md`
- `PROVIDER_PHASE1_VERIFY.md` — replaced by `STAGING_ENFORCE_RUNBOOK.md` and provider proof Docker runbook
- Generic `create-next-app` `apps/web/README.md` — replaced with ProxyHubb web app index (2026-06-03)
