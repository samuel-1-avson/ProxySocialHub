# Google-created wallet overview — 4 November 2026

The managed-wallet redesign is live at `https://proxyhubb.com/app/wallet`. Activation completed at approximately 10:26 UTC. The signed-in Google account displayed its actual 5.00 SOL devnet balance and existing address; no funds were transferred as part of verification.

## User-facing changes

The address strip is replaced by a balance panel with refresh, receive details and an address QR code, copy feedback, a network-aware Solscan link, recent account activity, and managed-wallet information. Buyer and seller navigation leads to the existing marketplace or earnings pages. Mobile actions stack so the floating assistant does not obstruct the Activity action.

Balance and recent-activity queries are scoped to the signed-in account. Balance failures show a retry rather than an invented zero. Recent account records are explicitly distinguished from complete on-chain history. Devnet/testnet funds and receive addresses are labeled by network. Existing provider cash-out availability and external-wallet controls are retained. The UI does not add transfers, key export, or transaction signing.

## Release and provenance

- [PR #193](https://github.com/samuel-1-avson/ProxySocialHub/pull/193).
- Build source: `90f902d579f3dd7d7b806aade0d8ed9828fe9031`.
- Review source on the repository's current main history: `526c02f34900fc3d3ce9d4b271f259da0f430f1c`. Its complete tree was verified identical to the build source: `5d7b8d07c968b556fa3e38c3376bffa176e90fab`.
- [Successful Cloud Build](https://console.cloud.google.com/cloud-build/builds/bc095800-74e6-4425-9398-ec0bf9654b04?project=gen-lang-client-0022105784).
- Registry image: `us-central1-docker.pkg.dev/gen-lang-client-0022105784/proxyhubb-releases/web@sha256:63955a6fc6a445322e2824f425491fbead6764a8dea226cf0912f380362489e6`.
- Live image: `proxyhubb-production/web:90f902d579f3dd7d7b806aade0d8ed9828fe9031`; image ID `sha256:41919a2cb79ea38e6d95d5e45acae21060f0898f0b75337ff857d7e7faf3adf9`.
- Persistent overlay: `/opt/proxyhubb/frontend-releases/web-90f902d579f3dd7d7b806aade0d8ed9828fe9031/compose.yml`.

The build retained the runtime Google configuration fix, deliberately omitted the build-time public client ID, and passed runtime enabled/disabled configuration assertions on the production image. No private model credential was baked into the image.

## Verification

Eight Chromium wallet scenarios passed: balance refresh, exact copied address, receive dialog and focus restoration, RPC failure/recovery, recent activity and ledger navigation, clipboard-denial feedback, mobile light/dark accessibility checks, and the external-wallet interface. The two mobile theme scenarios passed again after the final action-layout adjustment, including receive-dialog dismissal and the Activity action. The new component had no WCAG A/AA violations in the scoped mobile scans and no horizontal overflow at 390px. TypeScript, focused ESLint, diff checks, and the Linux production compilation passed.

Live browser inspection verified the existing managed wallet's 5.00 SOL balance, public address, devnet Solscan link, recent-activity empty state, and receive dialog with the matching address, QR code, and network guidance. The receive dialog was closed without submitting a transaction. Activity opens the existing account ledger.

The web container is healthy with zero restarts. All 14 other container IDs and all other web environment values were preserved. The API and wallet custody configuration were unchanged. `/login`, `/register`, runtime Google configuration, and auth capabilities return HTTP 200; Google sign-in and managed-wallet sign-up remain enabled.

The browser continues to report errors from the pre-existing WebSocket connection. The wallet balance read and automatic RPC refresh worked, and account activity is fetched over HTTP. This UI release does not claim to repair the existing WebSocket transport.

## Rollback

Root-only metadata: `/var/backups/proxyhubb-google-wallet-ui/90f902d579f3dd7d7b806aade0d8ed9828fe9031/before-private.json`. This contains credentials and must not be published. The safe `verification.json` records the image, revision, health, unchanged environment comparison, and retained containers.

Previous frontend image ID: `sha256:023b4bf568f467a29628c79248eb17a7c4aa10e106715c4f5c5e570501bc6a99`. Restore only the web image through the existing overlay chain if needed. No database migration or on-chain transaction was required.
