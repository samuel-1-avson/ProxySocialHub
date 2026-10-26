# Map geo operations runbook

Operator guide for keeping map pins accurate across `/network`, `/marketplace/map`, and `/explorer/map`.

## Architecture (short)

1. **Provider registration** — `provider_nodes` get IP/country/city; `scheduleNodeGeoEnrich` runs GeoIP.
2. **Explorer writeback** — `geoip.EnrichExplorerForProviderNode` updates `explorer_nodes` lat/lon, country, `geo_source`, `geo_resolved_at`.
3. **Map API** — `GET /v1/marketplace/map` (and alias `GET /v1/map/points`) applies `geo.ApplyMapCoords` so every point has `lat`, `lon`, `geo_source`, and nested `geo.display_label`.
4. **Clients** — Web maps use `useMapPoints` with **real** `GET /v1/marketplace/map` data; they must **not** re-snap coordinates client-side or inject synthetic pins.
5. **Map tiles** — Product 2D maps use **Google Maps JavaScript API** (`ProxyMapCanvas`). Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Maps JavaScript API enabled; Visualization library optional for heatmap).

See [MARKETPLACE_DISCOVERY_API.md](./MARKETPLACE_DISCOVERY_API.md) for query parameters.

## Health checks

### `GET /v1/system/map/health`

Public endpoint. Returns:

| Section | Fields | Meaning |
|---------|--------|---------|
| `explorer_nodes` | `total`, `active`, `with_nonzero_coords`, `zero_coords`, `zero_coords_pct` | Nodes still at (0,0) need enrich/backfill |
| `listings` | `active`, `purchasable`, `with_country`, `with_explorer_coords`, `without_resolvable_geo` | Active listings missing country **and** explorer coords |
| `regional_hubs` | `countries`, `hubs` | Static hub table loaded in API |

**Healthy staging/dev:** `zero_coords_pct` trending down after backfill; `without_resolvable_geo` near zero for active listings.

Example:

```bash
curl -s http://localhost:8080/v1/system/map/health | jq .
```

## GeoIP enrich & backfill

### Automatic path

New or updated provider nodes trigger background GeoIP via the control-api indexer/enrich hooks. Persisted fields on `explorer_nodes`:

- `geo_source` — e.g. `geoip`, `city_centroid`, `country_centroid`
- `geo_resolved_at` — UTC timestamp of last successful resolve

Migration: `000098_explorer_node_geo_source`.

### Manual backfill (dev / recovery)

`POST /v1/system/geoip/backfill` is available when `APP_ENV` is empty or `development`. It:

1. Re-enriches up to 45 provider nodes (~1.4s each, ip-api rate limits).
2. Runs up to 10 batches of `ResolveNextBatch()` for pending explorer nodes.
3. Invalidates marketplace read-model caches.

Returns `202 Accepted` immediately; watch control-api logs for `[GeoIP]` lines.

```bash
curl -X POST http://localhost:8080/v1/system/geoip/backfill
```

For production recovery, run an equivalent job from an admin context or temporarily enable the route in a controlled deploy (not enabled by default in prod).

## `geo_source` values (UI + API)

| Value | Typical meaning |
|-------|-----------------|
| `geoip` / `explorer` | Coordinates from GeoIP or stored explorer node |
| `region_hub` | Snapped to a regional hub (country + region) |
| `city_centroid` | City-level centroid |
| `country_centroid` | Country centroid when only country is known |
| `unknown` | No resolvable location; pin may be hidden or at fallback |

Popups show `geo.display_label` and estimated badges via `geo-labels.ts` on the web app.

## Troubleshooting

### Pins missing on map

1. Call `GET /v1/system/map/health` — check `zero_coords` and `without_resolvable_geo`.
2. Confirm listing is `active` and (for marketplace default) `purchasable_only` filters.
3. For explorer infra view, ensure `include_nodes=true` and node is `active` if `active_nodes_only` is set.
4. Run dev backfill if nodes are new.

### Pins in wrong country

1. Verify `provider_nodes.country` / `city` and listing `country`.
2. Check `geo_source` on the map point — centroids are intentional when IP is missing.
3. Re-run enrich after correcting provider metadata.

### Stale coordinates after deploy

- Marketplace map responses are cached in Redis (`marketplace:geo:*`, map query keys). Backfill calls `invalidateMarketplaceReadModels()`.
- Bounce Redis or wait for TTL if pins look stale after a bulk DB fix.

### Legacy clients on `GET /v1/listings/geo`

Deprecated. Responses include `Deprecation: true` and `Link: </v1/marketplace/map>; rel="successor-version"`. Migrate to `/v1/marketplace/map` or `/v1/map/points`.

## Related docs

- [adr/0007-map-network-topology-visualization.md](./adr/0007-map-network-topology-visualization.md) — topology arcs (Phase 5)
- [EXPLORER_VERIFICATION.md](./EXPLORER_VERIFICATION.md) — explorer/map verification
- [apps/web/README.md](../apps/web/README.md) — map UI components and E2E
- [PROVIDER_NODE_OPERATIONS.md](./PROVIDER_NODE_OPERATIONS.md) — provider node lifecycle
