# Frontend live-data integration

Updated: 2026-10-29. Scope: the buyer/seller workspace, marketplace maps and independent Explorer. This change preserves the shared design architecture and the other frontend team's redesign. It does not add local Docker infrastructure or change the backend settlement system.

Current deployment: web source `a9f81bc1a444fc1866e0041f9756ea93b67b8b9b` and Explorer source `397e4d8c6a7836305f860693489648dacb14755c`, both healthy. Explorer's application tree is unchanged in the newer main revision. The final frontend trees match `main`; the two release receipts below distinguish the initial data integration from the subsequent routing synchronization.

## Findings and changes

| Area | Finding | Result |
| --- | --- | --- |
| Explorer regional map | Hand-drawn continent outlines | Leaflet geographic map with OpenStreetMap tiles, grouped API node markers, keyboard-accessible popups and node-detail links |
| Location privacy | Invalid or incomplete coordinate pairs could reach the public map | Validate both coordinates and their source before the existing 5-degree public rounding; unknown positions stay unplotted |
| Marketplace map | Cold Leaflet initialization could delay markers; anonymous CARTO tiles return an API-key-required image | Markers draw after initialization, with resize handling, visible map failures and an OpenStreetMap fallback |
| Google map activity | Depended on the retired Google Heatmap Layer; node status was used to infer activity | Density bubbles use reported positive session counts; Google loader failures expose the geographic fallback |
| Map purchase | Failed listing lookups fabricated purchase limits, concurrency and other listing terms | Failed lookups show an error and cannot open a fabricated checkout |
| Escrow helpers | Public browser/test flags could produce fake transaction receipts | Removed those helper shortcuts; real helpers require a wallet and cluster checks |
| Buyer analytics | Failed queries silently became empty arrays/zero values; a GHS amount could be shown as SOL | Independent authenticated source queries, visible failures/retry, explicit missing measurements, and currency-correct labels |
| Seller measurements | Missing uptime/score values could become healthy defaults; cards claimed invented disputes and freshness | Show reported values, preserve actual zero measurements, identify unavailable source history and remove invented claims |
| Inbox | Request failure could look like an empty inbox; adapters invented profile metrics and timestamps | Visible source errors; only supplied participant fields and timestamps; avoid displaying another conversation's messages during selection |
| Governance | Missing status, quorum and voting power gained invented defaults | Missing values stay unknown/unreported; absent required vote counts reject the response |
| Tool access | Important existing tools became difficult to reach | Role-specific workspace search, an account-menu tools section and contextual links, with four primary destinations retained |

## Source connections

| View | Actual source |
| --- | --- |
| Marketplace geography | `/v1/marketplace/map`, existing server facets and `/v1/listings/:id` for current checkout terms |
| Explorer node geography | `/api/public?resource=node-geo`, through the existing allowlisted public adapter to the control API |
| Buyer totals | `/v1/analytics/overview` |
| Daily usage | `/v1/analytics/usage/daily?days=7|14|30` |
| Geographic usage | `/v1/analytics/geo` |
| Destinations | `/v1/analytics/top-destinations` |
| Network observations | `/v1/network/status` |
| Seller measurements | Existing authenticated provider nodes, earnings summary and per-node uptime APIs |
| Messaging | Existing authenticated conversations/messages APIs and WebSocket events |
| Governance | Existing proposal, vote, transaction relay and execution-readiness APIs |

Authentication uses the existing same-origin API client; account query keys include the current user. A source error is not substituted with sample records. Cached observations are labeled as stale when refresh fails.

Daily `cost_sol` is an analytics estimate calculated by the current backend from usage and its configured rate. It is labeled as an estimate, not settled billing. Order receipts and settlement history remain in Activity.

## Restored discovery

- Buyer: marketplace map, saved offers, detailed usage analytics, billing and Access Passes, client/SDK setup, usage proof records.
- Seller: computer pairing, node credentials, downloads, node health, performance analytics, service configuration, catalog products, customers and enterprise pooling.
- Shared: API keys, account data/export, help forum, referrals and governance participation.
- Administration remains role-gated. Existing authentication and capability checks still apply to each destination.

## Map operations

OpenStreetMap standard raster tiles use HTTPS, visible contributor attribution, normal browser cache/Referer behavior and no offline or bulk-download feature. The fallback has no new API credential requirement. This community tile service is best effort; a contracted tile provider can be configured in a future infrastructure change if traffic requires it. Google Maps remains available where its existing key is configured.

Public positions are approximate. A country/region hub is not a provider's exact location. Nodes without a usable position are retained in the regional records rather than placed at an invented coordinate.

## Validation

- Web production build and TypeScript checks pass.
- Explorer production build and TypeScript checks pass.
- Eight Explorer public-data boundary tests pass.
- Ten Explorer browser checks pass in Chromium and WebKit, including the map, theme persistence and 320px layout.
- Five new web data-availability/integration checks plus four existing workspace regressions pass in Chromium.
- All 22 existing marketplace browser checks pass in Chromium, covering map proof/filtering, map and listing purchases, catalog/browse, moderation, order credentials and agents. Four cold-render checks pass on retry; they are not first-attempt passes.
- Measurement unit tests, route registry, provider configuration and listing-display contracts pass.
- Focused lint passes for the new analytics/measurement/tests and revised inbox adapter. Repository-wide lint has existing debt and remains visible in CI; this report does not claim the entire lint baseline is clean.

The complete 41-check browser suite was also run on the existing cloud VM, without GitHub Actions. The marketplace specs ran separately with unchanged assertions after the first combined run reached its isolated container's memory limit. The final batches had no memory-limit hits or skipped tests. Ten Explorer checks cover Chromium and WebKit; the remaining 31 checks use Chromium.

Automated tests intentionally use API fixtures and intercept community tile requests; these fixtures are test-only and are not production data. Unmatched upstream requests fail explicitly instead of receiving invented successful data. They verify failure behavior and integration contracts, not a funded on-chain purchase. Production browser verification must be recorded separately after release.

The secret scan of the PR's source changes passes. Explorer's production dependency audit has no high-severity findings. The main web app retains dependency and lint debt from the existing baseline: its full dependency installation reports 24 high-severity audit findings, as well as wallet peer/deprecation warnings and a Node engine warning in the legacy 3D dependency. This release does not claim those dependencies have been remediated; upgrading them requires a separate compatibility review.

The browser suite validated application revision `9aa2c6bad684bb7e103aa8878bdef990029cabc2`. The initial live-data release at `397e4d8c6a7836305f860693489648dacb14755c` changes only the web Dockerfile: the builder inherits the dependency stage directly, avoiding an expensive second copy of the wallet dependency tree on the cloud disk. A cloud comparison of all 3,059 tracked files confirms that all other source files are byte-identical. Both production images were then built, type-checked and checked against the live APIs. The later routing change has its own focused verification below.

## Limits and remaining acceptance

- Public production reads during this work returned four node records and two listing records. Odd listing titles are existing database records; no user records were deleted as part of removing frontend fallbacks.
- Real account histories depend on actual recorded traffic and earnings. No traffic or balances are manufactured to populate screens.
- A complete funded purchase → gateway/provider traffic → accepted settlement/earnings run remains a separate acceptance step requiring the configured oracle and provider environment. This change does not claim to complete that run.
- Existing backend analytics contracts can return aggregate zero values when no samples exist. The frontend identifies request-based rates/latency as unreported when no request samples exist; database error handling inside those backend aggregations is outside this frontend release.
- The parallel team's broader redesign and docs work remain separate. This branch started from main and incorporates their merged public Explorer redirect changes before release.

## Release status

Released on 2026-10-29 at approximately 06:00 UTC from source revision [`397e4d8c6a7836305f860693489648dacb14755c`](https://github.com/samuel-1-avson/ProxySocialHub/commit/397e4d8c6a7836305f860693489648dacb14755c), published in [PR #78](https://github.com/samuel-1-avson/ProxySocialHub/pull/78). Commits include the authorized DCO sign-off under the user's configured Git identity.

GitHub Actions remains blocked by account billing, so this release used the existing cloud VM directly: a checksum-verified Git archive, a resource-limited cloud builder, loopback-only candidate checks against the real APIs, and the existing frontend image rollout scripts. No local Docker or GitHub Actions jobs were used for these cloud checks or this deployment. Runtime configuration and previous images were retained for rollback. The initial builder stall and the dependency-copy bottleneck were resolved before rollout.

- [Main app](https://proxyhubb.com/), its health endpoint and marketplace map return HTTP 200. The real marketplace API returned two offers and one node point during verification.
- [Standalone Explorer](https://explorer.proxyhubb.com/nodes?view=map) and its health endpoint return HTTP 200; the health response identifies the release revision. Its public geography API returned four node records.
- The old main-site `/explorer` entry redirects to the standalone domain.
- [Docs](https://docs.proxyhubb.com/docs) still returns HTTP 200. Container IDs and image references for docs, backend services, gateways and databases match the pre-release snapshot.
- Browser verification confirmed loaded OpenStreetMap tiles, live offer details, the Explorer node popup and public node-detail record, and the restored buyer tools in workspace search. These checks used the deployed public sites without fixture interception.

Initial release image IDs:

| Service | Image ID |
| --- | --- |
| Web | `sha256:c7622b0b12e6be97c5babe196882c23d5a937dba2965c423a4c1ade75bbddd55` |
| Explorer | `sha256:7a85c0d900083bf8c51c001ec5e2432cdab9e31c15a7329592d8b7acb091fb42` |

Both initial containers were healthy and carried the source revision label above. The Git archive SHA-256 is `27a7e40da20a7386480d0a0a1b76985573ca31b4331d2538baf876c7dfaaa580`. The [initial release receipt](releases/frontend-live-data-2026-10-29.json) records the browser results, public checks and source equivalence. GitHub check results have not been replaced or marked successful artificially.

## Final synchronization with main

PR #78 was merged normally, including the authorized sign-off. The broad automatic deployment workflow was briefly paused around that merge and restored to its previous active state; security checks and branch rules were not changed.

The final Git comparison detected the other team's concurrently merged [PR #80](https://github.com/samuel-1-avson/ProxySocialHub/pull/80). Its 15 web routing/link changes make the dedicated Explorer the default destination and retire all remaining embedded Explorer entries. The combined main source at `a9f81bc1a444fc1866e0041f9756ea93b67b8b9b` was therefore rebuilt and released to the web container. Explorer and the shared design-system source are byte-identical to the initial release and did not need another rollout.

- The combined web production build and TypeScript checks pass; the retired Explorer pages now use redirects rather than another public interface.
- Five redirect unit tests pass on the cloud Node 20 runtime.
- Twelve candidate and twelve production HTTP checks pass, covering public Explorer records, map filters, legacy catch-all routes and private workspace login guards. Query parameters are compared by value, allowing equivalent parameter orderings.
- Browser verification confirms that `/explorer/sessions` opens the standalone Explorer and that the final marketplace remains available.
- All other container IDs and image references, including Explorer, docs, gateways, control API and databases, still match the initial release snapshot. The previous web image is retained for rollback.

The final healthy web image ID is `sha256:50ed75254ae4d61fa0668b8f5dd57bf40317930fe91951743d5f359176624ef8`; Explorer retains its image ID above. The combined source archive SHA-256 is `94e5cb41d54ed90456ba383fa7cd75e38d8d32ddf1ef8c09e4416ebb17802f10`. The [routing follow-up receipt](releases/frontend-routing-followup-2026-10-29.json) records these checks and source comparisons. This follow-up does not claim a rerun of the entire 41-check browser suite against the routing delta or a funded traffic/earnings acceptance run.
