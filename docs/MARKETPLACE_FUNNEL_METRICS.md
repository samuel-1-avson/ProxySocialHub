# Marketplace funnel metrics

Phase 2 ingest stores append-only conversion events in `marketplace_funnel_events`
(schema `marketplace.funnel.v1`). Phase 3C-4 (#33) exposes dashboards on those events.

## Event names

| Step | Source |
|------|--------|
| `listing_view` | Client ingest (`POST /v1/marketplace/funnel-events`) |
| `buy_modal_open` | Client ingest |
| `listing_save` | control-api listings handler |
| `order_created` | control-api orders handler |
| `escrow_initiated` | control-api orders handler |
| `escrow_confirmed` | escrow worker |
| `credentials_delivered` | control-api orders handler |

## Dashboard APIs

| Audience | Endpoint | Auth |
|----------|----------|------|
| Admin / moderator | `GET /v1/moderation/marketplace/funnel` | JWT + platform moderator |
| Seller (provider) | `GET /v1/analytics/marketplace/funnel` | JWT + provider role; forced `seller_id` scope |

### Query parameters

- `from`, `to` — inclusive `YYYY-MM-DD` (default last 30 days)
- `collection` — `featured` \| `verified` \| `editors-pick` (current listing membership via join)
- `country` — case-insensitive `proxy_listings.country`

Collection and country filters **join** `proxy_listings`. Events without `listing_id` are excluded when those filters (or seller scope) apply. Membership uses **current** listing state, not an event-time snapshot.

### Response

Step counts for the ordered funnel, conversion ratios (`view_to_order`,
`order_to_escrow_confirmed`, `view_to_escrow_confirmed`), and distinct `countries`
seen in the window (for filter UI).

## UI

- Admin: `/dashboard/admin` → **Funnel** tab
- Seller: `/dashboard/provider/analytics` → Marketplace funnel section
