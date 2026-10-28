# ProxyHubb: revision 2 design feedback and system specification

**Date:** 28 October 2026 · **Status:** refined design proposal, following user feedback · **Scope:** workspace concept, standalone explorer concept, theme system, feature coverage and migration decisions.

Open [the workspace concept](CONCEPT.html), [the standalone explorer concept](EXPLORER.html), [the feature coverage inventory](FEATURE-COVERAGE.csv), and [the revised 100-route migration inventory](route-disposition-v2.csv). The [first audit](REPORT.md) remains the evidence baseline; the [original visual concept](CONCEPT-V1.html) is retained for comparison.

## 1. Feedback and revised recommendation

Keep the clean arrangement, restrained visual hierarchy and separate buyer/seller workspaces. Add light, dark and system themes as complete experiences. Expand the missing workflows before implementation planning. Move public network inspection into a standalone explorer with its own domain, navigation and frontend build.

Your concern about unavailable features is justified: the first concept was a structural design specimen. Several useful features were represented by explanatory dialogs, and some reporting views were merely descriptions. That is enough to discuss navigation, but not enough to review a complete product experience. The new version makes more of those tasks visible and interactive, while explicitly tracking the remaining design and service dependencies.

The core rule is **minimal navigation with complete workflows**. Reducing the number of destinations must not remove necessary controls, history, recovery, entitlements, or supported advanced operations.

This revision supersedes the first report's embedded Network destination, five-item workspace navigation and light-only concept. The original findings about the current application's usability and data credibility still apply. The production app has not changed, so its original heuristic score of 3.8/10 has not been reassessed upward merely because the prototype improved.

## 2. Updated product structure

| Surface | Purpose | Recommended address | Authentication |
|---|---|---|---|
| Main product | Public explanation, browsing, buying and using proxies, selling capacity | `proxyhubb.com` | Public browsing; private actions authenticated |
| Explorer | Public network, nodes, ledger, measurements, governance and treasury evidence | `explorer.proxyhubb.com` | Public read access by default |
| Documentation | Integration guides, API/SDK reference, provider software instructions | `docs.proxyhubb.com` | Existing documentation model |

The explorer subdomain is a **proposed destination**. No domain, DNS record, certificate, hosting project or production deployment was created in this design phase. Both local concepts use the same preview server; separate production applications are an implementation decision described below, not something the local preview proves has shipped.

### Workspace navigation

| Buyer workspace | Seller workspace |
|---|---|
| Overview | Overview |
| Marketplace | Nodes |
| Connections | Listings |
| Activity | Earnings |

Explorer becomes a clearly marked utility link, also available from receipts, public node evidence and help. Four main destinations are sufficient once Network leaves the application. There is no reason to add an unrelated fifth destination just to fill the old layout.

The application may continue to use the internal role name `provider`. **Seller** is the workspace label; this does not change API roles, grant capabilities or imply that account permissions can be switched client-side. A permitted dual-role account switches workspace, while an unapproved seller follows the real application/readiness workflow.

On mobile, the same four destinations appear in the bottom bar. Theme remains visible in the header. The account menu exposes workspace switching, Settings, Inbox, Help and the separate Explorer link. These utilities must remain reachable even when the desktop rail is absent.

### Explorer navigation

| Destination | Contents | Nested views / detail |
|---|---|---|
| Overview | Network summary, regional evidence, source health, recent settlement | Public source and operating limitations |
| Nodes | Public node inventory | Table, map, rankings, comparison, node detail |
| Ledger | Public ledger inspection | Transactions, blocks, address search, wallet/program detail |
| Analytics | Aggregate measurements and health | Period selection, freshness, metric definitions, quorum/indexer evidence |
| Governance | Public proposals and treasury evidence | Proposal detail, outcomes, execution records, treasury |

Transactions and blocks retain distinct data models. Wallet and program details are typed public records. Public sessions and earnings remain subject to the existing feature flags and data permissions; moving them to an explorer domain does not make private data public.

## 3. Why a separate explorer helps—and what separation requires

The explorer serves a different intent: **inspect and verify**, rather than **purchase or operate**. Its own shell removes technical inspection tools from the buyer/seller navigation and lets it serve public visitors without creating an account.

A different hostname alone does not ensure a lighter product. The intended implementation is a separately built and deployed frontend, with its own routes, page dependencies, data fetching, error handling and performance measurement. Main-workspace routes must not import the explorer's map, charts, ledger renderer or public-feed runtime. A normal link opens the explorer; it is not mounted invisibly in the application or loaded in an iframe.

Keep shared design tokens, accessible primitives and public data types reusable. Avoid sharing application authentication state, role stores or private API clients with the explorer. The existing repository already separates `apps/web` and `apps/docs`; a future `apps/explorer` is a natural option. A framework rewrite is unnecessary. Next.js documents independent applications as a supported way to divide a large frontend; the precise routing/deployment setup should be chosen during implementation planning. [Next.js application separation guidance](https://nextjs.org/docs/app/guides/multi-zones).

### Proposed implementation ownership

```text
apps/web/                  buying, access, account, seller operations
apps/explorer/             public inspection and evidence (proposed)
apps/docs/                 existing documentation surface
packages/design-system/    shared tokens and accessible components (proposed)
packages/public-contracts/ allowlisted public DTOs and formatting (proposed)
```

These folders describe a target architecture; they were not created under the production app tree during this revision. Shared packages should be introduced only with real consumers, keeping private application dependencies out of public packages.

### API and reliability boundaries

- Reuse the public explorer API where its contract is sufficient. It already defines public transaction, block, wallet, node, contract, analytics, health and related endpoints in `services/control-api/internal/api/explorer.go`.
- Preserve the existing redaction of raw chain payloads, linked user identity, private infrastructure endpoints and validator/provider hotkeys. Review any new aggregate or field before exposing it.
- Use public-cacheable responses only for data safe to share. Authentication-sensitive responses must never enter a shared public cache.
- Bound polling, websocket subscriptions, map data requests and search traffic. Separate frontend deployments can still overload a shared backend if request patterns are unbounded.
- Show a useful unavailable/stale state when the explorer source fails. Failure must not break a buyer's private connection view, and a cached explorer result must not be presented as a fresh measurement.
- Establish separate production bundle and page-performance baselines for the workspace and explorer. No performance gain is claimed from the local HTML prototypes.

### Authentication and governance

The explorer does not need the user's private wallet session to display public evidence. Do not pass JWTs, API keys, proxy credentials or private order data through cross-domain URLs. Use allowlisted public transaction hashes, node IDs, program addresses and proposal IDs for evidence links.

Read-only governance records belong in Explorer. Signing actions—vote, create proposal, execute where actually permitted—open the authenticated application action route. The application checks actual eligibility, network, proposal state, authorization and signature consequences. Returning to Explorer preserves the public proposal context without sharing authentication.

This gives governance one public evidence home and one authorized action flow. It does not duplicate proposal ownership or disable existing participation. The revised concept demonstrates this transition without connecting a wallet or submitting a vote.

## 4. Light, white and dark themes

The light theme retains the near-white working canvas and white surfaces you liked. The dark theme uses slate layers with equivalent information hierarchy. They share layout, spacing, interaction states, typography and component ownership. Dark mode is not an inverted screenshot or a return to glowing tactical panels.

### Theme choices and behavior

1. **System:** follow the device preference; the concept uses this initially when no preference exists.
2. **Light:** use the light/white theme regardless of device preference.
3. **Dark:** use the dark theme regardless of device preference.

The header control is available on both desktop and mobile, and Appearance in Settings exposes the same preference. The local prototype remembers the choice in browser storage and applies it before the page content renders. Changes in System mode follow device changes; an explicit choice takes precedence. Storage failure should not prevent the page from rendering.

### Semantic tokens

| Purpose | Light | Dark |
|---|---|---|
| Canvas | `#F4F4F9` | `#15191F` |
| Working surface | `#FFFFFF` | `#1D222A` |
| Primary text | `#2B303A` | `#EEF1F5` |
| Secondary text | `#59616B` | `#B8C1CC` |
| Primary action / link | `#5C6B73` | `#AAB8C1` |
| Text on primary action | `#FFFFFF` | `#182027` |
| Secondary surface | `#E9EBEF` | `#2A323D` |
| Essential input boundary | `#7B8692` | `#64717E` |
| Nonessential separator | `#DCE0E6` | `#394350` |
| Success text | `#27654E` | `#9ED4B7` |
| Warning text | `#80590B` | `#EDC67C` |
| Error text | `#A23732` | `#FFB5AE` |
| Code surface | `#252C36` | `#0C1118` |
| Code text | `#EDF0F4` | `#DAE5EE` |

Use token names throughout controls, dialog backgrounds, code blocks, selected navigation, charts, map annotations and empty/error states. Contrast must be checked against actual neighboring surfaces, including controls and focus indicators, rather than assuming a good body-text pairing makes every component accessible. Status always includes words or an icon alongside color.

### Themes across subdomains

The local workspace and Explorer share an origin, so their preview preference can stay synchronized. Production subdomains have separate origin-scoped storage. A value saved in `proxyhubb.com` localStorage is not automatically readable by `explorer.proxyhubb.com`. [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), [MDN same-origin guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).

Recommended first release: both default to System, and each remembers an explicit visitor choice on its own origin. A cross-surface link may optionally carry a strictly allowlisted **non-sensitive theme hint**, with an existing explicit destination preference taking precedence. A signed-in account preference can later provide consistent personalization through a deliberate API design. Broadening authentication-cookie scope just to share appearance is unnecessary.

## 5. What was missing from the first concept

There were three different kinds of gap. They should not all be labeled “feature unavailable.”

| Gap type | Examples | Correct response |
|---|---|---|
| Existing app feature, not fully represented in the concept | Checkout, access setup, wallet, security, provider configuration, messages, plans | Restore visible, task-specific design and review the existing integration |
| New design/interaction requiring contract validation | Durable checkout resume, cross-origin preferences, comprehensive exports, source freshness, verified client routing | Specify states and acceptance criteria; identify the data/service dependency |
| Capability incomplete or simulated in current source | Agent execution/payment; DePIN mock stake/claim UI; disabled globe | Keep out of core production claims; do not substitute a polished simulation for implementation |

Source code for a client function or page proves the feature has an implementation surface. It does **not** prove its deployment, backend, authorization and recovery behavior pass end-to-end checks. The feature inventory uses this limited meaning of “source present.”

The full inventory is in [FEATURE-COVERAGE.csv](FEATURE-COVERAGE.csv). It identifies ownership, specimen depth, implementation status, next work, priority and source evidence. This is the control document for ensuring the clean UI still exposes necessary features.

## 6. Workflows expanded in revision 2

### Marketplace and purchase

The revised market has functional sample saving, saved filtering, comparison selection, additional filters and understandable offer detail. The additional-filter preview includes maximum price, supported protocol and measured-latency selection. Matching is an optional refinement of visible filters, not an invented claim that an AI service selected the result.

The purchase preview now exposes quantity, session mode, per-GB price, USD reference, illustrative SOL amount, network and funding source. Changing quantity must update the visible example totals. Its result selector lets a reviewer inspect successful access, delayed provisioning, rejected wallet approval and a wrong-network case.

All financial values are visibly examples. The preview explicitly uses an invented conversion rate and never connects to a wallet. Production requires authoritative quotes, fees/rent where known, quote expiry and safe repeated-request behavior. The delayed-provisioning path keeps the order reference and demonstrates resuming the same purchase instead of paying again after a timeout.

### Connections and verification

Access detail includes masked/revealed example credentials, copying, cURL/Node.js/Python views, an extension-pairing design and a session-end design. The client tab must copy the matching snippet. Pairing is a separate state from routing; neither credentials nor an example pairing code proves a real browser request traversed the proxy.

A receipt connects the order, access, measured usage, cost, refund/settlement state, support conversation and public evidence link. Usage verification remains contextual. The explanation distinguishes an oracle-attested record from a zero-knowledge proof.

The specimen does not execute commands, start/stop an actual client, pair a real extension, create valid credentials, contact a seller, or perform a proof check. These require their existing services and integration verification.

### Activity and billing

Orders, Usage and Billing remain in Activity. Usage now includes an example chart with a textual equivalent and an example CSV download. The CSV is a browser-generated sample; production export coverage is a separate API/product decision.

Billing exposes Access Pass/plan entitlement and payment-history design rather than merely mentioning them in a descriptive paragraph. Preserve the distinction between NFT-style entitlements and recurring plans. Existing purchases, limits, history, supported change/cancellation and recovery paths need explicit screen states in implementation.

### Seller setup and supply management

The Add node preview is now a four-step sequence: build/OS, node configuration, installation, and heartbeat verification. It demonstrates published-build selection, scoped credentials and explicit readiness verification without pretending that a daemon was installed.

Node detail exposes diagnostics, advanced service configuration and credential management. The listing preview can save an example draft with a linked node, region and price. Drafts stay local to the specimen and do not publish real supply. Actual publication still depends on the current node readiness, validation and signature contracts.

Earnings keeps revenue, payouts and customers together. Advanced enterprise pooling remains reachable through eligible seller tooling, with its contributions, quotes, sessions and revenue scope tracked in the coverage inventory. It is not deleted simply because it is absent from the four primary labels.

### Account utilities and support

Settings is now a navigable view with Profile, Wallet, Security, Developer access, Notifications and Appearance. Wallet shows available linked funds, escrow and platform balance separately. Security preserves account sessions, two-factor authentication and recovery design. Developer access distinguishes buyer keys from provider/node credentials. Appearance operates the real preview theme preference.

The profile and notification examples modify preview state only. Security and credential dialogs describe the required workflow without creating or revoking real access. Invites/referrals remain a secondary utility. Admin/moderation remains a separate authorized surface rather than a regular seller menu item.

Inbox now has Notifications and Messages views; an order opens its conversation context. Example replies are drafts, with no delivery integration. Help offers task-specific guides, support-forum context, a contact-support design and access to the standalone Explorer. A real support destination remains an implementation dependency.

## 7. Standalone explorer screen requirements

### Overview

Lead with a visible public search and a compact summary of genuine network evidence. Define registered versus healthy nodes, measured bandwidth, indexed activity and operating environment. Show source limitations near the metrics, not only in a distant disclaimer.

The specimen intentionally shows partial writer evidence, unknown latency and pending records. The production design must remain understandable when sources disagree or a response is unavailable. Do not use a universal green Online/Optimal label as a fallback.

### Nodes

Offer table, map and ranking views of the same allowed public dataset. Comparisons use common metric definitions and observation windows. The map is a regional-evidence view; it is not an illustration of unmeasured network connections. Exact provider network identity remains protected according to the actual service contract.

The concept uses a schematic regional diagram with a clear label. A production geographic renderer still requires the selected map implementation, accessible list alternative, clustering/filter behavior and real data integration.

### Ledger and public lookup

Transactions, blocks, wallets and programs have linked, typed details. Search resolves supported public identifiers and handles not found, malformed input, stale source and service unavailable separately. Preserve typed deep links from existing URLs.

The revised explorer demonstrates local search for example transaction, block, node, wallet and contract records. It has normal URL navigation and browser Back behavior between its pages. Example IDs are conspicuously prefixed `demo-`; they are not represented as real transaction hashes.

### Analytics and health

Show value, unit, measured population, time window, source and last observation. A valid zero is different from no measurement. Indexing mode, quorum/writer health, stale data and public-feed eligibility must reflect the backend. Keep private operational dashboards and infrastructure secrets in Admin.

### Governance and treasury

Public proposal reading, outcomes, execution evidence and treasury aggregates belong here. Actual voting/creation uses a linked application task with real eligibility and authorization. Treasury data is not an individual's available balance. The concept demonstrates public reading and the transition to an action workspace, without signing.

## 8. Revised route ownership and migration

All 100 current page files remain mapped in [route-disposition-v2.csv](route-disposition-v2.csv). The v1 inventory is preserved. The revised destinations are proposed production paths, not deployed endpoints.

| Existing path family | Recommended destination |
|---|---|
| `/network`, `/explorer` | `https://explorer.proxyhubb.com/` |
| `/explorer/nodes` and node details | Explorer `/nodes` and `/nodes/[id]` |
| `/explorer/map` | Explorer `/nodes?view=map` |
| `/explorer/transactions` and details | Explorer `/transactions` and `/transactions/[hash]` |
| `/explorer/blocks` and details | Explorer `/blocks` and `/blocks/[number]` |
| Wallet/contract lookup and details | Explorer `/search` and typed `/address/[address]` |
| Explorer analytics/health | Explorer `/analytics` and health view |
| Leaderboards | Explorer Nodes ranking view |
| Public governance and proposal detail | Explorer `/governance` and `/governance/[id]` |
| `/governance/create` | Main app `/app/governance/new`, authenticated action |
| `/treasury` | Explorer `/governance/treasury` |
| Marketplace map, listing, purchase | Main application Marketplace; not the public infrastructure map |
| Private order, access, session and billing | Main application, preserving original permissions |

Do not activate cross-domain redirects until the explorer's target pages and data paths work. Preserve identifiers, valid query parameters, anchors where meaningful, referral context and allowed return paths. Resolve aliases directly to the final destination rather than adding redirect chains. Use temporary redirects during validation and the framework's supported permanent behavior only after paths are stable.

External tools and notification links can contain old URLs. Keep compatibility until consumers are migrated. Existing callbacks remain exact integration contracts. Never put private connection secrets into a public URL while trying to preserve a legacy deep link.

## 9. What still requires work before this is a complete interface

| Area | Remaining implementation and design work |
|---|---|
| Authentication and onboarding | Actual wallet session, safe return context, expired session, seller eligibility, necessary identity/compliance gates |
| Buying | Authoritative availability/quote, signing, confirmation, idempotency/resume, cancellation, dispute/refund, provisioning recovery |
| Using access | Actual credential eligibility/expiry, extension state, SDK integration, measured requests, supported session termination |
| Account | Live profile/security preferences, 2FA setup/recovery, key management, exports, balances and supported money rails |
| Selling | Real builds/configuration/credentials, heartbeat readiness, offer publication, customer workflows, earnings/payout reconciliation |
| Explorer | Separate app deployment, public source contracts, pagination/search/map integration, source freshness and rate/caching policies |
| Governance | Public records plus actual eligibility/signing/execution action flows, preserving existing rules |
| Support | Real forum/thread/moderation migration, message delivery, notification semantics, configured support contact |
| Quality | Light/dark component states, keyboard/screen reader/zoom, production performance baselines, route compatibility and E2E checks |

These are named work items for the implementation plan, not hidden assumptions behind a polished screen. Existing services should be reused where they meet the requirement. The current source already includes many of these surfaces; verify rather than rebuild them blindly.

## 10. Priorities for implementation planning

**First: make the foundation coherent.** Confirm route ownership, seller terminology, shared theme tokens, the four-destination workspace shell, the explorer boundary, and the feature coverage matrix. Keep capability policy and visible workspace state separate.

**Second: complete the buying-to-usage loop.** Browse/compare, purchase review, correct wallet/network, durable order recovery, usable credentials, supported client setup, measured traffic and the receipt. This is the highest-value hackathon story and the most important integration gate.

**Third: complete seller supply.** Application/readiness, guided setup, healthy node, signed publishable offer, observed usage and actual earnings/payout evidence. Do not let a “setup complete” UI bypass real heartbeat verification.

**Fourth: extract public inspection.** Launch the standalone explorer once the public routes, search/detail records, health/measurement states and migration links work. Verify that the main production build no longer carries explorer-only dependencies.

**Fifth: finish secondary workflows.** Account security and recovery, supported billing/entitlements, advanced seller tools, forum/messages, governance actions and administration need explicit migration gates. Existing obligations remain reachable until each replacement is complete.

The detailed plan should track design-ready, service-contract-ready, implemented, tested and shipped separately. “The preview opens” is not an acceptance criterion for a financial, credential or authorization workflow.

## 11. Review and validation criteria

- Both themes cover controls, fields, dialogs, tables, charts, maps, focus, disabled, warning, error, stale and empty states. Light mode keeps white surfaces; dark mode preserves hierarchy and readable contrast.
- System follows device preference; explicit Light/Dark persists; storage failure does not break rendering. Actual cross-subdomain behavior is validated separately from same-origin local preview behavior.
- Buyer and seller each expose four primary destinations at desktop and mobile widths. Account utilities and Explorer remain visibly reachable without a sitemap-style More menu.
- A purchase quantity changes totals; success, wrong network, rejected approval and funded-but-delayed access have different messages and recovery. A timeout never implies that paying again is safe.
- Credentials, client configuration, pairing, observed traffic and session end remain distinct states. Copy actions copy the selected example; production never logs secrets or places them in URLs.
- Explorer's shell has no buyer/seller switch, private wallet panel or private credential state. Evidence links preserve public identifiers and the originating private page stays usable.
- Search distinguishes record types; block and transaction details remain separate; missing data is not shown as zero or healthy. Public-feed flags and redaction behavior are preserved.
- Light/dark mobile views are checked at narrow sizes, with keyboard, focus restoration, document overflow and scrollable-table access. A static-token check is only one part of accessibility validation.
- The revised route inventory still covers every current page file. A future implementation must test old URLs, aliases, callbacks and direct links before redirect activation.

Validation results for the specimen are recorded in `REVIEW-CHECKS.md` after browser checks. They do not constitute an accessibility certification or production integration result.

## 12. Review guide

In the workspace, try the header theme selector, switch Buyer/Seller, open Marketplace, save/compare an offer, refine filters, and inspect purchase result states. In Connections, open access and switch client instructions. In Seller, walk through Add node or save an example listing draft. Settings, Inbox and Help now have their own view structures.

Open Explorer through its utility link or a receipt's evidence link. It has its own header and navigation. Try `demo-tx-1042`, `demo-node-gh`, or `demo-block-2814` in search; switch Ledger subviews; inspect Analytics health; and follow governance participation back to the application preview.

The deliverables remain design artifacts. No real transaction, message, credential, role change, DNS update or production deployment is performed by these examples.
