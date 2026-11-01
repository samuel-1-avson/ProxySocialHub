# Explorer and Docs implementation plan

This closes the separate public-application work identified in the 1 November screenshots. The main workspace has its own release and acceptance record.

| Order | Work package | Status | Acceptance evidence |
|---|---|---|---|
| 1 | Audit deployed artifacts, every public route family, shared tokens, navigation, and mobile reading surfaces | Complete | Report findings and route inventory below |
| 2 | Share brand, fonts, palette, theme icon, links, focus states, and responsive header conventions | Complete | Shared public stylesheet, local font assets, both app shells |
| 3 | Transform Explorer overview, nodes/map, ledger/detail, analytics, governance/treasury, lookup, health, About, and failure states | Complete | 17 URL variants plus unavailable-source and missing-route checks |
| 4 | Transform Docs home and all article templates, menu/search, contents, code/table/callout surfaces, and API viewer | Complete | All 33 indexed content routes; single API viewer before/after theme switching |
| 5 | Fix build blockers and verify optimized builds, contracts, interactions, accessibility, layout, and visual composition | Complete | 312 passing observations, 84 passing axe scans, 16 browser tests, 10 contract tests |
| 6 | Build and release separate revision-labeled production images with health gates and rollback | Complete | Successful GCP builds c056428d-ebb6-4739-9650-d9e5588ccde8 and 3e572f18-d247-462f-8db3-1de9b0c5b030; both final health gates passed |
| 7 | Verify actual published domains, capture runtime/build identity and screenshots, publish completion evidence | Complete | 64 live page observations, 44 axe scans, 33 Docs route reads, 320px interactions, runtime/build receipts, and four production previews |
| 8 | Human keyboard/screen-reader and 200% zoom acceptance | Follow-up | Product acceptance on the published sites |

## Explorer route coverage

Every listed configuration passed local route, theme, and overflow checks at 390px, 1024px, and 1440px in both themes. Public record identifiers in these checks are controlled fixtures.

| Route/configuration | Surface |
|---|---|
| `/` | Network overview and source health |
| `/nodes` | Node directory and filters |
| `/nodes?view=map` | Geographic node view |
| `/transactions` | Transaction ledger |
| `/blocks` | Block ledger |
| `/analytics` | Network analytics |
| `/health` | Network/source health |
| `/governance` | Proposal overview |
| `/governance/treasury` | Treasury evidence |
| `/search?type=wallets` | Typed record lookup |
| `/about` | Protocol overview |
| `/nodes/:id` | Node detail |
| `/transactions/:hash` | Transaction detail |
| `/blocks/:number` | Block detail |
| `/wallets/:address` | Public wallet detail |
| `/contracts/:address` | Public contract detail |
| `/governance/:id` | Proposal detail |

Five representative configurations also passed unavailable-source checks on mobile dark and desktop light; the branded missing-route page passed its expected 404 and accessibility checks.

## Docs page coverage

Each page below receives the redesigned shared shell and article components. Every page passed local rendering, theme, and overflow checks at all three widths in both themes. Six representative templates additionally received axe scans at every width/theme combination. API functionality, mobile contents, search, and code-copy behavior have dedicated interaction checks.

| Route | Page | Local coverage |
|---|---|---|
| `/docs/api` | API reference | Pass |
| `/docs/architecture` | Architecture | Pass |
| `/docs/buyer/connect` | Connect session intents | Pass |
| `/docs/buyer/credentials` | Order credentials | Pass |
| `/docs/buyer/pools` | Bulk pools | Pass |
| `/docs/buyer/proxy` | Buyer proxy protocol | Pass |
| `/docs/changelog` | Changelog and versions | Pass |
| `/docs/concepts/access-paths` | Access paths | Pass |
| `/docs/concepts/escrow` | Escrow and orders | Pass |
| `/docs/concepts` | Concepts | Pass |
| `/docs/concepts/metering` | Metering and settlement | Pass |
| `/docs/getting-started` | Getting started | Pass |
| `/docs/glossary` | Glossary | Pass |
| `/docs/how-it-works` | How it works | Pass |
| `/docs` | Documentation | Pass |
| `/docs/marketplace/b2b` | B2B sandbox purchase | Pass |
| `/docs/marketplace/discovery` | Discovery API | Pass |
| `/docs/marketplace` | Marketplace overview | Pass |
| `/docs/marketplace/orders` | Orders and escrow | Pass |
| `/docs/marketplace/subscriptions` | Access Passes | Pass |
| `/docs/provider/app` | Provider app (preview) | Pass |
| `/docs/provider/cli` | Provider CLI | Pass |
| `/docs/provider/nodes` | Provider nodes | Pass |
| `/docs/quickstart/buyer` | Buyer quickstart (5 min) | Pass |
| `/docs/quickstart/provider` | Provider quickstart (10 min) | Pass |
| `/docs/sdks/go` | Go SDK | Pass |
| `/docs/sdks` | Official SDKs | Pass |
| `/docs/sdks/nodejs` | Node.js SDK | Pass |
| `/docs/sdks/python` | Python SDK | Pass |
| `/docs/troubleshooting` | Troubleshooting | Pass |
| `/docs/wallet/auth` | Wallet authentication | Pass |
| `/docs/wallet/deposit-withdraw` | Deposit and withdraw | Pass |
| `/docs/whitepaper` | Protocol architecture draft | Pass |

See the [audit and completion report](./PUBLIC_FRONTENDS_REDESIGN_REPORT_2026-11-01.md) for implementation details, validation limits, and production evidence.
