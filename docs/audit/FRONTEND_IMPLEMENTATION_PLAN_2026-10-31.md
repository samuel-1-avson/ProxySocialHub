# ProxyHubb frontend implementation plan

**Date:** 31 October 2026  
**Related audit:** [Frontend audit and redesign report](./FRONTEND_AUDIT_2026-10-31.md)  
**Objective:** Carry the Signal Foundry redesign through all 126 web page modules, preserve existing product behavior, and produce a verifiable release candidate.

## Current implementation status — 1 November 2026

The remaining interface implementation is complete across the page families described below. The definitive evidence and release limitations are in the [completion report](./FRONTEND_COMPLETION_REPORT_2026-11-01.md). The [126-page inventory](./data/frontend_visual_acceptance_2026-11-01.csv) separates source pages, explicit shared modules, and redirects; it does not imply 126 independent manual browser reviews.

| Phase | Priority | Scope | Status |
|---|---|---|---|
| 0. Visual foundation | P0 | Semantic light/dark tokens, local fonts, shared shells, navigation and entry pages | Implemented |
| 1. Buyer and provider journeys | P0 | Marketplace, checkout, orders, wallet, sessions, provider nodes/listings/earnings | Implemented; controlled-fixture workflow verification |
| 2. Explorer and public records | P1 | Maps, nodes, comparisons, blocks, transactions, wallets, contracts, analytics, health, earnings and rankings | Implemented; readable records, exact chart tables and recoverable data states |
| 3. Community, governance and accounts | P1 | Forum collections/composer/thread, inbox, profiles, friends, account/referral/API-key controls, governance and treasury | Implemented; drafts, pending states, dialog focus and independent source errors |
| 4. Public help and special routes | P2 | Public reading pages, architecture draft, protocol overview, onboarding and recovery | Implemented; legacy onboarding/archive destinations retain canonical redirects |
| 5. Production acceptance | P0 release gate | Build, types, route policies, browser workflows, accessibility, performance, live services and dependency security | Build/types/routes/contracts and staged browser checks pass; local accessibility/performance evidence is recorded; live-service and repository/security clearance remains conditional |

The installed and declared Next.js versions are now aligned at **16.4.3**. Local wallet presentation uses the bundled project fonts; its previous Google Fonts import is removed. Automatic write retries are disabled by default so ambiguous responses do not silently repeat non-idempotent operations.

The sections below retain the implementation criteria used during delivery. Outstanding work is release hardening and live acceptance, rather than another unimplemented page family.

## Phase 1 — Buyer and provider journeys

### Buyer routes

Review these route groups in the listed order:

1. `/marketplace`, `/marketplace/map`, `/marketplace/[id]`, and `/marketplace/saved`.
2. `/marketplace/orders`, `/marketplace/orders/[id]`, `/app/activity`, and `/app/activity/orders/[id]`.
3. `/app`, `/app/connections`, `/app/connections/[id]`, `/app/connections/sessions/[id]`, `/app/wallet`, and `/app/settings`.

For each page, normalize the page heading, primary action, content width, surface hierarchy, and loading/empty/error states. Preserve filter/query state, purchase confirmations, wallet signing, credentials handling, status labels, and deep links. Confirm long provider names, locations, addresses, and numeric values do not overflow.

### Provider routes

Review `/provider`, `/provider/nodes`, `/provider/nodes/new`, `/provider/nodes/[id]`, `/provider/nodes/credentials`, `/provider/listings`, `/provider/listings/new`, and `/provider/earnings`.

Use one provider vocabulary in visible copy. Normalize node state, setup guidance, credential actions, listing lifecycle, earnings tables, and warning/error messages. Do not imply that an offline/unverified node is active or that an estimated earning is settled.

### Acceptance criteria

- Buyer and provider destination labels match across sidebar, switcher, page eyebrow, and workspace search.
- Every primary workflow has a visible next action and clear confirmation/result state.
- Table and card views work at 360 px without unintended horizontal page overflow.
- Empty, unavailable, loading, and error states explain what is missing and provide a safe next step.

## Phase 2 — Explorer and public records

Review all 20 Explorer modules by subsystem:

- **Overview, protocol, and search:** `/explorer`, `/explorer/about/protocol`, `/explorer/search`.
- **Topology:** `/explorer/map`, `/explorer/nodes`, `/explorer/nodes/[id]`, `/explorer/nodes/compare`.
- **Ledger:** `/explorer/transactions`, `/explorer/transactions/[hash]`, `/explorer/blocks`, `/explorer/blocks/[number]`, `/explorer/wallets`, `/explorer/wallets/[address]`, `/explorer/contracts`, `/explorer/contracts/[address]`, `/explorer/sessions`.
- **Network insight:** `/explorer/analytics`, `/explorer/health`, `/explorer/earnings`, `/explorer/leaderboard`.

Keep maps and rendered map markers on their intentional dark canvas. Replace generic telemetry decoration with clear labels, units, source/provenance, and data freshness. Keep charts color-consistent while preserving series distinction. Group the expanded route rail if narrow-screen discovery remains difficult.

### Acceptance criteria

- Data values carry units and distinguish reported, indexed, estimated, and unavailable values.
- A user can reach every Explorer route through the nav, overview links, or search.
- Map controls remain usable by touch and keyboard; map labels and controls have accessible names.
- Empty/feature-gated data is explained without suggesting the whole service is down.

## Phase 3 — Community, governance, and account surfaces

Review all 13 community pages, `/profile` and `/profile/[username]`, the three governance pages, treasury, and the six privacy/settings pages.

Standardize page headers, tabs, thread metadata, composer actions, dialogs, member identity blocks, settings sections, and destructive-action spacing. Keep social features visually distinct from marketplace task flows while sharing the same token and control language. For governance, clearly distinguish discussion, voting status, execution readiness, and treasury evidence. Remove stale “GRID”/“SYSTEM” copy where it describes decoration rather than meaningful product state.

### Acceptance criteria

- No feature state depends on color alone.
- Thread, message, profile, and governance actions have visible focus and pending/success/error states.
- Confirmation dialogs describe the target and consequence before destructive or signed actions.
- Referral codes, wallet addresses, and governance identifiers wrap or truncate with a copy/full-value path.

## Phase 4 — Help, legal, onboarding, and special routes

Review help/forum routes, contact, guidelines, terms, privacy, extension privacy, DePIN overview, onboarding, 403, not-found, error, loading, and provider profile routes. Reuse the marketing header/footer for public informational pages and the workspace shell only for signed-in tasks. Avoid forcing the full account navigation onto concise public reading pages.

### Acceptance criteria

- Each route has a unique title/description where it is indexable and useful to users.
- Support links and policy links are reachable from every public shell.
- Error, not-found, loading, and access-denied screens preserve the shared visual identity and offer a useful recovery route.

## Phase 5 — Production acceptance gate

### Verification and release evidence

See the [completion report](./FRONTEND_COMPLETION_REPORT_2026-11-01.md) and [machine-readable verification](./data/frontend_verification_2026-11-01.json) for the final run results. Production clearance is separate from finishing the interface implementation.

### Environment readiness

The dependency tree is aligned with the manifest and lockfile at Next 16.4.3. Safe dependency fixes were applied; remaining wallet/SDK advisories need a reviewed upgrade path rather than an unchecked forced upgrade.

1. Confirm the production web API base URL and health endpoint for the target environment. In this audit environment the Next proxy attempted `localhost:18080` and received connection refused; marketplace inventory and auth-refresh states therefore remain unverified with live data.
2. Confirm devnet/mainnet labels, token/network selectors, and wallet copy match the deployed configuration.
3. Confirm all feature gates intentionally match deployment configuration; do not treat a local disabled endpoint as evidence of a production outage.

### Code and route checks

- Run typecheck, lint, and production build.
- Run the existing route validator and relevant browser workflows for buyer, seller/provider, wallet, and Explorer routes.
- Review changed route status against `docs/audit/data/frontend_routes.csv`; update that matrix if feature gates or routes have changed.
- Confirm no hydration errors, missing fonts/assets, uncaught page errors, or unintended console errors.

### Visual and accessibility checks

- Capture representative routes at 360, 390, 768, 1024, and 1440 px.
- Check keyboard-only navigation, focus order, active route semantics, menu escape/close behavior, dialog focus return, skip links, and reduced-motion mode.
- Check text, icon, border, and focus contrast in both themes; fix contrast below the project's WCAG AA target.
- Inspect chart labels, dense tables, empty states, 200% zoom, and long identifiers.

### Performance checks

- Confirm the public route bundle does not include wallet-only code unless that route needs it.
- Measure production route assets and remove duplicated heavy animation/chart packages where actual route use does not justify them.
- Run Lighthouse or the existing production performance workflow on the landing, marketplace, and Explorer overview.

## Remaining release work order

This order covers the release conditions that cannot be cleared by restyling pages or fixture-only UI checks.

| Priority | Work item | Concrete acceptance |
|---|---|---|
| P0 | Configure and exercise the intended control API | Health succeeds; real authentication, listing discovery, messaging, provider health, and read-only public records succeed with the deployment configuration. Retain outage/retry behavior from the fixture tests. |
| P0 | Review wallet/SDK dependency migrations | Resolve the remaining advisory chains recorded in the dependency report. Assess Anchor/TOML, Zod, wagmi/connectors/WalletConnect, Solana JSON-RPC and UUID chains together with their direct dependents; validate signatures, transaction retention, and optional EVM behavior after any migration. Do not accept a forced downgrade as an audit fix. |
| P0 | Clear the older repository lint baseline | Finish explicit SDK types and hook lifecycle/ref rules in the files recorded by the final lint evidence. Preserve error handling and external subscription cleanup; keep the active page/control checks clean. |
| P0 | Run funded network acceptance | Purchase once, retain the submitted signature, verify client traffic, and reconcile accepted provider earnings. Exercise cancellation/recovery without a duplicate transfer. |
| P1 | Validate the deployed frontend | Repeat mobile performance and accessibility checks against the target services; perform keyboard and screen-reader acceptance, 200% zoom, and real wallet-extension flows. |

The completion report distinguishes implemented UI, controlled-fixture acceptance, local production measurements, and these unresolved release conditions. Production clearance requires all P0 items; no deployment is implied by this plan.

## Release gates

The redesign is ready to merge when:

- Phases 1–4 have a completed route acceptance record for every page family.
- The production API environment is available and all key loading/error/empty/data-present states are verified.
- Typecheck, lint, production build, route validation, and selected existing browser workflows pass.
- Desktop/mobile checks and keyboard/contrast checks pass in both dark and light themes.
- No high-priority visual, navigation, hydration, or data-labeling issues remain.

## Out of scope for this implementation plan

- API behavior, billing, escrow, wallet semantics, provider state transitions, or feature-flag changes.
- Replacing product copy that would change protocol or settlement claims without product/API evidence.
- Claiming production certification before the release gates above are satisfied.
