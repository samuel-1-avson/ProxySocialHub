# Google sign-in runtime configuration — 4 November 2026

The production frontend was deployed at approximately 09:54 UTC with Google sign-in and sign-up visible. The preceding image omitted `NEXT_PUBLIC_GOOGLE_CLIENT_ID` at build time, so the UI compiled out both controls even though the running API's Google client ID and managed-wallet readiness were configured correctly.

## Change and release

The frontend now reads the public OAuth client ID from `/api/auth/google-config`. This dynamic endpoint returns only `clientId` with `Cache-Control: no-store`. The running web service receives `GOOGLE_CLIENT_ID`; legacy `NEXT_PUBLIC_GOOGLE_CLIENT_ID` remains a fallback. Account pages share the runtime query, show Google alongside wallet access, and expose retry actions for configuration and external-script failures.

The Compose web definition includes the runtime variable. `gcp-roll-web-image.sh` obtains the public client ID from the running API, persists it in the new release overlay, and verifies the public configuration before accepting the rollout. The existing authentication/model configuration guard remains active.

- Application source: `206f1a00009b14fd72932a643a66839c875ec040`, branch `codex/google-signin-runtime`.
- [PR #192](https://github.com/samuel-1-avson/ProxySocialHub/pull/192).
- [Successful Cloud Build](https://console.cloud.google.com/cloud-build/builds/47ee4c65-9057-452d-b40f-7dfe859b529c?project=gen-lang-client-0022105784).
- Registry image: `us-central1-docker.pkg.dev/gen-lang-client-0022105784/proxyhubb-releases/web@sha256:5f8b911fe65fc25b7e4187170936be719962a6fe0dd7c1c761082622d3d06b57`.
- Live image: `proxyhubb-production/web:206f1a00009b14fd72932a643a66839c875ec040`; local image ID `sha256:023b4bf568f467a29628c79248eb17a7c4aa10e106715c4f5c5e570501bc6a99`.
- Persistent overlay: `/opt/proxyhubb/frontend-releases/web-206f1a00009b14fd72932a643a66839c875ec040/compose.yml`.

The build deliberately supplied an empty `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. The built container was started twice: once with a runtime client ID and once with an empty ID. Both endpoint assertions passed, demonstrating that a build without the public variable no longer prevents runtime configuration.

## Verification

- Eight Chromium application-flow tests passed: runtime configuration on both account pages, the real configuration endpoint's response shape/cache policy, simulated Google credential/session establishment without wallet connection, rejected credentials, wallet fallback, script failure/retry, and configuration failure/retry. Google responses are explicitly simulated in these deterministic tests.
- Local TypeScript, focused ESLint, Bash syntax, and diff checks passed. The Linux production build also passed compilation and TypeScript checking.
- The production web container is healthy with zero restarts. The other 14 containers retained their IDs; all pre-existing web environment values were preserved except the newly supplied public Google client ID. The API container and its Google audience were unchanged.
- `/login`, `/register`, `/api/auth/google-config`, and `/v1/auth/capabilities` return HTTP 200. Runtime client ID matches the API. Capabilities report both Google sign-in and managed-wallet sign-up available.
- A deliberately invalid token sent through the production `/v1/auth/google` route returned HTTP 401 with the expected sign-in error. This did not create a production account or wallet.
- Real Google-hosted controls render on both live account pages. In installed Brave, clicking the sign-in control opened Google's account chooser for `proxyhubb.com` with the expected client ID and origin. No account was selected by the agent.
- The embedded test browser could render Google's button but its FedCM request failed with a network error. The installed browser's normal Google popup reached the account chooser successfully. The account-specific Google consent and completed production session require the user to finish sign-in.

GitHub Actions jobs did not start: the check annotation states that the account is locked due to a billing issue. Cloud Build and the local checks supplied the deployment validation; GitHub CI is not recorded as passing.

## Rollback

Root-only original container metadata is retained at `/var/backups/proxyhubb-google-runtime/206f1a00009b14fd72932a643a66839c875ec040/before-private.json`; it contains credentials and must not be published. The safe `verification.json` records the live revision, image ID, health, preserved containers, and environment comparison.

Previous frontend image ID: `sha256:fa284fd4f63a0f87d19e0e3efc6a1a25efe4c053c1f21a6c2cdd92fe31a619cc`. A rollback should change only the web image using its existing Compose overlay chain. No database migration, wallet operation, or on-chain transaction was part of this release.
