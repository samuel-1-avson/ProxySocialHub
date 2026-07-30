# Marketplace Phase 3C status (growth & platform)

**Last updated:** 2026-07-30  
**Epic:** [#8](https://github.com/samuel-1-avson/ProxySocialHub/issues/8)

## Track 3C workstreams

| WS | Issue | Status | Evidence |
|----|-------|--------|----------|
| **3C-1** Buyer subscription SKUs | [#30](https://github.com/samuel-1-avson/ProxySocialHub/issues/30) | **Done** | `000107`, [BUYER_SUBSCRIPTION_PLANS.md](../BUYER_SUBSCRIPTION_PLANS.md), wallet-SOL purchase + entitlements |
| **3C-2** B2B API keys for purchase | [#31](https://github.com/samuel-1-avson/ProxySocialHub/issues/31) | **Done** | `orders:create`, [B2B_SANDBOX_PURCHASE.md](../B2B_SANDBOX_PURCHASE.md) |
| **3C-3** Agents IA `/agents` | [#32](https://github.com/samuel-1-avson/ProxySocialHub/issues/32) | **Done** | Canonical `/agents` + redirects; marketplace E2E smoke |
| **3C-4** Funnel analytics | [#33](https://github.com/samuel-1-avson/ProxySocialHub/issues/33) | **Done** | Admin/seller dashboards on `marketplace_funnel_events` |

## Notes

- Subscription SKUs are **provisional** (product may retune prices via SQL).
- Sandbox buy remains gated by `PROXYHUB_ALLOW_DEV_ESCROW_ACTIVATE` (off on GCP testnet by default).
- Stripe remains deferred; billing is wallet-SOL.
