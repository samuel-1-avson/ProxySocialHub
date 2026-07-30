# Marketplace Phase 3 — completion & soak notes

**Date:** 2026-07-30  
**Epic:** [#8](https://github.com/samuel-1-avson/ProxySocialHub/issues/8)  
**Environment:** GCP `proxyhubb-testnet` (`api.proxyhubb.com` / `proxyhubb.com`)

Tracks **3A**, **3B**, and **3C** are implementation-complete on `main`. This note closes the planning epic ops checklist that was still open after child issues shipped.

## Child track rollup

| Track | Status doc | Child issues |
|-------|------------|--------------|
| **3A** Catalog | [MARKETPLACE_PHASE3A_STATUS.md](./MARKETPLACE_PHASE3A_STATUS.md) | #9–#13 closed |
| **3B** Order FSM | [MARKETPLACE_PHASE3B_STATUS.md](./MARKETPLACE_PHASE3B_STATUS.md) | #21–#25 closed |
| **3C** Growth | [MARKETPLACE_PHASE3C_STATUS.md](./MARKETPLACE_PHASE3C_STATUS.md) | #30–#33 closed |

ADRs: [0005 catalog](../adr/0005-marketplace-catalog-layer.md), [0006 order FSM](../adr/0006-order-status-fsm.md).

## Prerequisites verified on GCP testnet (2026-07-30)

| Item | Result |
|------|--------|
| Migration `000095` (`pending_review`) | **Applied** (`schema_migrations`) |
| Migration `000096` (`marketplace_funnel_events`) | **Applied** |
| Migration `000097` (catalog products/offers) | **Applied** |
| Migration `000107` (subscriptions + paid SKUs) | **Applied**; plans `free` / `pro` / `scale` present |
| Catalog backfill verification SQL | **Pass** (vacuous): `eligible_listings=0`, `products=0`, `offers=0`, `orphan_listings=0` — no marketplace listings yet on this DB |
| Funnel events table | Present; count `0` (no traffic yet) |

Re-run catalog checks after first listings land using [MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md](../MARKETPLACE_CATALOG_BACKFILL_RUNBOOK.md).

## Moderation enforce soak

`MARKETPLACE_LISTING_MODERATION` is **unset** on current GCP `.env` (not `enforce`). Admin moderation console + pending_review schema are live; an enforce-mode soak is an **ops follow-up** when ready to gate public browse (see README / staging enforce checklist). Not blocking Phase 3 eng exit.

## `/v1/services` deprecation

Legacy `/v1/services*` remain thin adapters with deprecation headers (`discovery_deprecation.go`). Canonical path is `/v1/listings`. Removal after a communicated 90-day window is a **cross-cutting follow-up**, not required to close Track 3A–3C.

## Cross-cutting (explicitly remaining)

These were listed on the epic as optional / any-track follow-ups — **not** required to close Phase 3 tracks:

- Remove `/v1/services` after deprecation window (or ADR to keep forever)
- `ProxyMapPoint` canonical contract everywhere
- Legacy `nodes` vs `provider_nodes` read-path cleanup
- Live moderation E2E against real API
- `SmartMatchWidget` hydration clock mismatch

## Definition of done (Phase 3 exit)

1. [x] ADRs merged; OpenAPI updated for catalog / orders FSM / subscriptions / B2B / funnel
2. [x] Staging/testnet soak notes (this document) + catalog verification SQL run
3. [x] Go tests + Playwright paths shipped with child issues
4. [x] Phase 3 status docs updated (3A / 3B / 3C)
5. [x] Marketplace E2E included in CI path from prior 3A/3C-3 work (`test:e2e:marketplace`)

**Epic #8 may be closed** as Phase 3 strategic backlog complete; remaining items above are backlog hygiene, not open Phase 3 tracks.
