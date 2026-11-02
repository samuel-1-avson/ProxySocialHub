# System verification, 2026-11-02

A full check of the product the hackathon submission rests on, run on `main` at `cfa4f244`
(everything deployed to testnet that day) plus the commits in the PR that carries this file. GitHub Actions is billing-locked, so none of this ran in CI: it was run by hand, on
a Windows machine, and every number below comes from a run recorded during the session.

Nothing here buys, signs or spends. Live checks were read-only and unauthenticated.

## Result in one table

| Area | What ran | Result |
| --- | --- | --- |
| Regional Auditor worker | `npm test` (typecheck + 201 tests) | **201 / 201** |
| Regional Auditor with the **real Meta model** | 15 labelled cases, one full pass (`npm run eval -- --repeat 1`) | **11 / 11** seeded defects found, **0 / 6** false alarms on controls (incl. 2 prompt-injection pages), 100% of findings supported by evidence, job p50 12 s, about $0.25 |
| Auditor through the real web UI + real model | `e2e/audits-fullstack.spec.ts`: create, inspect evidence, apply the fix, rerun, compare, export | **passed** (46 s) |
| Audits UI (mocked API, incl. WCAG scan, keyboard, mobile) | `e2e/audits.spec.ts` on Chromium | **25 / 25** |
| MCP server | typecheck + 21 tests; plus a live stdio run against the production API | **21 / 21**; live: 6 tools, real data, clean refusals without an account |
| Control API (Go) | `go vet ./...`, `go test ./...` on a **real PostgreSQL 14 (UTF-8)** built from the production migrations | **45 / 45 packages**, 0 failures |
| Provider node (Rust) | `cargo test` | **83 / 83** |
| Edge gateway (Rust) | `cargo test` | **209 / 209** |
| Browser extension | `npm test` | all suites ok |
| Web app | typecheck, route policy (106 routes), 13 unit/contract scripts, production build | all pass |
| Buy flows, map buy, order credentials, workspace, login/register | Chromium, WebKit, Mobile Chrome, Mobile Safari (earlier the same day) | pass on all four |
| Production dependencies | `npm audit --omit=dev` (web, auditor, MCP, extension) | **0 critical, 0 high** (9 moderate in the web app) |

## Live testnet (read-only)

| Check | Result |
| --- | --- |
| 38 public pages on proxyhubb.com | all 200 or an intended redirect (the explorer lives on explorer.proxyhubb.com); unknown paths give the branded 404 |
| API public endpoints | listings, facets, map answer; bad ids give 400/404; slowest 2.3 s (cold) |
| API protected endpoints (auth, orders, wallet, sessions, provider nodes) | 401 with a clean JSON body and no internal detail |
| Admin API | 410 "disabled" (the safe state) |
| CORS | allows `https://proxyhubb.com`, nothing for another origin (on the API) |
| Gateway `proxy.proxyhubb.com:8090` | refuses an unauthenticated CONNECT with `407` and a Basic challenge |
| Certificates | all valid; 48 days (Cloudflare) and 55 days (gateway) left |
| Marketplace country data | GH 3, **no US** (the Ghana node is no longer counted as US) |
| Auditor pre-flight (gateway, target, GeoIP, Meta key, Chromium, storage) | all green except "no US supply", which is true |
| Provider CLI downloads | Windows and Linux v1.0.11, macOS **v1.0.6** (older), no Linux ARM; each file is reachable, its size matches the published metadata and a SHA-256 is published (the file hashes were not recomputed) |
| Supply | **all 10 provider nodes are offline**; the three Ghana listings still show as purchasable |

## Browser suite: 245 tests on Chromium

First full run: 153 passed, 71 failed, 12 skipped, 9 not run. Three of the failures passed on a quiet rerun
(load flakes). The other 68 are **old**: the eight files that could plausibly be regressions were run on
`cadc584d` (#123, before any of this week's changes) and fail the same way (28 there, 27 at HEAD).

| Failing group | Tests | Why |
| --- | --- | --- |
| `social/*` (friends, messaging, notifications, accessibility) | 37 | every test logs in with an email/password form; the app has wallet (and optional Google) sign-in only |
| `features.spec.ts` | 6 | seeds an old mock login, so wallet/security pages bounce to the login page |
| `provider-wallet-session.spec.ts` | 5 | last edited in May; the texts it expects exist nowhere in the app any more |
| `frontend-completion`, `frontend-details`, `frontend-route-review`, `governance-ui`, `explorer` | 14 | acceptance specs for the retired embedded Explorer and governance pages; also fail on #123 |
| `governance.smoke.spec.ts` | 2 | needs a control API on localhost:18080 |
| `route-policy.spec.ts` | 2 | expects `/dashboard?error=...`; middleware redirects to `/403` |
| `auth.spec.ts` | 2 | **fixed in this PR** (expected "Select Wallet" / "Initialize account") |

`marketplace-browse-buy` (first test of its file) failed twice right after the build cache was deleted
and passed 6 of 6 warm: a cold dev server compiling the order page for more than 30 s, not a product bug.

## Found and fixed in this PR

1. `test:listing-signer` was broken by #125 (a runtime `@/` import that plain Node cannot resolve); the test now loads the module through a vm loader.
2. The website sent no security headers; it now sends `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy` and HSTS (verified on a production build).
3. `auth.spec.ts` brought in line with the current pages.

## Found and not fixed

* **Offline supply shows as buyable.** The map's `purchasable` is `status == active && bandwidth > 0` and ignores whether the node is online. A buyer can pay for a listing whose node is offline.
* `npm run lint`: 141 errors in 83 files (explorer and provider pages: `any` types and React-hooks rules). None are in files changed since #125.
* `/api/*` in `next.config.ts` sends `Access-Control-Allow-Origin: *` together with `Allow-Credentials: true`. Browsers refuse credentialed requests with a wildcard, so the practical risk is low, but it should be tightened once the extension's needs are known.
* macOS provider builds are two versions behind (they are built in CI, which is locked).
* Probing the public `POST /v1/provider/pair/start` created one pairing row on testnet; it expires in 10 minutes.

## Not verified

* A live audit through **two real regional exits** (needs a second-country provider online and orders bought with a wallet). The first real audit covered Ghana only.
* A real wallet purchase and the real escrow funding path (the buy flows are tested with the suite's mocked purchase).
* Real GeoIP behaviour through a real exit beyond the Ghana run; the satellite-network rule is covered by unit tests and a live lookup, not by a real Starlink exit.
* The Anchor program tests and anything needing a Solana toolchain.
* WebKit and mobile for the whole suite (only the demo-critical specs were run on those).
