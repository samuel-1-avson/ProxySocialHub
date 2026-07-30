# Buyer subscription plans (#30)

Wallet-SOL SaaS plans for marketplace sellers/buyers. Stripe is **deferred**;
billing uses deposited SOL via `POST /v1/wallet/deposit/crypto` then
`POST /v1/subscriptions`.

Provisional SKUs (retune with SQL — no code change required):

| SKU (`name`) | Monthly USD | Yearly USD | Listings | Bandwidth GB / period | Notes |
|--------------|-------------|------------|----------|------------------------|-------|
| `free` | 0 | 0 | 2 | 10 | Seeded by `000051` |
| `pro` | 29 | 290 | 25 | 200 | Seeded by `000107` |
| `scale` | 99 | 990 | unlimited (`0`) | unlimited (`NULL`) | Seeded by `000107` |

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/v1/subscriptions/plans` | JWT |
| GET | `/v1/subscriptions/my` | JWT |
| POST | `/v1/subscriptions` | JWT — body `{ plan_id, billing_cycle }` |
| PUT | `/v1/subscriptions` | JWT — change plan (prorated) |
| DELETE | `/v1/subscriptions` | JWT — cancel; access until `current_period_end` |

## Entitlements (server-side)

| Limit | Enforced at |
|-------|-------------|
| Listings | `POST` create listing (`CheckSubscriptionLimits("listings")`) |
| Bandwidth (buyer) | `POST /v1/orders` + session create (`EnsureBuyerBandwidthQuota` / `computeBandwidthLimitForUser`) |
| Teams | create team (`CheckSubscriptionLimits("teams")`) |
| API access flag | `CheckSubscriptionLimits("api_access")` |

Cancelled subscriptions keep entitlements until `current_period_end`.

## Ops

Apply migration `000107_user_subscriptions_paid_plans`. Enable sandbox/partner
testing only after pricing sign-off if amounts must change.
