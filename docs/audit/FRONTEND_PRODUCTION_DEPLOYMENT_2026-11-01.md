# Frontend production release — 1 November 2026

Status: release candidate validated locally; Linux image build and production verification pending.

The release applies the frontend redesign to current `main` (`b5f47bfb501896884cab41917cbe66b12c900a6c`), preserving its newer checkout guards, managed-wallet support, provider pairing/signing, extension connection, and dedicated Explorer host. The original redesign and its 84 staged browser checks are historical evidence; the combined release is being checked separately.

Target: https://proxyhubb.com on GCE `proxyhubb-testnet`, `us-central1-a`, project `gen-lang-client-0022105784`. Roll only the `web` Compose service. Retain existing runtime secrets and the Solana devnet configuration. No database migrations or backend rollout.

## Release checks

- Clean dependency installation, TypeScript, and optimized Next.js 16.4.3 production build passed.
- Route validation passed: 94 registry entries, 39 navigation keys, 104 policies, 11 dynamic prefixes, and middleware guard coverage.
- 31 contract tests passed, including listing signatures, wallet transfers, framework/native compatibility, and dedicated Explorer redirects.
- Production dependency audit: zero critical, zero high, nine moderate advisories.
- Full lint remains red (141 errors, 116 warnings); baseline comparison against current main is recorded separately.
- Browser regressions, Linux image build, and live checks: pending.

GitHub Actions is currently blocked before runner startup, as documented in `docs/MANUAL_CI_GATE.md`. Use GCP Cloud Build for the Linux image, then the repository's web-only archive rollout with automatic health-check rollback.

## Rollback baseline

Before rollout, the web container was healthy, serving HTTP 200. The API health endpoint returned `{"status":"ok"}`.

- Image: `sha256:b4c876dc8cf34fc754f033df29474acbfe3634311472b6993abdf9dbe24d1d10`
- Reference: `proxyhubb-production/web:2bcae024098485ee389eee621053f1e59f32faac`
- Previous source: `2bcae024098485ee389eee621053f1e59f32faac`
- Previous build ID: `pRp72SXn-V0iEh80oflcB`

The rollout script retains this image and restores it if container or public health checks fail. Public feature flags observed before release were disabled; they remain disabled. The independent Explorer service is an existing separate deployment.

Deployment does not constitute mainnet certification. Funded payments, Google OAuth, authenticated account operations, and provider device pairing require their existing live acceptance process; no real transactions or messages are part of the deployment smoke checks.
