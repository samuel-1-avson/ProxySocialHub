# ProxyHubb Market System Deep Audit

Date: 2026-07-02
Scope: marketplace discovery, listings, catalog, map, orders, Solana escrow, credentials, provider node linkage, moderation, frontend buyer/provider UX, tests, and operational readiness.

## Executive Verdict

The market system is one of the most complete parts of ProxyHubb: it has listing discovery, provider node linkage, map discovery, catalog products, saved listings, social/Q&A hooks, moderation, order creation, Solana escrow initiation, escrow event activation, credential gating, and buyer-facing Playwright coverage.

It is not production-ready yet. The largest remaining risk is not feature count; it is reliability around money and fulfillment. The system can create an order, lock in a rate, initiate Solana escrow, activate a session after escrow confirmation, and reveal credentials only after activation. However, cancellation/refund/reconciliation paths are not yet strong enough for a revenue path that handles user funds.

Recommended readiness grade:

- Product surface: B
- Backend architecture: B-
- Payment/fulfillment reliability: C
- Operational observability: C+
- Overall market readiness: B-/C+

The best next fix is order cancellation/refund/reconciliation, followed by the remaining SOL currency cleanup in marketplace detail/saved views and a stronger pending-payment recovery UX.

## System Map

### Primary Frontend Surfaces

- Marketplace browse: `apps/web/src/app/marketplace/page.tsx`
- Listing detail: `apps/web/src/app/marketplace/[id]/page.tsx`
- Create listing: `apps/web/src/app/marketplace/create/page.tsx`
- Seller listing management: `apps/web/src/app/marketplace/manage/page.tsx`
- Catalog product management: `apps/web/src/app/marketplace/manage/products/page.tsx`
- Buyer orders: `apps/web/src/app/marketplace/orders/page.tsx`
- Order detail and credentials: `apps/web/src/app/marketplace/orders/[id]/page.tsx`
- Saved listings: `apps/web/src/app/marketplace/saved/page.tsx`
- Marketplace map: `apps/web/src/app/marketplace/map/page.tsx`
- Buy modal: `apps/web/src/components/BuyListingModal.tsx`
- Listing cards: `apps/web/src/components/ListingCard.tsx`, `apps/web/src/components/ListingCardEnhanced.tsx`
- API client: `apps/web/src/lib/api/marketplace.ts`

### Primary Backend Surfaces

- Listings API: `services/control-api/internal/api/listings.go`
- Orders API: `services/control-api/internal/api/orders.go`
- Dev order activation: `services/control-api/internal/api/orders_dev_activate.go`
- Listing moderation: `services/control-api/internal/api/admin_listings_moderation.go`
- Marketplace map/geo: `services/control-api/internal/api/marketplace_geo.go`
- Catalog products/offers: `services/control-api/internal/api/catalog_products.go`
- Funnel analytics: `services/control-api/internal/api/marketplace_funnel.go`
- Listing social/SLA: `services/control-api/internal/api/listing_social.go`, `services/control-api/internal/api/listing_sla.go`
- Escrow API/workers: `services/control-api/internal/api/escrow.go`, `services/control-api/internal/worker/escrow_listener.go`, `services/control-api/internal/worker/escrow_cleaner.go`
- Session activation: `services/control-api/internal/marketplace/session_activation.go`
- Provider node routing helpers: `services/control-api/internal/marketplace/provider_node.go`
- Discovery repositories: `services/control-api/internal/db/listing_read_repository.go`, `services/control-api/internal/db/marketplace_repository.go`

### Core Data Model

- `proxy_listings`: canonical sellable supply.
- `orders`: buyer purchases and escrow/payment state.
- `sessions`: disabled at order creation, activated after escrow confirmation.
- `provider_nodes`: provider runtime nodes backing listings.
- `nodes`: legacy explorer/gateway mirror used for session compatibility.
- `escrow_transactions`, `escrow_milestones`, `escrow_disputes`: escrow accounting.
- `catalog_products`, `catalog_offers`: storefront/product grouping layer.
- `marketplace_funnel_events`: listing view/save/buy/order/escrow/credential funnel.
- `map_node_links`: topology and network map relationships.

## What Is Working Well

1. Listing and order state machines exist.
   `services/control-api/internal/models/state_transitions.go` centralizes allowed transitions. This is a strong base because invalid terminal-state changes are blocked consistently.

2. Credentials are correctly gated behind escrow activation.
   `getOrderCredentials` only returns credentials when the order is `active` or `completed`. Pending and pending-payment orders receive a conflict response.

3. Order creation creates a disabled session before payment.
   `createOrder` resolves the provider node, creates an order, creates credentials, creates a disabled session, and links the session to the order. This creates a clear provisioning target without exposing usable access before escrow.

4. The Solana escrow flow has a clean activation boundary.
   `initiateSolanaPayment` moves the order to `pending_payment` and stores escrow metadata. `escrow_listener.go` moves the order to `active` after an escrow initialized event, then calls `ActivateOrderSession`.

5. Marketplace map reliability has improved.
   `/v1/marketplace/map?include_nodes=true` supports listing pins and provider/explorer nodes, includes provider heartbeat/proof metadata, filters active nodes, and has tests for provider geo fallbacks, deleted listing exclusion, catalog embedding, node inclusion, bbox filtering, and regional hub source handling.

6. Catalog/product layering is useful.
   Catalog products and offers let providers group listings into a storefront-like model without replacing the canonical listing/order path.

7. Moderation exists in two operator surfaces.
   Admin and platform moderation routes can approve or reject pending listings, and moderation state is included in route responses.

8. Test coverage is materially better than a typical early marketplace.
   There are Go tests for listings, orders, moderation, map, catalog, provider node contracts, session activation, and state transitions. There are Playwright specs for browse-buy, listing-buy, map-buy, map proof, catalog, moderation, devnet escrow, and order credentials.

## Critical Findings

### C1. Order cancellation can desynchronize DB state from funded escrow

Evidence:

- `CanTransitionOrderStatus` allows `active -> cancelled` and `pending_payment -> cancelled`.
- `cancelOrder` validates the transition, updates the local order status to `cancelled`, and terminates the linked session.
- The cancel handler does not perform an on-chain escrow refund, require a settlement transaction, create a refund job, or block cancellation of already-funded escrow orders.

Impact:

- A buyer can see an order as cancelled locally while funds remain in an escrow PDA.
- A provider can lose session access while settlement/refund state remains unresolved.
- Support will not have a reliable source of truth for whether cancellation means "not purchased", "refund owed", "refund submitted", or "refund confirmed".

Recommendation:

- Split cancellation by payment state:
  - `pending`: allow local cancel.
  - `pending_payment` without confirmed escrow: allow local cancel only after checking no escrow deposit exists.
  - `pending_payment` with escrow detected: move to `refund_pending`, not `cancelled`.
  - `active`: require explicit refund/settlement/dispute flow; do not silently cancel.
- Add statuses or a separate reconciliation table for `refund_pending`, `refund_failed`, and `refunded_on_chain`.
- Add tests that funded orders cannot become `cancelled` without an on-chain refund record.

### C2. Escrow event loss has no durable reconciliation path

Evidence:

- `escrow_listener.go` retries an initialized escrow event lookup by `escrow_pda`.
- If no matching order is found after retries, it logs a critical manual reconciliation message and returns.
- There is no durable table, retry queue, admin view, or compensating worker for orphaned escrow events.

Impact:

- A successful on-chain transaction can fail to activate an order if the order row is temporarily unavailable, the event arrives before the DB update is visible, or the worker restarts at an unlucky time.
- The buyer's wallet can show payment success while ProxyHubb shows no credentials.

Recommendation:

- Add an `escrow_reconciliation_events` table with `escrow_pda`, `tx_signature`, event type, raw payload, match status, attempt count, and last error.
- Make the listener idempotently upsert unmatched events.
- Add a periodic reconciler that matches orphan events to later orders and activates/refunds as appropriate.
- Surface unresolved escrow events in admin/operator dashboards.

### C3. Escrow refund failures are only logged

Evidence:

- `escrow_cleaner.go` attempts to settle expired escrows with buyer refund.
- If refund fails, it logs `[EscrowCleaner] FAILED to refund escrow ...` and continues.
- There is no retry job, alert state, durable failure marker, or user-visible order state update.

Impact:

- Stuck refunds can disappear into logs.
- Operators cannot easily answer "which users are owed refunds?"
- Buyers can be stranded in active/pending-payment states after an expired escrow.

Recommendation:

- Persist failed refund attempts.
- Add exponential retry with max attempts and operator escalation.
- Expose stuck escrow/refund counts in health/admin metrics.
- Add a test for failed refund persistence.

## High Findings

### H1. Marketplace still has visible dollar pricing in two places

Evidence:

- `apps/web/src/app/marketplace/[id]/page.tsx:268` renders `${listing.price_per_gb}`.
- `apps/web/src/app/marketplace/saved/page.tsx:100` renders `${listing.price_per_gb}/GB`.

Impact:

- The marketplace now positions itself as Solana-settled, but buyers can still see dollar-denominated UI on important pages.
- This conflicts with wallet/order/escrow flows that talk in SOL and lamports.

Recommendation:

- Replace those with `Number(listing.price_per_gb || 0).toFixed(6)} SOL` and `SOL/GB`.
- Add a Playwright assertion that marketplace browse, listing detail, saved listings, map pins, buy modal, and order detail do not show dollar-prefixed pricing for listing rates.

### H2. Price semantics are internally mixed between USD and SOL

Evidence:

- `createOrder` computes `requestedTotalPrice := listing.PricePerGB * req.BandwidthGB`, then calls `RequiredSOLForUSD`.
- `initiateSolanaPayment` comments still assume `Order.TotalPrice` is USD and divides by a SOL price feed.
- The current UI direction is SOL-only, and several frontend surfaces display `price_per_gb` as SOL.
- Initial marketplace migrations use `NUMERIC(20,4)` for `price_per_gb` and `total_price`, while SOL UI commonly displays six decimals and `amount_locked_sol` uses `NUMERIC(20,9)`.

Impact:

- If `price_per_gb` is now SOL, the backend may over/under-charge by converting it as USD.
- If `price_per_gb` is still USD, the frontend SOL labels are misleading.
- Four-decimal storage is too coarse for small SOL-per-GB rates.

Recommendation:

- Choose one canonical unit:
  - Preferred: store listing rates as lamports per GB using an integer column.
  - Acceptable: store SOL per GB as `NUMERIC(20,9)` or wider and never run USD conversion in order/escrow flow.
- Rename or migrate legacy fields/comments to remove `USD` assumptions.
- Add tests for a small SOL price such as `0.000123 SOL/GB` and verify charged lamports.

### H3. Buy flow has a fragile "paid but not active yet" recovery path

Evidence:

- `BuyListingModal` creates an order, calls `/pay/solana`, initializes escrow, polls `waitForOrderActive`, then fetches credentials.
- `waitForOrderActive` times out after 60 seconds by default.
- If the watcher is delayed, the user receives a timeout even if the wallet transaction succeeded.

Impact:

- Buyers can be left unsure whether they paid successfully.
- Support burden increases for every delayed escrow confirmation.

Recommendation:

- Persist the client transaction signature on the order or a payment-intent record immediately after wallet submission.
- On timeout, show a durable pending-payment state with order link, tx hash, and "check payment status" action.
- Add backend endpoint `POST /orders/:id/reconcile-payment` that checks escrow PDA/tx signature and activates or explains the blocking condition.

### H4. Provider node/listing/session routing is powerful but easy to break

Evidence:

- Listing creation and order creation resolve provider nodes.
- `SessionNodeIDForProvider` bridges provider nodes into legacy `nodes` rows for session compatibility.
- `ActivateOrderSession` may route through provider node or legacy node mirror and stores gateway routing data in Redis.

Impact:

- If provider node runtime merge/mirror data is missing or stale, marketplace purchase can create a session that cannot route.
- Map trust, marketplace availability, and gateway routing all depend on this same provider-node health chain.

Recommendation:

- Add a marketplace readiness check per listing: provider node present, gateway identity present, heartbeat fresh, country/city/ISP resolved, legacy node mirror present if required, and Redis activation possible.
- Disable or mark listings unavailable if routing prerequisites fail.
- Add operator metrics for "active listings with unroutable provider node".

### H5. Availability is not decremented at order creation

Evidence:

- `createOrder` checks `listing.AvailableBandwidthGB` against requested bandwidth.
- It increments `orders_count`, but the audited path did not show a corresponding decrement/reservation of available bandwidth.

Impact:

- Concurrent buyers can oversell a listing if availability is not reserved atomically elsewhere.
- Map/listing availability can look healthier than real capacity.

Recommendation:

- Reserve bandwidth atomically in the order creation transaction.
- Release reservation on cancelled/unfunded timeout.
- Convert to consumed/settled usage after session settlement.

## Medium Findings

### M1. Moderation is feature-flagged and may be off in production

Evidence:

- `MARKETPLACE_LISTING_MODERATION` controls whether moderation is enforced.
- Enforced aliases include `enforce`, `strict`, `required`, `true`, `1`, `on`, and `yes`.

Impact:

- A missing production env var can allow immediate public listing activation.

Recommendation:

- Fail startup or log a hard production warning when moderation is off in production.
- Add a config health endpoint field for listing moderation state.

### M2. Deprecated `/v1/services` discovery routes remain active

Evidence:

- `RegisterServiceDiscoveryRoutes` is still registered.
- Documentation says `/v1/services` is deprecated and buyers should use `/v1/listings`.

Impact:

- Integrators can keep building against an older path with different semantics.
- Product analytics split between old and new surfaces.

Recommendation:

- Add a sunset feature flag.
- Return stronger deprecation headers and telemetry.
- Remove route registration after the documented sunset date, or require explicit legacy enablement.

### M3. Catalog status can drift from listing status

Evidence:

- `catalog_products` and `catalog_offers` provide a product layer over canonical listings.
- Listings have moderation/purchasability status, while products/offers have their own active/draft/archive style lifecycle.

Impact:

- Buyers may see product-level availability that does not match listing-level purchasability.
- Providers may not understand whether they should update a product, offer, or listing.

Recommendation:

- Make listing status the final source of purchase truth.
- In API responses, expose product status and listing purchase status separately.
- Add tests for archived products with active listings, active products with paused listings, and pending listings attached to products.

### M4. Marketplace map is much better, but needs geo completeness SLOs

Evidence:

- Recent code supports provider geo fallbacks, map node inclusion, regional hub metadata, and proof fields.
- User-reported issue: ISP/location were not consistently working.

Impact:

- Marketplace map trust depends on country/city/ISP being consistently populated and accurately labeled.

Recommendation:

- Add metrics:
  - percent of active listings with country
  - percent with city
  - percent with ISP
  - percent with verified geo source
  - percent with fresh heartbeat proof
- Add an endpoint or admin tile for map data completeness.
- Include Docker verification: `GET /v1/marketplace/map?include_nodes=true` and provider nodes page inspection after rebuilds.

### M5. Funnel analytics are recorded but not yet operationalized

Evidence:

- Events include `listing_view`, `listing_save`, `buy_modal_opened`, `order_created`, `escrow_initiated`, `escrow_confirmed`, and `credentials_delivered`.

Impact:

- The data is available, but operators may not have a clear dashboard for dropoff or stuck-payment diagnosis.

Recommendation:

- Add funnel dashboard cards:
  - listing views to buy modal
  - buy modal to order created
  - order created to escrow initiated
  - escrow initiated to escrow confirmed
  - escrow confirmed to credentials delivered
- Add time-to-confirm and time-to-credentials histograms.

## Low Findings

### L1. Dev activation route should remain visibly non-production

Evidence:

- `/orders/:id/activate-dev` exists and has tests for env disabling.

Recommendation:

- Keep it disabled by default.
- Add a startup log line and route metadata when enabled.
- Ensure production config tests fail if the env is enabled.

### L2. Console logging should be reduced in production buy flow

Evidence:

- `BuyListingModal` logs `"Solana escrow tx:"`.

Recommendation:

- Route this through a debug logger or guard it behind development mode.

### L3. Feed metadata has confusing naming

Evidence:

- `createOrder` sets feed metadata `"price": order.TotalPrice` and `"currency": listing.PricePerGB`.

Recommendation:

- Rename metadata keys to `total_price_sol` and `price_per_gb_sol` after currency semantics are finalized.

## Recommended Execution Order

1. Fix order cancellation/refund/reconciliation.
   This is the highest-trust area because it involves user funds and session access. Prevent funded orders from becoming locally cancelled without an on-chain refund or dispute/settlement path.

2. Add durable escrow reconciliation.
   Orphan on-chain events and failed refunds need durable storage, retries, alerts, and an admin/operator view.

3. Normalize market pricing to SOL or lamports.
   Decide the canonical unit, migrate storage precision, update backend conversion logic, update comments/docs, and add precision tests.

4. Patch remaining marketplace dollar labels.
   Fix listing detail and saved listings, then add a regression test for SOL-only marketplace pricing.

5. Improve pending-payment UX.
   Preserve tx hash, give users a durable order status page, and provide a manual reconcile action when wallet payment succeeded but the watcher has not activated the order.

6. Add active listing routability checks.
   Block or mark unavailable any listing whose provider node cannot support gateway routing, geo trust, and session activation.

7. Reserve listing bandwidth atomically.
   Prevent overselling by reserving capacity on order creation and releasing it on unfunded cancellation/timeout.

8. Harden marketplace moderation for production.
   Enforce production config checks and improve visibility of moderation mode.

9. Sunset deprecated discovery routes.
   Move buyers and integrations fully to `/v1/listings` and `/v1/marketplace/map`.

10. Build marketplace ops dashboard.
    Track stuck escrows, pending refunds, order status counts, geo completeness, listing moderation backlog, routing readiness, and funnel conversion.

## Tests To Add

Backend:

- `cancelOrder` blocks active Solana escrow orders unless refund/settlement is initiated.
- `cancelOrder` does not mark `pending_payment` escrow orders cancelled when on-chain funds exist.
- Failed `escrow_cleaner` refund creates a retry/reconciliation record.
- Orphan escrow initialized event is persisted and later reconciled.
- Small SOL listing prices preserve lamport precision.
- Active listing without routable provider node is not purchasable.
- Listing moderation must be enabled in production config.
- Availability reservation is atomic under concurrent order creation.

Frontend/E2E:

- Listing detail uses `SOL/GB`, not `$`.
- Saved listings use `SOL/GB`, not `$`.
- Buy flow timeout after successful wallet submission shows pending-payment recovery, not a dead-end error.
- Order detail can fetch credentials after delayed activation.
- Marketplace map and provider nodes page consistently show ISP, city, and country.
- Marketplace map pin buy flow handles unavailable/unroutable listings.

Operational:

- Docker smoke: `GET /v1/marketplace/map?include_nodes=true` returns nodes/listings with geo fields populated.
- Docker smoke: create order, initiate escrow, activate via dev/test path, fetch credentials.
- Docker smoke: cancellation/refund path produces expected DB and on-chain state.

## Production Readiness Checklist

- Funded order cancellation cannot desynchronize DB and chain state.
- Escrow watcher is idempotent and reconcilable.
- Refund failures are durable and visible.
- SOL/lamport pricing semantics are canonical across DB, backend, frontend, docs, and tests.
- Active listings cannot oversell capacity.
- Active listings are only purchasable when provider routing is healthy.
- Credentials are only usable after escrow activation.
- Marketplace map has geo completeness metrics.
- Listing moderation is enforced in production.
- Deprecated discovery routes are either removed or explicitly legacy-gated.
- Operators have dashboards for pending review, stuck payment, refund failure, geo completeness, and funnel dropoff.

## Immediate Next Fix

The next best engineering move is to fix the order cancellation/refund/reconciliation path. It sits directly on the buyer trust and revenue path, and it protects the system from the worst class of marketplace failure: "the app says one thing, the chain says another."

After that, patch the remaining marketplace SOL labels and improve pending-payment recovery UX. Those are smaller changes, but they reduce buyer confusion immediately.
