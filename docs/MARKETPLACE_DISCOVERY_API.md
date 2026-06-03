# Marketplace discovery API

**Canonical buyer discovery:** `GET /v1/listings` (public)  
**Legacy (deprecated):** `GET /v1/services` and related routes (authenticated)

## Why two surfaces existed

Historically, programmatic buyers used `/v1/services` with filters tied to `service_configurations` (protocol flags, bandwidth tiers, premium features). The web marketplace uses `/v1/listings` with a simpler filter set. Both queried `proxy_listings` but the service-discovery SQL joined `service_configurations` to the **listing id** instead of the linked **provider node** — incorrect for listings created after `provider_node_id` was introduced.

Phase 2 WS-A fixes the join and centralizes filters in `internal/marketplace/discovery`.

## Canonical: `GET /v1/listings`

| Query | Description |
|-------|-------------|
| `page`, `limit` | Pagination (page is **1-based**) |
| `proxy_type`, `protocol`, `rotation_type`, `country`, `isp` | Listing attributes |
| `min_price`, `max_price`, `min_rating` | Price and seller rating (≤5) or quality score (>5) |
| `min_quality_score`, `min_success_rate`, `min_uptime_percent` | Listing performance |
| `protocols` | Repeatable; filters via `service_configurations` (http, https, socks5, ssh) |
| `min_bandwidth_mbps` | Requires provider node + service configuration |
| `sort_by`, `sort_order` | See listings handler |

Response: `{ listings, total, page, limit }` (cached ~60s per filter set).

Also: `GET /v1/listings/search`, `GET /v1/listings/featured`, `GET /v1/listings/:id`.

### Catalog (Phase 2 WS-B)

| Route | Purpose | Cache |
|-------|---------|-------|
| `GET /v1/listings/facets` | `{ countries, proxy_types, isps, price_buckets }` for browse chips | `listings:facets:v1` (~10 min) |
| `GET /v1/listings/collections` | Summaries: `featured`, `verified`, `editors-pick` | `listings:collections:v1` (~5 min) |
| `GET /v1/listings/collections/:slug` | Paginated listings in a collection | Per slug/page |

Implementation: `internal/marketplace/collections/`, handlers in `internal/api/listings_catalog.go`.

## Pagination

Both surfaces use the shared `discovery.Offset` helper: **page 0** (legacy services) and **page 1** (listings) both return the first page; page 2+ uses 1-based offsets.

## Deprecated: `GET /v1/services`

Still available for existing integrations. Responses include HTTP headers:

- `Deprecation: true`
- `Link: </v1/listings>; rel="successor-version"`
- `Sunset: Mon, 01 Sep 2026 23:59:59 GMT`

| Legacy route | Replacement guidance |
|--------------|---------------------|
| `GET /v1/services` | `GET /v1/listings` + map query params (see below) |
| `GET /v1/services/filters` | Use `GET /v1/listings/facets` (Phase 2 WS-B) or listing query filters |
| `GET /v1/services/geo-coverage` | `GET /v1/marketplace/geo` / map APIs |
| `POST /v1/services/match` | `GET /v1/matching/recommend` or listings sort by quality |

### Parameter mapping (services → listings)

| `/v1/services` | `/v1/listings` |
|----------------|------------------|
| `target_countries` | `country` (single) or multiple via repeated `country` (future) |
| `max_price_per_gb` | `max_price` |
| `min_quality_score` | `min_quality_score` |
| `protocols` | `protocols` |
| `min_bandwidth_mbps` | `min_bandwidth_mbps` |
| `page` (0-based) | `page` (1-based) — **adjust clients** |

## Implementation

- Shared package: `services/control-api/internal/marketplace/discovery/`
- Repository browse: `db/marketplace_repository.go` → `discovery.Apply`
- Legacy handlers: `internal/api/service_discovery.go`

## New integrations

Do **not** build on `/v1/services`. Use `/v1/listings` and OpenAPI `Listings` tag only.
