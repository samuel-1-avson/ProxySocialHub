# ProxyHubb frontend production deployment

**Status:** deployed and live-checked 1 November 2026
**Target:** [https://proxyhubb.com](https://proxyhubb.com)
**Environment:** existing GCE `proxyhubb-testnet`, `us-central1-a`, project `gen-lang-client-0022105784` (Solana devnet)

## Release identity

| Item | Value |
|---|---|
| Source revision | `10dd9ed3fb63ebfdb85cc5cb30854647506792d2` |
| Release branch | `codex/frontend-production-20261101` |
| Image | `proxyhubb-production/web:10dd9ed3fb63ebfdb85cc5cb30854647506792d2` |
| Image digest | `sha256:47128aa1e9be884bf749dbad15bf88c87eb9a8d3f181d0db727f8ce8f1443215` |
| GCP Cloud Build | `684b8813-5bb2-4d45-8b4d-9c0e3aecc653` — **SUCCESS** |
| Next.js build ID | `wSvGQP0DJD2p9zXRoOiGk` |
| Build artifact | `gs://gen-lang-client-0022105784_cloudbuild/proxyhubb/releases/10dd9ed3fb63ebfdb85cc5cb30854647506792d2/web-image.tar` |
| Production web container | Healthy; restart count 0 |

The workspace header now renders the exact same `ModeToggle` component as the landing page: a 40px sun/moon button, with no theme dropdown in the bar. The System/Light/Dark selector is available inside the account menu. The landing, footer, workspace sidebar, and mobile header continue to use one shared brand lockup.

The rollout replaced only the `web` Compose service. All 14 other running `proxyhubb-*` application containers were unchanged; a before/after comparison also found the exited migration container unchanged. The release retains the current devnet configuration, runtime secrets, and feature flags. No migrations, transactions, or messages were submitted.

## Production verification

The live Playwright run checked `/` and `/marketplace` at 390px and 1440px in both themes, plus a 320px mobile flow. Every header had exactly one 40px theme icon button and zero select controls. All eight page/theme combinations returned HTTP 200, served the exact deployed build ID, and had no overflow, uncaught page errors, or failed Next.js assets.

Automated axe WCAG 2.1 A/AA checks covered both pages at both widths in both themes: **8 scans, 0 violations**. The 320px live flow switched to light mode, reloaded to confirm persistence, then selected the system preference in the account menu. The workspace header remained free of select controls and overflow.

| Live endpoint | Result |
|---|---|
| `/v1/listings?limit=1` | 200 |
| `/v1/system/config/public` | 200 |
| `https://api.proxyhubb.com/health` | 200; `{"status":"ok"}` |
| `/explorer` | 307 to `https://explorer.proxyhubb.com/` |
| `https://www.proxyhubb.com` | 301 to the apex domain |
| `https://app.proxyhubb.com` | 301 to the apex domain |

Evidence: [current live navigation checks](./data/frontend-production-navigation-checks-2026-11-01.json), [runtime receipt](./data/frontend-production-runtime-2026-11-01.json), [desktop dark header](./previews/2026-11-01/workspace-navigation-desktop-dark.png), [desktop light header](./previews/2026-11-01/workspace-navigation-desktop-light.png), [mobile dark header](./previews/2026-11-01/workspace-navigation-mobile-dark.png), and [320px light header](./previews/2026-11-01/workspace-navigation-320-light.png). The [earlier general public-route checks](./data/frontend-production-live-checks-2026-11-01.json) remain as evidence for their recorded source revision.

## Build and code checks

- GCP's optimized Linux image build completed successfully. The deployed pages confirmed the exact Next.js build ID and loaded their static assets.
- TypeScript and targeted ESLint passed for the changed component and browser files.
- Four focused Chromium checks passed on this source: buyer/provider navigation, theme switching/persistence/mobile layout/account preference, and populated-marketplace accessibility in each theme. These checks include an explicit assertion that the header has no dropdown.
- Earlier integration checks passed 31 contract cases and 32 distinct browser-regression cases. Earlier route validation passed with 94 registry entries, 39 navigation keys, 104 policies, 11 dynamic prefixes, and middleware guard coverage. This correction changes no routes or dependencies.
- `npm audit --omit=dev` reports zero critical and zero high advisories, with nine moderate wallet/SDK dependency advisories. See [dependency audit evidence](./data/frontend-production-dependency-audit-2026-11-01.json).
- The previously recorded full-repository lint baseline is red at 141 errors and 116 warnings. This correction passed targeted lint; a full-repository rerun was not performed. Full lint cleanup remains open.
- GitHub Actions could not start a runner because of the repository's billing limit; the successful GCP Cloud Build supplied the production image instead. See [`MANUAL_CI_GATE.md`](../../MANUAL_CI_GATE.md).

## Rollback and operational scope

The rollout retained the immediately preceding web image for automatic health-check rollback:

`sha256:ed7418c97a51e9b0934b3737af5d4e2b0807856b6f8309c13a9f179c90665e56`

The web-only rollout checked container health and public HTTP health after replacement. The [deployment receipt](./data/frontend-production-runtime-2026-11-01.json) records the image digest, source revision, health, restart count, unchanged application container set, and rollback image. The previous fully checked redesign image also remains available as `sha256:35c1d4e540001ab6bef460d3ede24c2adeaaed309a6be915f05d687970b7e57e`; the original pre-redesign baseline remains available as `sha256:b4c876dc8cf34fc754f033df29474acbfe3634311472b6993abdf9dbe24d1d10`.

## Remaining acceptance work

The frontend release is live, but a deployment does not certify every business-critical flow. This verification did **not** sign into a real customer/provider account, exercise Google OAuth or a wallet extension, run provider-device pairing, send messages, or submit a funded purchase. The public API health, listing, and config reads passed, but authenticated messaging and the funded purchase → traffic → provider-earnings path still require the existing acceptance procedure on the intended network. The site remains configured for devnet; this deployment does not claim mainnet readiness.

The full lint backlog and nine moderate dependency advisories also remain open. Resolve SDK advisories through reviewed upgrades and regression coverage; do not force a downgrade. Perform keyboard/screen-reader and 200% zoom acceptance as part of the remaining human review.
