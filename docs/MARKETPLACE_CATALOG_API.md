# Marketplace catalog API (Phase 3A / #10)

Base path: `/v1/catalog` (optional auth on reads; auth required for mutations).

## Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/catalog/products/my` | Required | Paginated seller products (`page`, `limit`) |
| GET | `/catalog/products/:id` | Optional | Product + offers; draft/archived only for owner |
| GET | `/catalog/sellers/:seller_id/products/:slug` | Public | Active product by seller slug |
| POST | `/catalog/products` | Required | Create product |
| PATCH | `/catalog/products/:id` | Required | Update product |

### Create body

```json
{
  "title": "Premium US Pool",
  "description": "Optional copy",
  "slug": "optional-custom-slug",
  "media": [],
  "status": "draft"
}
```

`status`: `draft` | `active` | `archived` (default `draft`).

## Offers (listing linkage)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/catalog/products/:id/offers` | Required | Link seller-owned listing |
| DELETE | `/catalog/products/:id/offers/:offer_id` | Required | Unlink offer (listing unchanged) |

### Link body

```json
{
  "listing_id": "uuid",
  "sku": "optional",
  "display_name": "optional",
  "is_primary": true,
  "sort_order": 0
}
```

## Errors

| HTTP | Condition |
|------|-----------|
| 401 | Missing auth on protected routes |
| 403 | Listing not owned or already linked elsewhere |
| 404 | Product/offer not found (includes hidden draft for non-owner) |
| 409 | Slug taken for seller |

## Discovery embed (#11)

On listing endpoints, pass `?include=product` to attach `catalog_product` without a second request. See [MARKETPLACE_DISCOVERY_API.md](./MARKETPLACE_DISCOVERY_API.md).

## Related

- [adr/0005-marketplace-catalog-layer.md](./adr/0005-marketplace-catalog-layer.md)
- [reports/PHASE_IMPLEMENTATION_STATUS.md](./reports/PHASE_IMPLEMENTATION_STATUS.md)
- [adr/0005-marketplace-catalog-layer.md](./adr/0005-marketplace-catalog-layer.md)
