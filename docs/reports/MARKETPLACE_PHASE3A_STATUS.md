# Marketplace Phase 3A status (report §12 update)

**Last updated:** 2026-07-29  
**Epic:** [#8](https://github.com/samuel-1-avson/ProxySocialHub/issues/8)  
**ADR:** [adr/0005-marketplace-catalog-layer.md](../adr/0005-marketplace-catalog-layer.md)

This page updates **§12 Recommended phased plan → Phase 3** from the marketplace system analysis report for the **Option B (catalog projection)** track.

## Phase 3 — Strategic (checkboxes)

- [x] **Option B — full catalog tables** (Track 3A): products + offers projection above `proxy_listings`
- [ ] **Option C — order state machine extraction** (Track 3B) — deferred; next candidate after 3A soak
- [ ] Buyer subscription SKUs (Track 3C) — product decision
- [ ] Split agents nav to **`/agents`** top-level (IA cleanup)

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
5. [ ] Staging soak: run verification SQL after `000097` on staging (ops)

## Next after 3A

1. Staging backfill verify (runbook SQL) and soak notes.
2. **Selected:** Track **3B** order FSM — see [MARKETPLACE_PHASE3B_STATUS.md](./MARKETPLACE_PHASE3B_STATUS.md) and [ADR 0006](../adr/0006-order-status-fsm.md).
3. Optional: collections v2 that target catalog slugs (explicitly out of 3A).
