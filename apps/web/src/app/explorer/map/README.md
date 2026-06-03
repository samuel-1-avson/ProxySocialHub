# Explorer map (`/explorer/map`)

Production files in this folder:

| File | Role |
|------|------|
| `page.tsx` | Explorer node map page (2D + 3D) |
| `GlobeMap.tsx` | Three.js globe for provider nodes |
| `LeafletMap.tsx` | Re-export of `@/components/map/ProxyMapCanvas` |
| `README.md` | This note |

Shared map engine: `@/components/map/ProxyMapCanvas.tsx` (also used by `/marketplace/map`).

## Data sources

- **Nodes (globe or 2D without listings):** `GET /v1/explorer/nodes/geo` + `WS /v1/explorer/ws` (`node_update`)
- **2D with listings layer:** single `GET /v1/marketplace/map?include_nodes=true` (nodes + listings, optional `bbox`) — skips duplicate geo fetch
- **Listings only on 2D:** proof fields via `ListingSlaBadge`; bbox uses “Search this area”
- **Buy in-map:** `NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=true` → `BuyListingModal` on purchasable pins

Canonical purchase UX remains `/marketplace/map`.
