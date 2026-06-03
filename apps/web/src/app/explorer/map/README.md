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

- **Nodes:** `GET /v1/explorer/nodes/geo` + `WS /v1/explorer/ws` (`node_update`)
- **Listings layer (2D):** `GET /v1/marketplace/map` via `getMarketplaceMapPoints` (proof fields, optional bbox)
- **Buy in-map:** `NEXT_PUBLIC_EXPLORER_MAP_BUY_ENABLED=true` → `BuyListingModal` on purchasable pins

Canonical purchase UX remains `/marketplace/map`.
