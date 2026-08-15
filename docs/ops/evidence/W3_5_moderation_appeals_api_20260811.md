# W3.5 — Listing moderation appeals (APIs)

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Result | `DISC01_MODERATION_APPEALS_API` |
| ADR | [0008](../../adr/0008-moderation-appeals.md) |

## What landed

1. Statuses: `delisted`, `under_appeal` (+ FSM transitions).
2. Migration `000145_listing_moderation_appeals`.
3. Reject pending → **`delisted`** (not immediate `deleted`).
4. Moderator `POST .../delist` for active/paused/sold_out.
5. Seller `POST /v1/listings/:id/appeal`, `GET .../appeals`, `GET /v1/appeals/mine`.
6. Moderator `GET /v1/moderation/appeals`, `POST /v1/moderation/appeals/:id/resolve` (`uphold` \| `deny`).
7. Admin JWT group also gets appeal resolve under `/v1/admin/listings/appeals`.
8. `PROXYHUB_LISTING_APPEAL_DAYS` (default 7).

## Non-claims

- Not full decentralized jury voting on delists yet (moderator resolve ships first; jury reuse is follow-up)
- Browse still Postgres; appeals reduce silent erase, do not remove platform authority
- Offer hash preserved on appeal row for indexers
