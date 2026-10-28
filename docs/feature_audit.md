# ProxyHubb Feature Audit

Date: 2026-07-02

This audit groups the project into product-level feature areas based on the current Next.js app routes, navigation config, and `control-api` route registration. It counts user-facing and operator-facing capabilities, not every individual API endpoint.

## Summary

- Total feature areas identified: **43**
- Critical/core features: **10**
- Important product features: **16**
- Differentiators and growth features: **15**
- Low-priority, duplicate, stale, or removal candidates: **2**

Priority scale:

- **P0 - Core:** Required for the marketplace to work, revenue to flow, or funds/security to remain safe.
- **P1 - Important:** Strongly supports the core product and should be reliable before broader launch.
- **P2 - Enhance:** Valuable differentiators, retention features, or growth systems.
- **P3 - Remove/Deprioritize:** Duplicate, stale, legacy, dev-only, or not essential right now.

Action scale:

- **Fix:** Broken, risky, or blocking a core journey.
- **Improve:** Works or mostly exists, but should be made more usable, reliable, or complete.
- **Enhance:** Add polish, workflow depth, performance, automation, or analytics.
- **Remove/Merge:** Delete, hide, consolidate, or keep disabled until there is a clear owner.

## Feature Inventory And Ranking

| # | Feature area | Main surfaces | Priority | Recommended action | Notes |
|---:|---|---|---|---|---|
| 1 | Authentication and user session | Login, register, auth middleware, current user | P0 | Fix | Everything depends on accurate auth, role, wallet, and provider status propagation. |
| 2 | Wallet linking | Linked wallet APIs, wallet UI, auth context | P0 | Fix | Needed for deposits, withdrawals, provider ownership, and SOL flows. |
| 3 | Wallet balance, deposit, withdraw | `/dashboard/wallet`, wallet API, Solana routes | P0 | Fix | Recent logs showed withdraw failures and treasury funding issues. This is high-risk because it touches funds. |
| 4 | Marketplace browse and listing detail | `/marketplace`, `/marketplace/[id]`, listing routes | P0 | Improve | This is the main buyer entry point. Search, filtering, trust signals, and loading states should be first-class. |
| 5 | Orders, escrow, and payments | Marketplace orders, order detail, escrow, Solana pay | P0 | Fix | Core conversion path. Verify order status transitions, credentials, failed payments, refunds, and retry behavior. |
| 6 | Proxy sessions | `/dashboard/sessions`, session routes, streaming routes | P0 | Fix | This is the delivered product after purchase. Session create, terminate, credentials, and status streaming must be reliable. |
| 7 | Connect/proxy console | `/dashboard/proxy`, instant/from-listing sessions | P0 | Improve | Buyer workflow should make it obvious how to connect after purchase or lease activation. |
| 8 | Provider onboarding and approval | `/dashboard/become-provider`, provider apply/status/admin approve | P0 | Fix | Recent issue: approved provider modal/window persisted after refresh. Role/status state must refresh cleanly. |
| 9 | Provider nodes and health | Provider hub, nodes, health, diagnostics | P0 | Fix | Supply-side core. Needs accurate node health, ISP, country, city, online state, and diagnostics. |
| 10 | Security and audit | Security settings, API audit, anomalies, devices | P0 | Improve | Required before funds and provider credentials scale. Include audit logs, suspicious activity, and device/session controls. |
| 11 | Usage and billing | `/dashboard/usage`, usage routes, usage reviews | P1 | Improve | Important for buyer trust and billing clarity. Should reconcile session usage with orders and wallet debits. |
| 12 | Provider CLI and tokens | Provider CLI page, token routes, gateway token routes | P1 | Improve | Critical to provider activation, but can be iterated after onboarding is reliable. |
| 13 | Provider earnings and claims | Earnings dashboard, claim routes, payout admin | P1 | Fix | Must show pending, claimable, paid, failed, and retry states clearly. |
| 14 | Provider services configuration | Provider services APIs and UI | P1 | Improve | Providers need simple controls for plans, limits, and available proxy types. |
| 15 | Provider customer relationships | Provider relationships, buyer relationships | P1 | Improve | Useful for repeat buyers, disputes, retention, and communication. |
| 16 | Marketplace map and geo discovery | `/marketplace/map`, geo, topology APIs | P1 | Fix | User reported ISP and locations not working. Keep this high until geo data is verified end to end. |
| 17 | Listing creation and management | Create listing, manage listings, moderation | P1 | Improve | Necessary for provider supply. Needs clear validation and admin moderation path. |
| 18 | Catalog products and offers | Catalog products, seller product routes | P1 | Improve | Good abstraction for reusable products, but needs UX clarity so it does not duplicate listings. |
| 19 | Explorer overview and search | `/explorer`, search, public explorer API | P1 | Improve | Public trust surface. Should be fast, stable, and not depend on flaky replica configuration. |
| 20 | Explorer nodes, transactions, blocks, wallets, contracts | Explorer detail routes | P1 | Improve | Useful for transparency, but should be scoped to data that is actually accurate today. |
| 21 | Network analytics, health, leaderboards, earnings | Explorer analytics, health, leaderboard | P1 | Improve | Good public proof of network quality; avoid showing placeholder or stale metrics. |
| 22 | Treasury transparency | `/treasury`, treasury public routes | P1 | Improve | Important because wallet and escrow flows rely on treasury trust. |
| 23 | Governance proposals and voting | `/governance`, proposal create/detail, governance API | P1 | Improve | Valuable if token/community governance is active; otherwise keep simple and honest. |
| 24 | Trustless usage proofs and ZK reputation | `/dashboard/trustless`, ZK routes, reputation telemetry | P1 | Enhance | Differentiator. Needs clear explanation and measurable proof output, not just technical pages. |
| 25 | API keys and bulk access | Settings API keys, bulk proxy API | P1 | Improve | Important for power users and businesses. Add scopes, last-used metadata, rotation, and revocation clarity. |
| 26 | Admin operations | Admin dashboard, monitoring, moderation, payouts | P1 | Fix | Operators need reliable moderation, payout, onboarding, and health views. |
| 27 | Profiles and public provider showcases | Profiles, showcases, testimonials, speed tests | P2 | Enhance | Helps trust and conversion. Should be grounded in verified usage and performance data. |
| 28 | Reviews and reputation | Public/protected reviews, usage review eligibility | P2 | Improve | Valuable if guarded against fake reviews and tied to completed sessions/orders. |
| 29 | Notifications and preferences | Notifications settings and routes | P2 | Improve | Useful for provider approvals, payouts, disputes, sessions, and security events. |
| 30 | Messaging and friends | Community messages, messaging routes, friend routes | P2 | Improve | Keep if it directly supports buyer-provider coordination. Avoid becoming a general chat product. |
| 31 | Community feed | `/community/feed`, feed routes | P2 | Remove/Merge | Likely overlaps with forum and social features. Keep only if it has a clear growth purpose. |
| 32 | Forum | `/community/forum`, forum protected/public routes | P2 | Enhance | Better long-term support/community surface than a generic feed. |
| 33 | Agent marketplace and rentals | Rent agents, my agents, agent public/protected routes | P2 | Enhance | Interesting differentiator, but should not block proxy marketplace stability. |
| 34 | Agent registry and verified outputs | Agent registry routes, output verification | P2 | Enhance | Useful if agents become a serious product line; otherwise keep behind a feature flag. |
| 35 | Provider circle and enterprise pools | Circle pool routes, provider circle page | P2 | Enhance | Strong enterprise concept, but probably after core provider supply is stable. |
| 36 | Staking | Node stake, PHB stake/unstake | P2 | Improve | Financially sensitive. Should be audited or disabled until token economics are finalized. |
| 37 | Referrals, subscriptions, and milestones | Referral, subscription, milestone routes | P2 | Enhance | Growth and retention systems. Sequence after conversion and fulfillment are dependable. |
| 38 | Beta program | Beta public/protected routes, beta page | P2 | Remove/Merge | Useful during launch, but should be hidden or merged once the beta phase ends. |
| 39 | SDK examples and code generation | SDK routes, examples, language/download APIs | P2 | Enhance | Good developer growth surface. Needs examples that match current API auth and session flows. |
| 40 | KYC, GDPR, and compliance controls | KYC routes, GDPR routes | P2 | Fix | Compliance features should be complete, testable, and intentionally surfaced where needed. |
| 41 | Smart matching and service discovery | Smart matching routes, service discovery routes | P2 | Enhance | Good automation layer after listings, geo, node health, and inventory data are trustworthy. |
| 42 | Legacy dashboard duplicates | `/dashboard/feed`, `/dashboard/messages`, `/dashboard/security`, `/leaderboards` | P3 | Remove/Merge | Navigation marks several as legacy. Consolidate with community/forum, settings/security, and explorer leaderboard. |
| 43 | Stale or unregistered backend modules | Saved searches, teams, pricing, seller tiers candidates | P3 | Remove/Merge | Verify ownership. If not registered, tested, or visible in nav, delete or feature-flag to reduce maintenance noise. |

## Most Important Features To Stabilize First

1. **Wallet and SOL flows:** deposits, withdraws, linked wallet status, treasury funding, transaction retry, and error recovery.
2. **Order to session fulfillment:** buyer places order, payment confirms, credentials are available, session starts, and usage is recorded.
3. **Provider onboarding and node health:** approval state, provider role refresh, node registration, ISP, country, city, and health checks.
4. **Marketplace browse/detail/create:** buyers can find real supply and providers can list usable services.
5. **Security and audit:** session/device management, API key safety, admin audit visibility, and anomaly handling.
6. **Admin operations:** provider approval, listing moderation, payout review, and operational monitoring.

## Features To Fix

- Wallet withdrawal/deposit failure handling and treasury SOL preflight checks.
- Provider approval state persistence after refresh.
- Provider node ISP and location display across onboarding, health, marketplace map, and explorer nodes.
- Marketplace order status transitions, especially failed, paid, active, canceled, refunded, and credential-ready states.
- Proxy session lifecycle: creation, stream updates, termination, and stale session cleanup.
- Dashboard chart containers that can render with invalid dimensions.
- Read-replica and database fallback behavior for explorer and public analytics.
- Security and audit flows: 2FA, devices, API keys, audit logs, and anomaly resolution.

## Features To Improve

- Marketplace search, filtering, sorting, and trust badges.
- Listing creation UX with validation, preview, and moderation status.
- Provider setup checklist from approval to first healthy node.
- Provider earnings UI with pending, claimable, paid, failed, and retry states.
- Wallet UI with clearer transaction history, pending state, and treasury error messaging.
- Explorer pages with real data freshness indicators.
- API key management with scoped keys, rotation, last-used timestamps, and clear danger states.
- Notifications for approval, security, order, session, payout, and dispute events.

## Features To Enhance Later

- Trustless usage proofs and ZK reputation as a public trust differentiator.
- Agent rentals and verified agent outputs, ideally behind feature flags until stable.
- Provider circles and enterprise pools for higher-value customers.
- SDK examples and generated code once API contracts settle.
- Referrals, subscriptions, milestones, and beta program once core conversion works.
- Smart matching after supply inventory, geo data, pricing, and health are reliable.

## Features To Remove, Hide, Or Merge

- Merge legacy dashboard feed/messages/security pages into the community forum, messaging, and settings/security surfaces.
- Remove or feature-flag stale backend modules if they are not registered, tested, or planned: saved searches, teams, pricing, and seller tiers are candidates to verify.
- Remove or restrict dev-only operational shortcuts such as development activation routes before production use.
- Hide beta-program surfaces once the product exits beta.
- Keep agent and circle features behind flags if they distract from marketplace, session, wallet, and provider reliability.
- Consolidate duplicate leaderboard surfaces into explorer leaderboard or community reputation, not both.

## Recommended Execution Order

| Phase | Goal | Features |
|---|---|---|
| 1 | Make the marketplace actually transact safely | Auth, wallet, linked wallet, orders, escrow/payments, sessions, connect console |
| 2 | Make supply trustworthy | Provider onboarding, provider nodes, ISP/location, health, provider CLI/tokens, services |
| 3 | Make operations manageable | Admin approval, moderation, payouts, monitoring, audit, security |
| 4 | Make discovery and trust better | Marketplace search, map, reviews, profiles, showcases, explorer, treasury |
| 5 | Add differentiators | Trustless proofs, governance, agents, circles, staking, SDKs, referrals |
| 6 | Reduce surface area | Remove legacy routes, stale modules, duplicate pages, and hidden dev-only flows |

## Practical Next Fix

The best next fix is **provider node ISP/location reliability**, because the user-facing issue is active and it affects provider setup, marketplace map trust, explorer nodes, and public discovery. After that, the next highest-value fix is **wallet/order/session fulfillment**, because it is the revenue path and currently has the highest risk when failures occur.
