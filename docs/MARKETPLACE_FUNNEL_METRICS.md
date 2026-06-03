# Marketplace funnel metrics (WS-D)

Schema version: **`marketplace.funnel.v1`**

Events are stored in `marketplace_funnel_events` (migration `000096_marketplace_funnel_events`).

## Event catalog

| Event | Source | Typical `surface` |
|-------|--------|-------------------|
| `listing_view` | Web client (`POST /v1/marketplace/funnel-events`) | `detail` |
| `listing_save` | Server (`POST /v1/listings/:id/save`) | `api` |
| `buy_modal_open` | Web client | `browse`, `detail`, `map`, … |
| `order_created` | Server (`POST /v1/orders`) | `order_api` |
| `escrow_initiated` | Server (`POST /v1/orders/:id/pay/solana`) | `api` |
| `escrow_confirmed` | Worker (Solana escrow initialized) | `escrow_worker` |
| `credentials_delivered` | Server (`GET /v1/orders/:id/credentials`) | `api` |

Payload columns: `user_id`, `listing_id`, `order_id`, `surface`, `meta` (JSON, no PII).

Client ingest accepts only `listing_view` and `buy_modal_open` to prevent spoofing of purchase events.

## Web instrumentation

```typescript
import { trackMarketplaceEvent, trackListingViewOnce } from '@/lib/analytics/marketplace-funnel';

trackListingViewOnce(listingId, 'detail', Boolean(user));
trackMarketplaceEvent('buy_modal_open', { listing_id, surface: 'browse' });
```

`BuyListingModal` accepts an optional `surface` prop and records `buy_modal_open` on mount.

## Example SQL (weekly funnel)

```sql
-- Unique listings viewed vs orders created (last 7 days)
WITH bounds AS (
  SELECT NOW() - INTERVAL '7 days' AS since
),
views AS (
  SELECT COUNT(DISTINCT listing_id) AS n
  FROM marketplace_funnel_events, bounds
  WHERE event_name = 'listing_view'
    AND created_at >= bounds.since
    AND listing_id IS NOT NULL
),
orders AS (
  SELECT COUNT(DISTINCT order_id) AS n
  FROM marketplace_funnel_events, bounds
  WHERE event_name = 'order_created'
    AND created_at >= bounds.since
    AND order_id IS NOT NULL
),
paid AS (
  SELECT COUNT(DISTINCT order_id) AS n
  FROM marketplace_funnel_events, bounds
  WHERE event_name = 'escrow_confirmed'
    AND created_at >= bounds.since
    AND order_id IS NOT NULL
),
creds AS (
  SELECT COUNT(DISTINCT order_id) AS n
  FROM marketplace_funnel_events, bounds
  WHERE event_name = 'credentials_delivered'
    AND created_at >= bounds.since
    AND order_id IS NOT NULL
)
SELECT
  views.n AS listings_viewed,
  orders.n AS orders_created,
  paid.n AS escrows_confirmed,
  creds.n AS credentials_delivered,
  ROUND(100.0 * orders.n / NULLIF(views.n, 0), 2) AS view_to_order_pct,
  ROUND(100.0 * paid.n / NULLIF(orders.n, 0), 2) AS order_to_paid_pct
FROM views, orders, paid, creds;
```

## Order-level conversion (single week)

```sql
SELECT
  DATE_TRUNC('day', created_at) AS day,
  event_name,
  COUNT(*) AS events,
  COUNT(DISTINCT order_id) FILTER (WHERE order_id IS NOT NULL) AS distinct_orders
FROM marketplace_funnel_events
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND event_name IN (
    'order_created',
    'escrow_initiated',
    'escrow_confirmed',
    'credentials_delivered'
  )
GROUP BY 1, 2
ORDER BY 1, 2;
```

## Deploy notes

1. Apply migration `000096_marketplace_funnel_events.up.sql`.
2. No env flag required; events always record when the table exists.
3. Failed inserts are logged at warn level and do not fail API requests.
