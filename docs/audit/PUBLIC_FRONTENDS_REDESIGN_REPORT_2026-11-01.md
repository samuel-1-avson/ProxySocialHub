# Public Explorer and Docs redesign

**Status:** Implemented, separately deployed, and verified live on 1 November 2026.

**Docs implementation revision:** `7577da13dd72791e62f56e9cdaa7c9dbf4364b42`

**Explorer implementation revision:** `28359480eaae80e8bfcdc39120d2b76381fb5efb`

**Scope:** `apps/explorer`, `apps/docs`, shared public design assets, and their browser coverage.

## Audit findings

The screenshots showed two independently deployed applications with older blue/gray surfaces. Updating the main workspace did not update either application. Their production images preceded this redesign: Explorer used revision `397e4d8c6a7836305f860693489648dacb14755c`; Docs used `proxyhubb-docs:app-mdx-852d57fc`.

The visible inconsistencies included different brand marks, a text theme selector in each navigation bar, mismatched type and colors, weak content hierarchy, and dense mobile navigation. Deeper inspection found narrower-than-necessary mobile code examples, a contents control covering reading space, inaccessible scrolling tables, and duplicate API reference instances after initialization. Eleven unquoted YAML frontmatter values also prevented the Docs search-index build from completing.

## Implementation and coverage

| Area | Delivered behavior |
|---|---|
| Shared identity | Matching chartreuse PH mark, brand lockup, evergreen/off-white colors, Space Grotesk and IBM Plex Mono fonts, primary links, and focus states. Fonts are self-hosted with their licenses. |
| Navigation | Shared sun/moon icon control, visible active destinations, reciprocal links between workspace, Explorer, and Docs. Device appearance remains available in the footer/sidebar. |
| Explorer overview | Strong page introduction, integrated record search, metric cards with source attribution, legible network health and writer evidence. A final live-data review added a four-observation history preview and five-transaction ledger preview; earlier observations expand and the full ledger retains pagination. |
| Explorer nodes | Consistent filters, list/map navigation, node cards, and node detail surfaces. All five primary navigation destinations remain visible on narrow screens. |
| Explorer ledger | Transactions, blocks, address lookup, and record details use the same surfaces and typography. Mobile transaction cards expose amounts and Inspect actions without clipping. |
| Explorer analytics | Responsive chart grid, endpoint labels and values, exact-data tables, readable empty states. |
| Explorer governance | Matching proposal lists/details, treasury evidence, and status treatments. |
| Explorer supporting states | Health, About, lookup, branded 404, empty records, and public-source-unavailable feedback. Missing bandwidth is distinguished from a reported zero. |
| Docs home | Clear introduction, buyer/provider/developer task paths, useful reference links, and existing plain-language diagrams. |
| Docs reading pages | Consistent article typography, sidebar/active state, right-side contents on desktop, dedicated contents bar on mobile, callouts, tables, pagination, and code blocks. |
| Docs interactions | Touch/keyboard search, mobile menu with focus restoration, theme persistence, full-width code examples, copy success/failure/retry feedback, keyboard-accessible scroll regions. |
| API reference | One programmatically managed Scalar instance, theme-aware recreation/cleanup, loading/retry feedback, named search control, and retained raw OpenAPI download. |
| Build and release | Valid quoted frontmatter, generated search index, separate production images, exact source-revision checks, health gates, and previous-image rollback. |

The Explorer route audit exercised 17 URL configurations: overview, node list/map, transactions, blocks, analytics, health, governance, treasury, typed wallet lookup, About, and six detail families (node, transaction, block, wallet, contract, proposal). It also checked ten unavailable-source configurations and a missing route. The Docs audit rendered every one of the 33 indexed content routes, plus the missing-route recovery page. Their complete route/theme/viewport matrix is recorded in the linked JSON evidence.

## Verification

| Check | Result |
|---|---|
| Optimized builds | Docs and Explorer built locally and in Linux production images; TypeScript checks passed. |
| Public data contracts | 8 passed. |
| MDX security contracts | 2 passed. |
| Explorer Chromium suite | 5 passed. |
| Cross-application Chromium suite | 11 passed, including one API viewer after a theme change and a populated overview that remains concise as records grow. |
| Route observations | 312 final passing observations at 390px, 1024px, and 1440px, in light/dark themes; includes error and unavailable states. |
| Layout/runtime | No page-level horizontal overflow or uncaught page errors in the final observation set. |
| Automated accessibility | 84 final passing axe scans against WCAG 2.1 A/AA tags on representative templates, themes, widths, and error states. |
| Dependency install audit | Zero known vulnerabilities reported by both application installs; no dependency/lockfile changes. |
| Changed browser files | Targeted ESLint passed. |
| Release helper | Bash syntax check passed. |
| Secret scan | Gitleaks 8.30.1 scanned both implementation commits with repository rules: no leaks. Both commits include DCO sign-off. |

Initial accessibility scans exposed light-mode warning/API placeholder contrast and mobile table focusability problems; these were fixed and the affected Docs matrix rerun. The Explorer missing-route scan initially started before the streamed document completed; a recheck after the heading and language were present passed. Final evidence uses the completed document, and the initial observations remain in the working audit logs.

An independent screenshot review inspected the revised desktop and mobile compositions. The first review identified clipped navigation, hidden mobile actions, narrow code examples, and the overlapping contents control. Those issues were corrected; the follow-up reported no remaining concrete visual defects in the four revised captures. A final review of four actual production viewport captures also found no remaining visual defects materially affecting usability. This review complements the DOM and automated contrast checks.

The route audit uses controlled public data so populated, empty, degraded, and unavailable states can be inspected consistently. It does not claim those fixture values are live network measurements. Automated accessibility scans do not replace human screen-reader acceptance.

Evidence: [final route and accessibility observations](./data/public-frontends-route-checks-2026-11-01.json). Repeat the checked-in interaction suite with `npx playwright test --config=playwright.public.config.ts` from `apps/web`, against separately running Docs on port 4023 and Explorer on port 4024.

## Production release

Both sites are now live with their own release images:

| Service | Live domain | Source revision | Next.js build ID | Image digest |
|---|---|---|---|---|
| Explorer | [explorer.proxyhubb.com](https://explorer.proxyhubb.com/) | `28359480eaae80e8bfcdc39120d2b76381fb5efb` | `03B_H0w8_TiKqv_p02DUY` | `sha256:b902138f0b8ca0f0c508e2ef98b4a44b9e2347e552a00881c5e8df5749a7284d` |
| Docs | [docs.proxyhubb.com/docs](https://docs.proxyhubb.com/docs) | `7577da13dd72791e62f56e9cdaa7c9dbf4364b42` | `dSwuz-ZQW4gv3kCTOOzkm` | `sha256:b3128108eb8e67e05184b51a8496789b4cfe8641735e672dc6b40aef94ea5e08` |

GCP Cloud Build `c056428d-ebb6-4739-9650-d9e5588ccde8` built the shared redesign images successfully. Build `3e572f18-d247-462f-8db3-1de9b0c5b030` successfully built the final Explorer overview refinement. Each source archive came from the exact signed-off Git revision; each rollout checked its OCI revision label and container health before completion. Both containers are healthy with zero restarts. GitHub Actions runners remain subject to the repository's documented billing block; the manual checks and successful Cloud Build runs are recorded separately from GitHub workflow results.

Only the Explorer and Docs services were recreated. The main workspace retained source revision `10dd9ed3fb63ebfdb85cc5cb30854647506792d2`, its image digest, and its running container ID. All 13 other `proxyhubb-*` application containers matched the before/after snapshot.

Actual-domain Playwright checks passed **64 page/theme/viewport observations and 44 axe scans**, with no page overflow, uncaught errors, failed Next.js assets, header theme selectors, or automated accessibility violations. Each site was checked at 1440px and 390px in both themes. Separate 320px interaction checks passed theme persistence, navigation visibility, Docs menu/search and focus restoration, the single API viewer after a theme change, and typed Explorer lookup. All **33 Docs routes returned HTTP 200**. Explorer's public health endpoint reported the exact deployed revision. The live overview retained at most four visible health observations and five transactions.

Evidence: [live checks](./data/public-frontends-production-live-checks-2026-11-01.json), [runtime and rollback receipt](./data/public-frontends-production-runtime-2026-11-01.json), [Explorer desktop](./previews/2026-11-01/public-explorer-live-desktop-dark.png), [Explorer mobile](./previews/2026-11-01/public-explorer-live-mobile-dark.png), [Docs desktop](./previews/2026-11-01/public-docs-live-desktop-dark.png), and [Docs mobile](./previews/2026-11-01/public-docs-live-mobile-dark.png). These screenshots show actual production data.

The immediately preceding images remain available for rollback: Explorer `sha256:2970b3d657e2be557c66bc9b3c3ae275684851a668dfaa8c2255bb46d4200238` and Docs `sha256:b2024f83c4d8e22ee5c630f853b24b0906ddf8f4fc079910000a015eb43cde53`. The original pre-redesign Explorer image also remains available. Deployment used the existing Explorer release helper and the new Docs-only helper, without dependency recreation or database migrations.

## Follow-up acceptance

Complete human keyboard/screen-reader and 200% zoom review of the published sites. Backend network degradation remains visible as reported; this visual release does not alter indexer health, wallet transactions, settlement, or the workspace's existing devnet configuration. The separate main-workspace acceptance items remain recorded in the [main frontend production report](./FRONTEND_PRODUCTION_DEPLOYMENT_2026-11-01.md).
