# Marketplace Phase 3A status (report §12 update)

**Last updated:** 2026-07-29  
**Epic:** [#8](https://github.com/samuel-1-avson/ProxySocialHub/issues/8)  
**ADR:** [adr/0005-marketplace-catalog-layer.md](../adr/0005-marketplace-catalog-layer.md)

This page updates **§12 Recommended phased plan → Phase 3** from the marketplace system analysis report for the **Option B (catalog projection)** track.

## Phase 3 — Strategic (checkboxes)

- [x] **Option B — full catalog tables** (Track 3A): products + offers projection above `proxy_listings`
- [x] **Option C — order state machine extraction** (Track 3B) — [MARKETPLACE_PHASE3B_STATUS.md](./MARKETPLACE_PHASE3B_STATUS.md)
- [x] Buyer subscription SKUs (Track 3C-1) — [MARKETPLACE_PHASE3C_STATUS.md](./MARKETPLACE_PHASE3C_STATUS.md)
- [x] Split agents nav to **`/agents`** top-level (IA cleanup) — #32
- [x] B2B purchase API keys (3C-2) + funnel analytics (3C-4) — see 3C status

## Track 3A workstreams

| WS | Issue | Status | Evidence |
|----|-------|--------|----------|
| **3A-1** Schema + backfill | [#9](https://github.com/samuel-1-avson/ProxySocialHub/issues/9) | **Done** | `migrations/000097_*`, `catalog.BackfillFromListings()`, [backfill runbook](../MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md) |
| **3A-2** Catalog REST API | [#10](https://github.com/samuel-1-avson/ProxySocialHub/issues/10) | **Done** | `RegisterCatalogRoutes`, OpenAPI tag **Catalog** |
| **3A-3** Discovery embed | [#11](https://github.com/samuel-1-avson/ProxySocialHub/issues/11) | **Done** | `?include=product`, [MARKETPLACE_DISCOVERY_API.md](../MARKETPLACE_DISCOVERY_API.md) |
| **3A-4** Web wizard + browse | [#12](https://github.com/samuel-1-avson/ProxySocialHub/issues/12) | **Done** | `/marketplace/manage/products`, `displayListingTitle`, `test:e2e:marketplace` includes catalog spec |
| **3A-5** ADR / OpenAPI / runbook | [#13](https://github.com/samuel-1-avson/ProxySocialHub/issues/13) | **Done** | This page + ADR 0005 + runbook verification SQL |

## Definition of done (3A exit)

1. [x] ADR merged under `docs/adr/`
2. [x] OpenAPI updated for catalog CRUD + discovery `include`
3. [x] Staging migration runbook with product/offer/orphan SQL
4. [x] Go backfill/integration tests + Playwright catalog path
5. [x] Staging soak: run verification SQL after `000097` on GCP testnet (2026-07-30) — see [MARKETPLACE_PHASE3_COMPLETE.md](./MARKETPLACE_PHASE3_COMPLETE.md) (0 eligible listings; orphans 0)

## Next after 3A

1. [x] Staging backfill verify (runbook SQL) and soak notes — [MARKETPLACE_PHASE3_COMPLETE.md](./MARKETPLACE_PHASE3_COMPLETE.md).
2. [x] Track **3B** order FSM — [MARKETPLACE_PHASE3B_STATUS.md](./MARKETPLACE_PHASE3B_STATUS.md).
3. [x] Track **3C** growth — [MARKETPLACE_PHASE3C_STATUS.md](./MARKETPLACE_PHASE3C_STATUS.md).
4. Optional: collections v2 that target catalog slugs (explicitly out of 3A).
