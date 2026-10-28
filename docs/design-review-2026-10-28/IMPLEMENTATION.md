# ProxyHubb frontend rebuild — implementation milestone 1

Date: 28 October 2026. This records the first working source implementation of the approved v2 concept. It is not a claim that all 100 legacy page files or all 49 feature areas have been migrated.

The next source implementation phase is recorded in [Seller workflows](IMPLEMENTATION-SELLER-WORKFLOWS.md): node setup/configuration, scoped credentials, offer creation/management and earnings/payout controls now have redesigned operational screens.

## Delivered

The production web source now uses the new workspace shell: a restrained slate design, semantic light/dark colors, persistent Light/Dark/System selection, four primary destinations per workspace, a compact header, keyboard destination search, and mobile bottom navigation. Account utilities and workspace switching remain accessible on small screens. Existing server and client authorization rules continue to enforce provider capabilities; choosing a workspace cannot grant a role.

| Buyer destination | Source route | Connected behavior |
|---|---|---|
| Overview | `/app` | Real orders, reported usage/cost, next step, recent activity |
| Marketplace | `/marketplace` | API inventory, URL filters, facets, catalog context, saves, comparison, offer review and escrow checkout |
| Connections | `/app/connections` | Purchased access, credentials on the original order, session history, extension handoff and advanced integration entry |
| Activity | `/app/activity` | Orders, measured daily usage, subscription/billing context and order receipts |

| Seller destination | Source route | Connected behavior |
|---|---|---|
| Overview | `/provider` | Actual readiness checks, nodes and earnings summaries |
| Nodes | `/provider/nodes` | Owned inventory, heartbeat verification, reported latency, inspection and setup/configuration entry points |
| Listings | `/provider/listings` | Owned offers, catalog products and existing create/edit controls |
| Earnings | `/provider/earnings` | Reported earned/pending/paid amounts, payout history and transaction evidence |

The original `/dashboard` entry now shows the appropriate redesigned overview. `/marketplace/saved` opens the consolidated saved view. New order detail URLs under Connections and Activity share a single receipt/credentials component. Old operational routes remain reachable while their deeper interactions are migrated.

## Purchase and wallet behavior

Offer details lead to review, wallet escrow funding, then the purchased order's connection instructions. Existing Solana escrow checks and server provisioning APIs remain in place. The checkout identifies the funding action explicitly and removes unconditional “Verified” and “Ready” claims. A failed confirmation retains the created order ID; retrying in the same checkout rechecks that order instead of creating a second one. The error offers a direct link to review that existing order. Cross-tab or reopened-checkout idempotency still depends on backend order/payment guarantees.

Mock-buy environment and browser flags are disabled in production code. Returning to connection instructions requires a nonempty endpoint, username and password from the authenticated order API.

An active order, returned credentials, and observed client traffic are presented as separate states. Provider-signed offers are distinguished from measured node health. Unknown ratings/latency and unavailable aggregates do not get invented defaults. Platform balance, wallet funds, escrow, provider earnings and public treasury remain distinct.

Mobile regression testing exposed an existing reconnect bug: the app selected an uninstalled but loadable Solflare adapter, which could open a blocking iframe. Restoration now only targets a previously selected installed adapter through its silent `autoConnect` path. Explicit connection remains a user action. Solflare also receives the configured Solana network rather than its default network.

## Independent public explorer

`apps/explorer` is a separately installable/buildable Next.js application, intended for `explorer.proxyhubb.com`. Its package does not import the authenticated workspace, wallet adapters, signing libraries, or private session clients. It shares CSS tokens and layout patterns through `packages/design-system`.

Five primary destinations are implemented: Overview, Nodes, Ledger, Analytics, and Governance. Nested views include transaction/block lists and details, public wallet/program lookup, node detail, source health/writer evidence, proposals, proposal detail and treasury. Proposal creation and participation deliberately hand off to existing authenticated workspace screens.

The GET-only public adapter permits a fixed resource set, validates public identifiers, bounds pagination, omits incoming authorization/cookies, and projects allowed scalar fields. It excludes raw payloads, private provider/account identity, proxy credentials and platform ledger balances. Unavailable treasury observations cannot be presented as a reported zero. It does not expose private sessions or provider earnings.

Set build-time `NEXT_PUBLIC_EXPLORER_URL` in `apps/web` when the separate service is available. Until then, main-app links retain their existing `/explorer` compatibility destinations. Set explorer's `NEXT_PUBLIC_APP_URL` for workspace handoffs and server-only `API_URL` for its public backend source. See `apps/explorer/README.md` and each app's `.env.example`.

No production deployment, domain purchase, DNS change, or certificate setup was performed.

## Verification

| Check | Result |
|---|---|
| Main application production build, including TypeScript | Passed; 100 prerendered pages generated |
| Explorer independent production build, including TypeScript | Passed |
| Targeted Chromium browser suite | 11 passed |
| Explorer public data boundary tests | 7 passed |
| Production explorer HTTP boundary checks | Unknown resources and invalid identifiers rejected with 400; unsupported writes rejected with 405; unknown routes return 404 |
| Route registry, navigation keys and policy guard coverage | Passed |
| Listing display, order status and provider configuration contracts | Passed |
| ESLint on new workspace components, routes, navigation and changed shared shell/receipt components | Passed with no warnings |
| Tracked diff whitespace check | Passed |

The browser suite covers the four-destination buyer/seller switch, theme persistence and System mode, a 320px viewport without page overflow, mobile account utilities, provider access denial, anonymous sign-in redirect, offer review, a mocked escrow-confirmation flow, retry without a duplicate order, catalog context, country filtering, credentials and extension handoff.

Browser purchase/extension checks use local API and extension fixtures. No real wallet transaction, live payment, production node provisioning or real extension installation was performed. The local control API at port 18080 was offline during this milestone, so the production previews show unavailable network data. Tests prove UI/API wiring against fixtures; live backend and devnet integration remain release checks. Firefox, Safari and a full accessibility audit have not been run for this milestone.

Captured buyer and seller screenshots in `build-screenshots/` come from the actual source application with test API data. Development diagnostics visible in those captures are not part of the production UI.

## Remaining migration work

1. Redesign the deeper seller setup/configuration, offer creation/editing, payout operations, wallet and settings screens in place. Their existing controls are preserved and reachable from the new hierarchy.
2. Complete connection lifecycle actions and recovery around pending payment/provisioning, session termination/rotation and dispute/settlement. Retire duplicate legacy pages only after their controls and recovery states have an equivalent destination.
3. Extend Explorer with the regional map, node comparison/rankings, richer measurement periods/health history and governance execution evidence. These legacy capabilities have not all been moved into the separate app. Do not remove the legacy Explorer until this coverage is complete.
4. Complete the remaining feature and route dispositions in `FEATURE-COVERAGE.csv` and `route-disposition-v2.csv`, including public landing/onboarding and secondary community/support screens. Existing speculative legacy finance/DePIN surfaces still require the audit's credibility cleanup before any broader release.
5. Run live backend/devnet and real extension checks, cross-browser and keyboard/screen-reader checks, and a final mobile pass on populated long records. Then deploy the explorer separately, configure reciprocal origins, and activate validated redirects.

## Local review

Main production preview: `http://127.0.0.1:4011/marketplace`. Private destinations start at `/app` or `/provider` and need the existing authenticated backend. Explorer production preview: `http://127.0.0.1:4012`.

To rebuild, run `npm run build` inside each app. To develop, run the main app's `npm run dev:e2e` (webpack on port 4011) and explorer's `npm run dev` (port 4012), with your existing API and wallet environment configured. Keep test-only auth/payment flags confined to the established Playwright workflow.
