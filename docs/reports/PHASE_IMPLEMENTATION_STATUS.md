# Phase implementation status (community, governance, marketplace)

**Last updated:** 2026-06-03
**Gate:** Phase 1 governance devnet E2E green via `.\scripts\run-governance-devnet-e2e.ps1 -UseLocalSolana` (local validator + program `2yDRyTwhHnVakKKMhhGG61V9b78RUdXRjAL3UiPwmDd7`).

Use this doc with [PROJECT_STATE.md](../PROJECT_STATE.md) to track phase delivery. Do not market unified network (Option C) until items marked **open** below are acceptable for your release.

---

## Community & governance — Phase 1 (Option A)

| Item | Status | Evidence |
|------|--------|----------|
| Create proposal: `duration_days`, `type`, `execution_data` | **Done** | `apps/web/src/lib/services/governance.ts`, create page + templates |
| Vote: build → sign → relay → mirror (`castVote`, 409 retry) | **Done** | `governance.ts`, `governance/[id]/page.tsx`, `e2e/governance.devnet.spec.ts` |
| Vote signature / message alignment | **Done** | Devnet E2E (2/2) |
| `yes_votes` / `no_votes` UI mapping | **Done** | `mapProposal` in `governance.ts` |
| Execution readiness banner / preflight | **Done** | `GET /v1/governance/execution-readiness`, `scripts/verify-phase3-gate.ps1` |
| Governance E2E on devnet | **Done** | `npm run test:e2e:governance:devnet`, smoke 4/4 |
| User-facing quorum / VP copy | **Done** | [GOVERNANCE_VOTING.md](../GOVERNANCE_VOTING.md), create page helper text |
| Operator: multi-sig vs token governance | **Doc** | [GOVERNANCE_VOTING.md](../GOVERNANCE_VOTING.md) § Operators |

**Open (Phase 1 ops / polish)**

| Item | Notes |
|------|--------|
| Public devnet program id | Documented in [SOLANA_PROGRAM_DEPLOYMENT.md](../SOLANA_PROGRAM_DEPLOYMENT.md); local E2E uses `2yDRy…`; `docker-compose.dev.yml` still defaults to legacy `9Mrp…` — override after deploy |
| DB: `governance_proposals.onchain_pda`, `treasury_transactions`, impact `deleted_at` | Non-blocking warnings in logs; migrations when hardening prod |
| Real voting power from wallet stake | UI may show quorum VP; on-chain weight from relay — full PHB display still incremental |

---

## Community & governance — Phase 2 (marketplace ↔ community)

| Item | Status | Evidence |
|------|--------|----------|
| `FeedEventNewListing` on publish/update | **Done** | `services/control-api/internal/api/feed_listing.go` |
| Listing social strip (map + detail) | **Done** | `ListingSocialPanel`, map + `[id]/page` |
| Listing Q&A | **Done** | `ListingQASection`, `GET/POST /v1/listings/:id/qa` |
| Proposal discussion → forum thread | **Done** | `governance/[id]/page.tsx` → `thread_id` |
| Forum E2E paths `/community/forum` | **Done** | `apps/web/e2e/social/forum.spec.ts` |
| Follow provider | **Done** | `FollowProviderButton`; provider profile wired |
| Forum ↔ listing deep links | **Partial** | Q&A creates forum threads; marketplace→forum CTAs vary by surface |
| `listing_social` on provider storefront | **Partial** | `/providers/[id]` has follow; per-listing social on listing cards via `ListingCardEnhanced` |

**Open (Phase 2)**

| Item | Notes |
|------|--------|
| Forum reports admin queue | **Done** | `ForumReportsQueue` on `/dashboard/admin` (Forum reports tab); `GET/PATCH /v1/moderation/forum/reports`; `test:e2e:moderation` |
| WS feed realtime | Hub emits `new_listing`; web feed still polling-oriented |
| Feed cache total / `new_review` in public feed | Optional product decision |

---

## Community & governance — Phase 3 (Option B)

| Item | Status | Evidence |
|------|--------|----------|
| Listing Q&A on detail + map drawer | **Done** | Map drawer + detail pages |
| Follow provider → personalized feed | **Done** | Follow API + feed hints |
| Governance proposal templates | **Done** | `governance-templates.ts`, create page |
| Proposal impact preview | **Done** | `governance-impact.ts`, API `/impact-preview` |
| In-app beta tasks | **Done** | `/community/beta`, `beta_program.go` |

**Open (Phase 3)**

| Item | Notes |
|------|--------|
| Unified network shell | **On in dev/staging** | `/network` + `NetworkShell`; default `NEXT_PUBLIC_UNIFIED_NETWORK=true` in `.env.example` / dev compose; prod still `false`; `npm run test:e2e:network` |
| Domain event bus for all social | Partial — `PublishFeedEvent` + NATS elsewhere; not full event-sourced social |

---

## Marketplace — Phase 3 (strategic / optional)

Catalog design: [adr/0005-marketplace-catalog-layer.md](../adr/0005-marketplace-catalog-layer.md). API: [MARKETPLACE_CATALOG_API.md](../MARKETPLACE_CATALOG_API.md).

| Track | Status | Evidence |
|-------|--------|----------|
| **3A-1** Schema + backfill | **Done** | `migrations/000097_catalog_products_offers.up.sql`, runbook |
| **3A-2** Catalog REST API | **Done** | [MARKETPLACE_CATALOG_API.md](../MARKETPLACE_CATALOG_API.md), `catalog_products.go` |
| **3A-3** `?include=product` on listings | **Done** | Discovery + tests |
| **3A-4** Web manage + browse | **Done (core)** | `manage/products/page.tsx`, `lib/api/catalog.ts`, `include=product` on listing fetches, browse E2E badge; `npm run test:e2e:catalog`; deferrals: collections v2, manage→buy E2E |
| **3A-5** Docs / ADR | **Done** | [adr/0005-marketplace-catalog-layer.md](../adr/0005-marketplace-catalog-layer.md) |
| **3B** Order state machine extraction | **Open** | Explicit non-goal in 3A |
| **3C** Buyer subscription SKUs | **Open** | Product decision |
| **IA** Split agents to top-level `/agents` | **Open** | Still under `/marketplace/agents` |

---

## Verification commands

```powershell
# Governance gate (local Solana)
.\scripts\run-governance-devnet-e2e.ps1 -UseLocalSolana

# API readiness only
.\scripts\verify-phase3-gate.ps1

# Marketplace map E2E
cd apps\web; npm run test:e2e:map

# Admin moderation (listings + forum reports)
cd apps\web; npm run test:e2e:moderation

# Catalog manage UI
cd apps\web; npm run test:e2e:catalog

# Unified network shell (flagged dev server)
cd apps\web; npm run test:e2e:network
```

---

## Next engineering slices (suggested priority)

1. **P1:** Catalog — collections v2, manage→buy E2E, staging backfill verify.
2. **P2:** Deploy escrow to public devnet and align `docker-compose.dev.yml` default program id.
3. **P3:** Option C — embed map in shell, `GET /v1/network/activity`, product sign-off for default-on flag.
4. **P4:** Forum moderation — Go API tests; WS feed realtime for activity rail.
