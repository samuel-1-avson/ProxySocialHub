# Frontend acceptance and dependency review

Review date: 29 October 2026. Scope: the web workspace, standalone Explorer, and Docs on current main, including the provider-app documentation change from PR #79. The other team's provider runtime is preserved.

## Result and changes

The four-destination Buyer/Seller architecture is present. Explorer remains a separate application and domain. Core buyer recovery, connections, billing, seller setup/publication, credentials, and payout controls are connected to their existing API clients. This review does not represent every legacy tool as redesigned or the funded settlement flow as accepted.

This patch removes the unused optional EVM bootstrap with the owner's explicit authorization. There were no EVM wallet controls or consumers of that context in the current interface. Solana wallet adapters, authentication, signing, and escrow APIs remain in place. RainbowKit, Wagmi, Viem, their WalletConnect tree, unused direct Zod, and obsolete build settings are removed.

The review also fixes:

- Duplicate Explorer redirect logic: middleware now shares the canonical resolver. Encoded identifiers are decoded and encoded once; malformed identifiers have a safe fallback; retired view redirects retain query context without capturing private workspace routes.
- Docs search metadata: the search index now uses the same YAML parser as document pages. CRLF input previously dropped titles/descriptions and showed filename slugs in search results.
- Docs keyboard behavior in Safari: closing mobile navigation restores the Menu button, and search triggers retain a focus destination when Safari does not focus a clicked button automatically.
- Docs architecture claims: the research whitepaper is clearly labeled as a draft in its title, navigation, and introduction. Local algorithm tests and proposed designs are distinguished from live deployment/settlement evidence.
- Marketplace evidence: a published listing no longer implies an active provider node. Validator membership no longer creates an unreported high-quality endorsement. Map quality/status values are explicitly reported observations, unknown status remains unknown, and the interface explains that a routed request is needed to establish live connectivity.

## Dependency findings

Full lockfile audits, including development dependencies:

| Application | Before | After |
| --- | --- | --- |
| Web | 66: 27 high, 36 moderate, 3 low | 9 moderate; no critical/high/low |
| Docs | 6: 1 critical, 5 high | 0 |
| Explorer | 0 | 0 |

Docs moves to Next 15.5.28 and next-mdx-remote 6 with JavaScript expressions blocked by default. The PostCSS override selects 8.5.23 or later. Web lockfile updates include patched TOML, UUID, the React Hooks linter's supported Zod 4 branch, and the Metro 0.84.6 patch family. Web and Docs production containers move from Node 20 to Node 22. The legacy Anchor API/IDL is retained to preserve transaction compatibility.

Relevant upstream advisories: [Next](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), [MDX](https://github.com/advisories/GHSA-g4xw-jxrg-5f6m), [PostCSS](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [TOML](https://github.com/advisories/GHSA-9qmh-m7c6-f92p), [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), and [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

### Unresolved vendor dependency

The nine moderate entries propagate from `stream-json` through `jayson` and the Solana SDK/adapters. These are not nine independent root vulnerabilities. The patched stream-json 3 API is incompatible with Jayson's required CommonJS 1.x module paths and streaming interface; an untested major override would break the SDK. No audit suppression or forced downgrade is used.

Both installed Solana web3.js entry points import `jayson/lib/client/browser`; that client serializes/parses JSON without importing the Node streaming parser. The affected Node parser is still installed transitively, so the full audit continues to report it. No application call to its streaming interfaces was found in this review. Keep this as a tracked vendor dependency until a compatible upstream fix or separately validated SDK migration is available. Advisories: [nested filter complexity](https://github.com/advisories/GHSA-528h-pc64-c93x), [JSONC parsing](https://github.com/advisories/GHSA-hqr4-qq8f-hg3x), [assembler prototype pollution](https://github.com/advisories/GHSA-mjw6-4jj6-33hc).

## Verification

| Check | Result |
| --- | --- |
| Production builds: web, Docs, Explorer | Passed |
| Web and Explorer TypeScript | Passed |
| Buyer/seller/workspace/live-data Chromium suite | 25 passed, no retries or skips |
| Marketplace/map/catalog/moderation/credential/agent Chromium suite | 23 passed on the map follow-up, no retries or skips; includes the new missing-quality regression |
| Docs/Explorer production Chromium + WebKit suite | 14 passed, no retries or skips after fixes |
| Actual Anchor/TOML/UUID compatibility regressions | 3 passed |
| MDX components, fenced examples, and expression-execution regression | 2 passed |
| Explorer redirect regressions | 8 passed |
| Marketplace publication/connectivity and validator/quality separation | 2 passed |
| Explorer public data boundary | 8 passed |
| SOL amount / submitted-signature preservation | 7 passed |
| Route registry/policy and wallet session contracts | Passed |
| ESLint on changed web configuration, middleware, resolver, and wallet boundary | Passed |

The map adapter and popup helper also pass ESLint. The map page retains three pre-existing `set-state-in-effect` findings on its unchanged filter/deep-link synchronization effects (lines 62, 132, and 141 on the initial release); this follow-up does not suppress them. Frontend/Docs CI uses Node 22 and includes the new SDK, map evidence, and MDX security regressions when GitHub Actions becomes available again.

Browser suites above use explicit API fixtures and prove interface behavior and integration contracts. They do not prove funded purchases, live traffic, node availability, or earnings. Production API checks and the real devnet acceptance run are recorded separately in the release receipt.

## Broader interface review

| Area | Assessment |
| --- | --- |
| Buyer/Seller navigation, themes, mobile account utilities | Present; covered by workspace/browser checks |
| Marketplace, real geographic map, offer review, order recovery | Connected; map/filter/checkout regressions pass; availability and price feeds remain API-dependent |
| Wallet, settings, security, usage/billing | Present; wrong-network funding, retained transaction recovery, preferences, and failure states tested |
| Seller node setup, scoped credentials, listing publication/edit/pause, payouts | Present; recovery, review, revocation, idempotency, and mobile layouts tested |
| Explorer public lookup, nodes/map, ledger, analytics, governance | Separate public service; privacy projection, typed lookup, reciprocal links, responsive empty states tested |
| Docs buyer/provider/API paths, search, theme, mobile navigation | Present; metadata, Safari focus, dependencies, and draft labels corrected here |
| API credentials, pools, account data, moderation, community tools | Reachable through utilities/advanced destinations; not all legacy screens have a complete interaction redesign |
| Catalog product editing and advanced provider operations | Still separate migration work beyond the core seller workflows; retain access rather than silently removing useful tools |
| Support submission | No real destination is configured; the existing interface must keep reporting that truthfully |
| Experimental execution/payments and protocol research | Keep experimental/draft labeling; require independent acceptance before presenting them as operational guarantees |

## Funded acceptance boundary

The staging API uses KMS signing and strict escrow/proof checks. Its configured private devnet RPC returned HTTP 429. The owner authorized temporary use of the official devnet endpoint. The scoped operation snapshots the original private runtime environment on the VM, preserves the immutable API image, KMS/security flags, mounts, ports and networks, and verifies that all other service containers remain unchanged. The original RPC setting must be restored after the run.

A new isolated devnet wallet signs the real nonce/login API; no JWT is forged and no database balance, role, provider heartbeat, listing, order activation, usage, or earnings is fabricated. The real program's executable account and the buyer's 10 GB default entitlement were confirmed. The RPC faucet is closed; funding uses the official Solana faucet with the owner's CAPTCHA participation. Purchase submission requires a healthy provider tunnel and a bounded devnet quote. Until real escrow confirmation, routed bytes, proof/settlement signatures, and seller earnings reconcile, this acceptance item remains incomplete.

At 21:59 UTC, the isolated buyer still had zero devnet SOL and both gateway pods reported zero healthy provider tunnels. The on-chain program was unpaused, its administrator matched the configured KMS oracle, and the oracle had sufficient devnet funds for transaction fees. No order or escrow transaction was submitted. The original RPC configuration was restored healthy at 21:50:41 UTC, with the original API image, full environment, and runtime invariants verified.

The public map still contains source-data issues, including a city/country conflict in one seller's inventory and legacy quality aggregates that do not establish current gateway connectivity. These require authoritative data/pipeline correction rather than invented frontend replacement values.

## Initial verified cloud release

PR #83 merged at `481a86e2e0ee138ec615809781cc45b02aa733a9`. Web and Docs were rebuilt from the verified Git archive and deployed healthy at 21:56:05 UTC. Both run Node 22.23.4. Explorer remained on its already-reviewed image; all other production service containers were unchanged during this frontend rollout. See [release receipt](releases/frontend-security-2026-10-29.json).

The candidate checked real marketplace API reads, private-route authentication, encoded/malformed Explorer redirects, Docs search titles, and draft labeling. An initial public HTTP 403 triggered automatic Web rollback; the retry used an identified release client and required HTTP 200 before success. Public browser review confirmed the live Docs changes, reciprocal navigation, and geographic marketplace map. The map evidence follow-up is recorded separately so the initial receipt is not overwritten.

## Release policy

GitHub Actions remains unavailable because of account billing. Use the completed native checks and a source-verified cloud build/candidate/health process. Do not run local Docker. Roll only reviewed frontend services, retain rollback images, and confirm reciprocal domains and live API reads after release. Do not replace the backend or the other team's provider runtime as a side effect of a frontend release.
