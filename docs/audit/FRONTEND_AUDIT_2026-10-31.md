# ProxyHubb frontend audit and redesign report

> **Implementation update — 1 November 2026:** the interface work now covers the remaining page families. See the [completion report](./FRONTEND_COMPLETION_REPORT_2026-11-01.md) for current verification and release gates; the findings below document the original audit.

**Date:** 31 October 2026  
**Scope:** `apps/web` (Next.js App Router) and the shared design-system styles in `packages/design-system`  
**Original audit status (31 October):** Audit and initial visual foundation completed. The completion report above records the subsequent page-family implementation and final verification.

## Executive summary

The web app has a useful shared design-system layer and 126 page modules, but the interface had drifted into several competing visual languages. The root tokens described a low-contrast grey theme, while many individual pages and widgets used separate black, emerald, blue, violet, and amber treatments. The shared patterns were too quiet to create a recognizable brand, while the pages that tried to add energy often relied on dense mono labels, oversized uppercase copy, or neon accents.

Navigation also reflected different generations of the product. The marketing header hid its navigation on smaller screens without offering a menu. The signed-in sidebar exposed the core buyer/provider destinations but made community routes difficult to find. The Explorer had five top-level links for a much larger set of public pages.

The redesign establishes **Signal Foundry**: deep evergreen-black surfaces, a high-contrast chartreuse action color, an off-white/forest light theme, Space Grotesk for interface typography, and IBM Plex Mono for technical labels and values. Network diagrams and route traces provide the product-specific visual signature. Shared tokens carry this system across the existing page families.

### Qualitative audit score

| Area | Before | Evidence |
|---|---:|---|
| Brand and palette | 2/5 | Grey root palette competed with emerald/black page-level styling. |
| Cross-route consistency | 2/5 | 126 page modules share some patterns, but direct color values and separate page shells cause drift. |
| Navigation and wayfinding | 2/5 | Marketing navigation disappeared below desktop; workspace missed community links; Explorer exposed only five sections. |
| Hierarchy and legibility | 2.5/5 | Repeated technical microcopy and weak surface separation reduce scanning quality on data-heavy views. |
| Responsive behavior | 2.5/5 | Workspace has mobile tabs, but marketing navigation had no small-screen equivalent; route rails need narrow-screen review. |
| Accessibility foundations | 3/5 | Skip link, focus-visible, labels, and reduced-motion rules exist. Theme-toggle hydration was inconsistent and has been corrected. |
| Production confidence | 2.5/5 | Frontend route UI renders, but local API requests fail at `localhost:18080`, so live-data states cannot be verified in this environment. |

These are source and visual-review ratings, not analytics or user-research measurements.

> Implementation update, 1 November: [detail/public-surface report](./FRONTEND_DETAIL_REVIEW_2026-11-01.md) and [126-page acceptance inventory](./data/frontend_visual_acceptance_2026-11-01.csv). The counts below record the original audit baseline; the continuation report records the current validation and remaining gates.

## Audit method and coverage

- Counted **126 `page.tsx` files** under `apps/web/src/app` and grouped them by route family.
- Used `docs/audit/data/frontend_routes.csv` to compare route purpose, API dependencies, and already-recorded partial/flagged states.
- Reviewed the shared token files, workspace and Explorer shells, marketing header, auth pages, and representative landing, marketplace, Explorer, and login routes.
- Inspected those representative routes in the local browser. The Explorer, marketplace, and auth views rendered; the marketplace request returned an unavailable-data state because its API dependency was offline.
- Reviewed source patterns for raw color values and duplicated shell styles. **29 files** under the web app include explicit hex colors; some are chart series or map rendering colors and need domain-aware treatment rather than blind replacement.
- Ran `npm run typecheck`, `npm run build`, the route registry validator, and targeted ESLint over all modified TypeScript/JavaScript files. The typecheck/build/route validator/targeted lint pass. The full repository lint still reports **178 errors and 171 warnings** across the web app.

This is a full route-source inventory and cross-cutting UI audit. It is not a completed manual interaction review of all 126 pages; the route-by-route acceptance pass is a remaining plan item.

### Route-family inventory

| Route family | Page modules | Audit notes |
|---|---:|---|
| Home | 1 | Previous hero had little product evidence and no clear visual route map. Redesigned with buyer/provider paths and public Explorer entry. |
| Login and registration | 2 | Repeated narrow card pattern; replaced with one shared visual direction and wallet-first layout. |
| Marketplace | 9 | Shared workspace shell and filter patterns were already present. Styling is now stronger; live inventory was unavailable locally. |
| Buyer app workspace | 8 | Uses the shared `AppShell`; common token and shell changes apply. Community/network quick links were missing. |
| Dashboard | 36 | Largest family; many pages use semantic tokens, with some legacy page-specific styling. |
| Provider workspace | 8 | Shares the app shell; provider/seller wording was inconsistent. |
| Explorer | 20 | Public data surface had a sparse five-link nav despite broad route coverage. Navigation and footer now cover the public sections. |
| Community | 13 | Forum, activity, messaging, friends, and referrals need family-level consistency review. Shared tokens apply, but some legacy styling remains. |
| Governance | 3 | Feature-specific dark/neon styles remain; requires individual page review for token and density consistency. |
| Help | 8 | Static and forum surfaces share the global token layer; route-family review remains. |
| Profile, privacy, settings | 6 | Shared colors change globally; each editor/detail state still needs acceptance review. |
| Other public/support routes | 12 | Includes access denied, contact, DePIN, guidelines, legacy leaderboard, messages, network, onboarding, provider profiles, terms, treasury, and whitepaper. |
| **Total** | **126** | Route-source count. |

## Detailed findings

### High priority — design language split

`packages/design-system/tokens.css` used cool, low-saturation grays for the root palette. Individual route/components added unrelated dark surfaces and accents. The split made different screens feel like separate products and limited the visual weight of key actions.

**Action taken:** Replaced the base colors, borders, radii, and elevation with the Signal Foundry semantic palette for both dark and light themes. Updated the global type mapping and loaded Space Grotesk and IBM Plex Mono through `next/font` so fonts are self-hosted by the Next build rather than requested from the browser at runtime.

**Remaining:** The app still contains chart/map colors and page-level utilities that bypass semantic tokens. These need review by role (status, data series, map surface) before conversion.

### High priority — incomplete public navigation

The marketing header exposed only three links and hid the link row below the large-screen breakpoint without an alternative. This made the smaller-screen header mostly brand, theme, and account actions.

**Action taken:** Added Marketplace, Explorer, Network map, Governance, and Community links plus a keyboard-operable mobile menu with expanded state and current-route indication.

**Remaining:** Verify the menu at narrow mobile sizes and audit legacy aliases such as `/help/forum` against current `/community/forum` destinations.

### High priority — public Explorer wayfinding

The Explorer layout exposed Overview, Nodes, Transactions, Analytics, and Governance while the route inventory contains 20 public Explorer page modules.

**Action taken:** Expanded the Explorer rail to include Map, Sessions, Blocks, Wallets, Contracts, Health, Earnings, Leaderboard, and Search, added `aria-current`, and added a small Explorer footer.

**Remaining:** Review the full rail on small screens and decide whether long route lists should stay as a scrollable rail or be grouped into a searchable “More” menu.

### Medium priority — workspace nav silos

The signed-in sidebar exposed four core destinations, Explorer, Help, and Settings. Forum, activity feed, and Governance were not represented there.

**Action taken:** Added a Community & network section to the desktop workspace sidebar and included those destinations in workspace search. The brand mark and buyer/provider naming are now consistent in the shared navigation.

**Remaining:** Review the mobile bottom bar and search affordance with keyboard, touch, and screen-reader flows.

### Medium priority — generic entry page and thin authentication shell

The home page used a large centered text hero with a low-contrast animated canvas. Login and registration repeated narrow, isolated wallet cards with little product context.

**Action taken:** Rebuilt the home page around a buyer → gateway → provider request-path illustration, explicit buyer/provider CTAs, a short workflow, public-record CTA, and a structured footer. Rebuilt login/register around the same brand, with wallet access details and referral/terms content retained.

### Medium priority — weak data hierarchy and page surfaces

Shared workspace patterns used minimal surface separation. The sidebar and header felt detached from page content, and tables, surfaces, and action states lacked a consistent elevation and active-state treatment.

**Action taken:** Improved the shared workspace shell, page title scale, surface border/elevation, active nav treatment, hover behavior, mobile bar, status surfaces, and table interactions. Existing dashboard and marketplace views inherit these changes through shared CSS.

**Remaining:** Several Explorer/community/governance pages retain feature-specific old vocabulary and dense uppercase labels. The global layer improves their palette, but does not replace page-by-page information hierarchy work.

### Production and accessibility risks

- The local frontend attempted to refresh auth and fetch marketplace listings through its configured proxy to `localhost:18080`; requests were refused. The marketplace therefore showed “Inventory unavailable” and could not be visually audited in a populated state.
- The production build passes and generates the current route set. Full-app lint remains a release blocker until its 178 errors and 171 warnings are triaged; targeted lint on this redesign's files is clean.
- The route validator previously treated registered paths handled by `[section]` as missing. It now resolves concrete paths through existing dynamic Next.js segments; the validator passes with 92 static entries, 38 navigation keys, 102 policies, and 11 dynamic policy prefixes.
- The build warns that `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is unset. Solana login remains available, but EVM WalletConnect is disabled until the deployment environment supplies the project ID if that wallet flow is required.
- The browser initially surfaced a dark-mode hydration mismatch: the server and client rendered different theme-toggle labels. The toggle now waits for hydration before exposing a theme label/action.
- The repository has existing `prefers-reduced-motion`, skip-link, and `:focus-visible` foundations. The new landing diagram uses CSS-only motion and respects reduced motion.
- The audit did not verify contrast ratios with an automated checker, run screen-reader walkthroughs, or exercise authenticated roles. Those are explicit acceptance steps in the implementation plan.
- Local Next dev output includes a middleware naming deprecation warning. This does not block the visual redesign, but should be tracked separately in the framework upgrade/production checklist.

## Work completed in this pass

- Established Signal Foundry semantic light/dark tokens and typography.
- Redesigned marketing navigation for desktop and small-screen menu behavior.
- Rebuilt the landing page and static request-path visual.
- Rebuilt login and registration page layouts while preserving wallet, referral, and legal flows.
- Added community/network links to workspace navigation and searchable destinations.
- Expanded Explorer navigation and added active-route semantics and public footer.
- Updated the route validator to recognize existing dynamic route folders such as `/help/community/archive/[section]`.
- Updated shared workspace page/card/table/navigation styles used by marketplace, buyer, and provider routes.
- Fixed the theme toggle’s hydration-dependent label/action behavior.
- Standardized visible “provider” wording in the workspace switcher and footer.
- Inspected local homepage, Explorer, marketplace, and sign-in render states; verified mobile-menu expansion through the browser accessibility tree.

## Design direction snapshot

- **Aesthetic:** Signal Foundry — editorial infrastructure, with quiet network cartography.
- **Purpose:** Help users compare capacity, connect to a provider, manage their role-specific workspace, and inspect public records.
- **Tone:** Industrial/functional with editorial typography. One primary accent carries actions and active navigation.
- **Differentiation anchor:** A buyer-to-gateway-to-provider route diagram paired with a distinctive chartreuse signal color.
- **Typography:** Space Grotesk for display/interface; IBM Plex Mono for technical metadata and values.
- **Motion:** Sparse route pulse only; reduced-motion support retained.
- **Design Feasibility & Impact Index:** Impact 5 + Context fit 5 + Feasibility 4 + Performance safety 4 − Consistency risk 3 = **15** (excellent; proceed with token discipline).

## Go/no-go status

The shared visual foundation and entry shells are substantially improved, and the production build/typecheck pass. The frontend should **not yet be called production-ready**: the configured API was unavailable during the route review, full-app lint still fails, WalletConnect lacks a project ID in this environment, and the full route acceptance pass has not been completed. Several route families also retain legacy page-level styling. See the implementation plan for order and release gates.
