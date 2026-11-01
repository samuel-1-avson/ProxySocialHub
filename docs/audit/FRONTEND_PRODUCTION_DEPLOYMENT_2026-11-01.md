# ProxyHubb frontend production deployment

**Status:** deployed and live-checked 1 November 2026
**Target:** [https://proxyhubb.com](https://proxyhubb.com)
**Environment:** existing GCE `proxyhubb-testnet`, `us-central1-a`, project `gen-lang-client-0022105784` (Solana devnet)

## Release identity

| Item | Value |
|---|---|
| Source revision | `9c3969398a1e82250aa2ce724779d4c45350508e` |
| Release branch | `codex/frontend-production-20261101` |
| Image | `proxyhubb-production/web:9c3969398a1e82250aa2ce724779d4c45350508e` |
| Image digest | `sha256:ed7418c97a51e9b0934b3737af5d4e2b0807856b6f8309c13a9f179c90665e56` |
| GCP Cloud Build | `b1c37e29-ceb3-4d3f-8e54-a2b79b244678` — **SUCCESS** |
| Next.js build ID | `i5Ao8LucOY7rxqjku8TtG` |
| Build artifact | `gs://gen-lang-client-0022105784_cloudbuild/proxyhubb/releases/9c3969398a1e82250aa2ce724779d4c45350508e/web-image.tar` |
| Production web container | Healthy; restart count 0 |

The navigation update gives the landing, footer, workspace sidebar, and mobile workspace header one shared brand lockup, and aligns the workspace bar and selected navigation style with the landing header. It retains the workspace actions and routes.

The rollout replaced only the `web` Compose service. All 14 other running `proxyhubb-*` application containers were unchanged; a before/after comparison also found the exited migration container unchanged. The release retains the current devnet configuration, runtime secrets, and feature flags. No migrations, transactions, or messages were submitted.

## Production verification

The deployed page responses served the expected build ID and static assets. The live Playwright run checked 16 page combinations: `/`, `/marketplace`, `/login`, and `/help`, at 390px and 1440px in dark and light themes. All returned HTTP 200, had no horizontal overflow, uncaught page errors, or failed Next.js assets. The redesigned home heading was present in each run.

Automated axe WCAG 2.1 A/AA checks covered the landing page and populated marketplace at both widths in both themes: **8 scans, 0 violations**. The focused populated-marketplace accessibility Playwright suite also passed **2/2 tests** on this source revision. Protected `/app/connections` and `/provider` routes redirected to sign-in as expected.

| Live endpoint | Result |
|---|---|
| `/v1/listings?limit=1` | 200 |
| `/v1/system/config/public` | 200 |
| `https://api.proxyhubb.com/health` | 200; `{"status":"ok"}` |
| `/explorer` | 307 to `https://explorer.proxyhubb.com/` |
| `https://www.proxyhubb.com` | 301 to the apex domain |
| `https://app.proxyhubb.com` | 301 to the apex domain |

Machine-readable live results, [runtime receipt](./data/frontend-production-runtime-2026-11-01.json), and production screenshots are attached: [live route and accessibility results](./data/frontend-production-live-checks-2026-11-01.json), [mobile landing page](./previews/2026-11-01/production-landing-mobile.png), and [desktop landing page](./previews/2026-11-01/production-landing-desktop.png).

## Build and code checks

- GCP's optimized Linux image build completed successfully. The deployed pages confirmed the exact Next.js build ID and loaded their static assets.
- TypeScript passed on the final source revision. Route policy validation passed with 94 registry entries, 39 navigation keys, 104 policies, 11 dynamic prefixes, and middleware guard coverage.
- Earlier integration checks passed 31 contract cases and 32 distinct browser-regression cases. On this navigation revision, TypeScript passed, the optimized Linux image build succeeded, and all final live page/accessibility checks passed. The final live axe run also caught and resolved a workspace search-label mismatch before this release.
- `npm audit --omit=dev` reports zero critical and zero high advisories, with nine moderate wallet/SDK dependency advisories. See [dependency audit evidence](./data/frontend-production-dependency-audit-2026-11-01.json).
- Full repository lint remains red at 141 errors and 116 warnings. The changed-file comparison against the predeployment `main` baseline found no newly introduced errors (143 baseline errors across the compared changed files). Full lint cleanup remains open.
- GitHub Actions could not start a runner because of the repository's billing limit; the successful GCP Cloud Build supplied the production image instead. See [`MANUAL_CI_GATE.md`](../../MANUAL_CI_GATE.md).

## Rollback and operational scope

The rollout retained the immediately preceding web image for automatic health-check rollback:

`sha256:44450fab0341519b31157acd1918aa07bf27eee430b8435eacd73e97b1842cf2`

The web-only rollout checked container health and public HTTP health after replacement. The [deployment receipt](./data/frontend-production-runtime-2026-11-01.json) records the image digest, source revision, health, restart count, unchanged application container set, and rollback image. The previous fully checked redesign image also remains available as `sha256:35c1d4e540001ab6bef460d3ede24c2adeaaed309a6be915f05d687970b7e57e`; the original pre-redesign baseline remains available as `sha256:b4c876dc8cf34fc754f033df29474acbfe3634311472b6993abdf9dbe24d1d10`.

## Remaining acceptance work

The frontend release is live, but a deployment does not certify every business-critical flow. This verification did **not** sign into a real customer/provider account, exercise Google OAuth or a wallet extension, run provider-device pairing, send messages, or submit a funded purchase. The public API health, listing, and config reads passed, but authenticated messaging and the funded purchase → traffic → provider-earnings path still require the existing acceptance procedure on the intended network. The site remains configured for devnet; this deployment does not claim mainnet readiness.

The full lint backlog and nine moderate dependency advisories also remain open. Resolve SDK advisories through reviewed upgrades and regression coverage; do not force a downgrade. Perform keyboard/screen-reader and 200% zoom acceptance as part of the remaining human review.
