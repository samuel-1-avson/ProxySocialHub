# Marketplace listing moderation (WS-C)

Human review gate for new seller listings before they appear on public discovery surfaces.

## Enable enforcement

Set on **control-api**:

```bash
MARKETPLACE_LISTING_MODERATION=enforce
```

Aliases: `strict`, `required`, `true`, `1`, `on`, `yes`.

When unset or any other value, new listings are created as `active` (legacy behaviour).

## Behaviour

| Surface | `pending_review` visibility |
|---------|----------------------------|
| Browse, search, featured, collections, facets, geo/map | Hidden (queries use `status = active` only) |
| Public `GET /v1/listings/:id` | 404 unless seller (optional auth) or moderator |
| Seller manage UI | Visible with **Under review** badge; price/content edit blocked |
| Orders / buy | Blocked (`active` required) |

### Transitions

- `pending_review` → `active` (approve)
- `pending_review` → `deleted` (reject)

## API

### Dashboard (Supabase user JWT, role `admin` | `moderator` | `superadmin`)

| Method | Path |
|--------|------|
| GET | `/v1/moderation/listings/pending` |
| POST | `/v1/moderation/listings/:id/approve` |
| POST | `/v1/moderation/listings/:id/reject` (optional JSON `{ "reason": "..." }`) |

### Admin JWT (`/v1/admin`, when `ADMIN_API_ENABLED=true`)

| Method | Path |
|--------|------|
| GET | `/v1/admin/listings/pending` |
| POST | `/v1/admin/listings/:id/approve` |
| POST | `/v1/admin/listings/:id/reject` |

Audit events: `admin.listing_approved`, `admin.listing_rejected`.

## Web UI

- **Moderators:** `/dashboard/admin` — pending queue with approve/reject
- **Sellers:** `/marketplace/manage` — under-review state

## Database

Migration `000095_listing_pending_review` adds partial index `idx_proxy_listings_pending_review` on `status = 'pending_review'`.
