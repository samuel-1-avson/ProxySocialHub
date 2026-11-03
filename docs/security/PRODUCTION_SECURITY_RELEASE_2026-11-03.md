# Production privacy and custody release — 3 November 2026

The public application at https://proxyhubb.com was deployed and verified on the existing GCE primary host. Activation completed at approximately 14:55 UTC; the full live verification passed at 15:01 UTC. This release does not change the application's Solana devnet network, treasury or oracle identities, or deploy an on-chain program.

## Running release

Project: `gen-lang-client-0022105784`. Host: `proxyhubb-testnet`, zone `us-central1-a`. Source checkout: `65a49212e89d906fad353db10d1d7455f6c1fa4f`. Only the web app, control API, and two colocated gateway containers were recreated; all 11 other running containers retained their container IDs.

Images are pinned by digest in `/etc/proxyhubb/releases/privacy-20261103.compose.json` on the host. This file contains resolved runtime configuration and must remain root-only. Use it with all four existing Compose files and project name `proxyhubb`; targeted future rolls must preserve the independent docs, explorer, provers, database, monitoring, and other services. Do not use a full-stack `--remove-orphans` rollout.

| Service | Source revision | Artifact Registry digest |
| --- | --- | --- |
| control-api | `65a49212e89d906fad353db10d1d7455f6c1fa4f` | `sha256:350540f5fbb85f5a5c4b6b49a69ce5e673834fd57de7bd5b483a5782353add86` |
| web | `c6a907aeb3ddfe03e266e8fda1460649e718e1f3` | `sha256:87d4f55aceebd06edf1e211290406dd2b2ff06d1ab29222aa652da56a5b8b6b2` |
| edge-gateway (both local pods) | `c6a907aeb3ddfe03e266e8fda1460649e718e1f3` | `sha256:4e87ee8537e1da97f1e79c7b8b86600e0a057ee795da29f34530cb1da03531e0` |

Images live under `us-central1-docker.pkg.dev/gen-lang-client-0022105784/proxyhubb-releases/`. OCI revision labels were verified before activation. The later API change adds persistent operator disable settings; its SQL migrations and migration startup code match the rehearsed common revision.

GitHub Actions jobs could not start because the account was locked by a billing issue. Real Linux images were built successfully with Cloud Build using a dedicated release builder:

- [Common three-image build](https://console.cloud.google.com/cloud-build/builds/8560d54f-15fb-48a3-902b-2051d332d7ea?project=gen-lang-client-0022105784).
- [Final API build](https://console.cloud.google.com/cloud-build/builds/5e44edb3-296c-4b09-8c92-7f5efd181ee8?project=gen-lang-client-0022105784).

The temporary builder grant to read the Cloud Build source bucket was removed after both builds completed. The dedicated builder retains repository-scoped image writer and log writer access for subsequent releases.

## Custody and privacy

The API uses the HSM key `projects/gen-lang-client-0022105784/locations/us-central1/keyRings/proxyhubb-embedded-production/cryptoKeys/wallet-dek`, with 90-day rotation. The VM impersonates `proxyhubb-custody-production@gen-lang-client-0022105784.iam.gserviceaccount.com`; that identity has encrypt/decrypt access on this key, without key administration. A live IAM permission probe returned only `useToEncrypt` and `useToDecrypt` from the tested cryptographic and administrative permissions. No service-account key file was created. The VM's pre-existing project Editor role remains unchanged and is a separate infrastructure hardening concern.

The final API's `/custody-check` performed a synthetic DEK wrap and recovery successfully both before activation and inside the running container. No wallet was created and no funds were moved for verification. The existing embedded-wallet inventory was empty, so no private-wallet-key rewrap was needed. Managed custody remains operator-held: transaction signing decrypts keys in application memory, as disclosed by the live capabilities endpoint.

The live privacy migration installed all four profile controls. Verification found zero profiles opted into public profiles, map visibility, or optional analytics. Both enabled MFA accounts have encrypted `ENC:` seeds. Existing encryption, JWT, session, token, treasury, and oracle settings were preserved. External geolocation, public topology, P2P signaling, and gateway debug routes are disabled. Legacy browser tokens without a server session require sign-in again.

Google OAuth credentials are not configured, so Google sign-in remains unavailable. The live capabilities endpoint truthfully reports `google_sign_in=false`, `managed_wallet_signup=true`, private defaults, and TLS buyer transport.

## TLS and routing

Buyer ingress is `https://proxy.proxyhubb.com:8090`. Both local gateway pods require TLS. Management and authenticated internal peer traffic use container port 8091, which is not published on the host; ordinary CONNECT and absolute-URI proxy requests are rejected on that private listener. The two pods share one physical primary host and do not establish independent-host failover.

The stale `edge-b` remote operator remains disabled through `GATEWAY_OP_B_STATUS=disabled` while preserving its original host identity. Live inventory also found `edge-ext` and `edge-org3` advertising plaintext HTTP; their registry rows were backed up and disabled. No remote VM was shut down or reassigned a false local host identity. Public discovery was verified to return exactly one healthy operator: `edge-a`, with the trusted HTTPS endpoint. Remote operators must receive valid hostnames, certificates, and verified TLS deployments before re-enablement.

Buyer certificate material is copied from Caddy's existing certificate into root-only `/etc/proxyhubb/buyer-tls`. A persistent helper at `/usr/local/libexec/proxyhubb/sync-buyer-certificates.py` validates hostname, validity, and key match before atomic replacement. The active `proxyhubb-buyer-cert-sync.timer` checks every 12 hours and rolls local gateways only when the certificate changes. It shares the release lock at `/run/lock/proxyhubb-security-release.lock`. Existing provider-tunnel certificates were preserved.

## Backup, rehearsal, and rollback

Root-only backup: `/var/backups/proxyhubb-security/20261103T134443Z`.

- PostgreSQL custom-format dump: 617,497,775 bytes; SHA-256 `b53157af1f8734a88e9243e1f024be38c0ca2ef759a0c39e72f38a151d8cb96c`.
- Dump inventory verified; the complete backup was restored into a temporary database, migrated successfully, and checked for private defaults before touching the live schema. The temporary database was dropped.
- The first clone attempt inherited `AUTO_MIGRATE=false` and applied no migrations. The corrected rehearsal explicitly used `AUTO_MIGRATE=true` and passed. Live migration used the same explicit setting, `MIGRATE_ONLY=true`, and migration environment, without starting API workers.
- Old image IDs, root-only runtime environment, resolved rollback Compose configuration, Caddy configuration, and the pre-start MFA seed encoding snapshot were retained. Additive migrations were left compatible with rollback. Do not automatically restore the whole live database after accepting new activity.
- The existing primary boot disk was expanded from 80 GB to 100 GB and its ext4 filesystem grown online to retain restore and rollback headroom. No existing image or persistent data volume was deleted.

If rolling back the API before a successful startup, account for MFA seed encoding compatibility using the scoped snapshot; never discard subsequent customer or financial records with a blind full-database restore. After a healthy startup, prefer a verified forward fix. Do not revert the privacy migration or reactivate plaintext remote operators as a routine rollback step.

## Verification and limits

Before deployment: 591 top-level Go tests passed in the merged API/middleware/custody/models/worker suite, with the intentionally opt-in live-cloud test skipped there; dedicated production-network HSM probes passed separately. Operator reseeding integration tests, the Rust private-listener regression, web type checking, and seven Chromium browser scenarios passed. Earlier isolated security-drill evidence is in `CUSTODY_STAGING_DRILL_2026-11-03.md`.

Live checks passed:

- All four replaced containers healthy, zero restarts, expected immutable image digests; 11 unrelated containers preserved.
- Application, docs, and independent explorer home pages return HTTP 200; API health and auth capabilities return 200; unauthenticated account/security requests return 401.
- Public session feed returns 404 because its existing public-feed flag is off; the retired handler returns 410 when enabled. Public topology returns an empty list.
- Correct profile controls and private defaults, two of two enabled MFA seeds encrypted, zero temporary restore databases, and only the primary TLS operator in public discovery.
- Trusted buyer hostname and certificate chain, TLS 1.3 with `TLS_AES_256_GCM_SHA384`; incorrect hostname rejected; plaintext CONNECT rejected; private health works and private proxy attempts return 403 on both local gateways.
- An external TLS proxy connection verifies the certificate and receives the expected 407 authentication challenge. No production buyer credential or user JWT was fabricated for an end-to-end traffic test.
- Certificate renewal timer active; final live HSM DEK recovery successful.

No production customer account login, real-user transaction, or independent remote failover was exercised. Public settlement remains linkable on Solana devnet. Mainnet launch and remotely independent failover remain separate gates.

Updated Chrome and Firefox extension packages and the Firefox review source archive were built and ZIP-validated locally. Store publication was not performed; existing plaintext clients need the TLS-capable extension/client update. The local native PostgreSQL rehearsal server and owned Next.js test server were stopped after testing; the unrelated developer server was preserved.

Local deployment evidence is retained in the session's `production-deploy` artifact directory, including build results, migration rehearsal, pinned rollout, external TLS probe, live verification, and extension checksums. Private environment values, certificate keys, MFA seeds, and database dumps remain root-only on the production host and are not committed.
