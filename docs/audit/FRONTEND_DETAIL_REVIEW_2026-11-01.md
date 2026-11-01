# Frontend detail and public-surface implementation

> **Final continuation:** inbox, profiles, friends, discussion editor/thread, treasury, operator tools, and all Explorer record families are now implemented. The [completion report](./FRONTEND_COMPLETION_REPORT_2026-11-01.md) supersedes the remaining-scope and version notes in this staged report.

This implementation extends Signal Foundry through the buyer’s listing, checkout, order, session, wallet, and settings screens; the marketplace map; the active forum; all three governance screens; and shared public help, policy, and recovery layouts. Explorer overview and search also received individual updates.

The [page acceptance inventory](./data/frontend_visual_acceptance_2026-11-01.csv) records every current page module, including aliases, explicit shared modules, and individually implemented page families. “Implemented” describes the frontend work; it does not certify live API, wallet, settlement, or production health.

## Changes delivered

| Surface | Result |
|---|---|
| Listing details | Clear product/location hierarchy; performance provenance; explicit missing metrics and reviews; purchase summary; working share feedback; provider identity; recoverable questions. |
| Map discovery | Theme-aware controls, named filters, useful summary metrics, and checkout that loads authoritative listing terms before opening. Failed term requests expose a retry instead of constructing an offer. |
| Checkout | Small nonzero prices retain precision. New purchases require valid minimum, capacity, price, and active status. Existing-order verification retains its original record. Copy failures are visible. |
| Orders and credentials | Payment/access/credentials/traffic lifecycle, separate receipt, copyable order reference, masked password and command preview, explicit reveal controls, and local clipboard errors. Extension pairing and order recovery remain available. |
| Session details | Copyable identifier, observed usage versus quota, consumption progress, routing explanation, and reviewed termination with visible API failure. |
| Wallet | Distinct linked-wallet, account-ledger, and order-escrow summaries; copyable addresses; network inspection; deposit/withdrawal surfaces; history and empty states. Existing funding guards are retained. |
| Settings | Sidebar navigation, profile preview, explicit appearance choices, notifications, device and security-history surfaces. Theme choice persists and exposes selection to assistive technology. |
| Forum | Topic cards, recent discussions on the home screen, shared readable thread cards, retryable search, recent/popular/unanswered collections, category pagination, personal-post states, and active navigation semantics. |
| Governance | Proposal search/status filters and factual counts; separate execution readiness; readable proposal editor and labelled controls; debounced impact preview; proposal-loading recovery; accessible view/vote selection states. |
| Explorer | Readable overview/search, positive values no longer imply an improving trend, zero versus missing metrics, unavailable health/trust labels, typed stream records, and explicit search service failures. |
| Public pages | Marketing header/footer, contents links, numbered reading sections, responsive text layout, and unique metadata for help, contact, guidelines, terms, privacy, and extension privacy. |
| Recovery and shared cards | Branded access-denied/not-found views, loading skeletons, useful error recovery, configurable card padding, and reduced-motion handling for shared cards. |

## Audit findings addressed

| Finding | Before | After |
|---|---|---|
| Map listing request failure | Checkout invented minimum, concurrency, protocol, status, and telemetry from an incomplete map pin. | Purchase terms must load successfully; unavailable offers cannot start new checkout. |
| Missing purchase minimum | Checkout silently used 1 GB. | Missing/invalid required terms disable new-order submission and explain the problem. A published zero minimum remains valid; a zero-bandwidth order cannot be submitted. |
| Small purchase prices | A nonzero estimate could appear as $0.00. | The total retains up to eight decimal places. |
| Listing reputation | Missing reviews could appear as a five-star default. | No reviews is a distinct state in the offer and provider card. |
| Credential visibility | The curl preview exposed the password even while the password field was masked. | Both stay masked until the user reveals the password; copying the command remains an intentional action. |
| Clipboard rejection | Copy/share could fail without useful feedback or reject an unhandled promise. | Copy/share failures are visible and offer a manual-copy path. |
| Questions/search failure | Unavailable data could look like an empty discussion. | Request failures have an explicit retry path. |
| Explorer health | An unavailable health service defaulted to optimal. | Missing health is labelled unavailable. |
| Explorer metrics | Zero and missing values were conflated; any positive value displayed an up trend. | Zero stays zero, missing values stay unavailable, and unsupported trend claims are removed. |
| Public governance impact | A public read-only endpoint was called through an authenticated helper. | Impact previews use the server’s public API contract and are available to signed-out readers. |
| Proposal fetch failure | A failed request was presented as a missing sequence. | The proposal screen shows unavailable data and allows retry. |

## Validation

- TypeScript passes.
- All **77 changed TypeScript/JavaScript files** pass ESLint with zero errors and warnings.
- Full-app ESLint still reports **159 errors and 147 warnings across 69 files**, reduced from the earlier 178/171 baseline.
- All 12 sampled base-token contrast pairs pass their text/indicator targets after darkening the light-theme focus ring. See the [contrast data](./data/frontend_token_contrast_2026-11-01.csv). This is a token check, not a complete rendered-component accessibility assessment.
- **56 distinct Chromium checks passed across staged runs** covering buyer/provider workspaces, marketplace browse/listing/map/checkout, order credentials and extension pairing, Explorer, forum, and governance. Initial stale selectors and fixture-shape failures were corrected and the affected checks rerun. The last checkout run passed all four cases, including missing terms and a valid zero minimum.
- Route validation passes: 92 registered static entries, 38 navigation keys, 102 route policies, and 11 dynamic policy prefixes.
- Whitespace validation passes with Windows CRLF handling.
- Production build passes on the installed Next 16.2.2 runtime; 111 static pages and the dynamic route set were generated. The dependency-version mismatch below remains a release gate.

Browser workflows use controlled API fixtures and mocked payment/extension flows. They do not send real funds or establish live settlement health. Screenshots under [previews](./previews/2026-11-01/) contain fixture inventory, balances, and identifiers.

## Remaining implementation and release work

1. Complete the individual design pass for the remaining Explorer record/table/map screens, using the overview/search patterns while retaining provenance and feature gates.
2. Review forum thread/composer, private inbox, public/provider profiles, treasury, account advanced controls, onboarding, and DePIN pages. Retired community features should keep their intentional archive treatment.
3. Use the acceptance inventory to review every canonical page and alias in data, loading, empty, and failure states. Complete keyboard/focus checks, contrast measurements, zoom, reduced motion, and widths from 360 to 1440 px.
4. Resolve the full-app lint baseline and run production performance checks. The changed-file lint result and the repository-wide result are separate gates.
5. Align the installed dependency tree with the manifest/lockfile and repeat the build and critical workflows. The current local runtime is Next 16.2.2, while package.json requests 16.4.3; npm ls next reports this as invalid. The current checks establish behavior on the installed runtime.
6. Configure and verify the live API environment and intended wallet networks. The local API remains unavailable; WalletConnect-backed EVM login also requires the deployment’s project ID.
7. Run the actual live funded purchase, traffic verification, earnings, and deployment acceptance before describing the frontend as production-ready.
