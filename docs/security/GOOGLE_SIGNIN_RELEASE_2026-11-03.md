# Google sign-in production configuration — 3 November 2026

The supplied web OAuth Client ID was configured in the production API and compiled into a new production web image. Activation completed at 15:49:21 UTC. The API and web container are healthy with zero restarts; all 13 other containers, including both TLS gateways, retained their container IDs. No database migration or on-chain transaction was needed.

The public Client ID is `118162087568-nqlmg2ksmh6hhg2todk55r3ofcv97nvo.apps.googleusercontent.com`. The current Google Identity Services popup and backend ID-token verification flow uses this ID without a client secret. No Google password, client secret, or service-account private key was requested or added.

## Release provenance and persistence

- Web source revision: `e7f77e21b1cc1b5827b47d2bdb8b5418332b6b0a`. Application source matches the preceding verified security release; the source change forwards the repository's public `GOOGLE_CLIENT_ID` variable into subsequent GitHub frontend builds.
- [Successful Cloud Build](https://console.cloud.google.com/cloud-build/builds/7fd749af-520c-472c-a466-ae3339bba37e?project=gen-lang-client-0022105784).
- New web image: `us-central1-docker.pkg.dev/gen-lang-client-0022105784/proxyhubb-releases/web@sha256:40891694de5103c4e09e1fbeaa1efafb1b2c9e7dbfa1f01d908a048429b0f15f`.
- API image retained: `us-central1-docker.pkg.dev/gen-lang-client-0022105784/proxyhubb-releases/control-api@sha256:350540f5fbb85f5a5c4b6b49a69ce5e673834fd57de7bd5b483a5782353add86`.
- OCI source label and the Client ID's presence in the compiled browser chunks were verified before activation.
- The API's `GOOGLE_CLIENT_ID` and frontend's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` are persisted in the host's root-only environment and pinned release override at `/etc/proxyhubb/releases/privacy-20261103.compose.json`. The same public ID is stored as the GitHub repository variable `GOOGLE_CLIENT_ID` for future builds.
- Root-only rollback files: `/var/backups/proxyhubb-google-signin/20261103T154836Z`. These include the preceding environment, pinned override, and running container metadata. No unrelated runtime environment values were changed.
- The dedicated builder received read access only to this source archive via an object ACL. That grant was removed after the build completed. An attempted bucket IAM condition was rejected because the shared bucket lacks uniform access; the bucket's access mode and IAM policy were not changed.

## Live checks

The API capabilities endpoint reports `google_sign_in=true`, `managed_wallet_signup=true`, and private defaults through the loopback API, public API hostname, and frontend rewrite. A deliberately malformed Google token submitted through the public frontend was rejected with HTTP 401; no production user, identity, or wallet was created by that check.

Both `/login` and `/register` return HTTP 200. Browser inspection confirmed the Google sign-in and sign-up controls render, alongside the existing wallet flow. The register control renders on the client, so its absence from initial server-rendered HTML is expected. The final verification accounts for that distinction.

The initial real-browser check reported `[GSI_LOGGER]: The given origin is not allowed for the given client ID.` The user then added `https://proxyhubb.com` to the client's Authorized JavaScript origins and saved. A fresh browser session loaded the live Google sign-in control without that Google Identity Services error. This popup implementation requires no OAuth redirect URI. The Google Cloud Console could not be edited by the agent because its JavaScript resources failed to load on the available network; the origin update was performed by the user.

The HSM synthetic DEK wrap/recovery probe passed inside the running API. Discovery still returns exactly the healthy primary TLS operator; insecure remote operators remain disabled, and the certificate timer remains active. Solana remains on devnet with existing treasury, oracle, and encryption settings preserved.

A real Google account sign-in and first-account creation were not performed by the agent. The final user-facing check is to sign in at https://proxyhubb.com/login with the intended Google account. Google's audience/testing/publishing settings still determine which Google accounts can authorize the client.

Deployment artifacts, the build result, source-access cleanup, application verification, and browser findings are retained in the session's `production-deploy` artifact directory. GitHub Actions remains subject to the previously observed account billing lock; Cloud Build produced this verified image.
