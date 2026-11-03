# Account privacy and security implementation

Implementation branch: `codex/account-privacy-security-phases`, based on `660f884e`. This document accompanies the historical account privacy audit; it does not change the audit's original evidence or claim a deployed fix.

## Delivery and activation

The repository implements the containment, account-security, lifecycle, and privacy-setting changes below. Deployment verification remains a release gate. Nothing in this work deploys migrations, rotates production keys, changes chain authorities, or publishes a site.

| Phase | Repository changes | Activation requirements |
| --- | --- | --- |
| 0: containment | Authenticated, participant-bound, bounded P2P signaling; explicit public account DTOs and safe nested serialization; real session-family binding; live status checks; shared block/contact policy; public map consent and coarsening; public-only catalog enrichment | Migrations 177–178; coordinated API/web/extension rollout; forced reauthentication for older browser JWTs |
| 1: account security and lifecycle | MFA challenge before session issuance, encrypted seeds, consumed recovery codes, replay and attempt checks, verified reset; message tombstones/idempotency/history; managed identity confirmation for closure; checked export archive; TLS credential propagation and strict gateway startup; reduced request logging | Encryption key available before API starts; trusted buyer TLS certificate deployed; closure and export staging drill |
| 2: privacy controls | Private profile/discovery/map/presence/activity/analytics defaults; random wallet aliases; independent settings persisted by API; contact and per-listing inquiry controls; disclosure acknowledgments; saved guest/contact/buyer previews; media and external GeoIP restrictions | Communicate migration defaults to existing users; configure approved first-party media origins; verify every public route against staging fixtures |
| 3: trust and evidence | Cloud KMS embedded-wallet envelope encryption, runtime custody/onboarding readiness, bounded verified DEK rotation, strict environment custody gate, unavailable placeholder proofs, bounded operational retention, documented trust boundaries and release evidence requirements | Activate a dedicated production key/workload identity and validate the deployed app; deployed artifact matching and operational drills below |

Reused community implementation work supplies the response DTO, block, message lifecycle, pagination, and idempotency foundations. The local changes integrate those foundations with the new account/privacy policy.

## Defaults and migration behavior

Migration 178 opts existing accounts out of public profile/discovery/map/presence/activity, optional analytics, direct peer disclosure, and new public KYC attestations. The default contact mode is approved contacts; listing inquiries require both the account's inquiry mode and the listing's explicit message switch. Existing listing inquiry switches are reset off. Exact legacy `user_<first eight wallet characters>` aliases are randomized; chosen aliases remain intact.

Public contributions and offers retain an account ID and alias. Those identifiers are pseudonyms, not an anonymity guarantee. Already public content, public settlement addresses, and on-chain history cannot be made secret by a later setting change.

Rollback does not decrypt MFA seeds, restore wallet-derived aliases, or republish revoked visibility choices. Keep an encryption-aware API available during rollback, and validate the application/schema combination against the staging backup before changing production.

| Data / capability | Guest or unrelated account | Approved contact | Buyer with an active purchased session | Account owner |
| --- | --- | --- | --- | --- |
| Email, tax data, KYC details, linked wallet | Withheld from account DTO | Withheld | Withheld from account DTO; settlement has a separate contract | Explicit private account/export DTO |
| Personal profile fields and remote media | Only after public profile opt-in; approved media policy | Same public identity projection | Same public identity projection | Self view |
| Presence | Opt-in, fresh within two minutes, rounded last-seen | Same rule | Same rule | Self view |
| Provider map point | Explicit map opt-in; country by default, approximate city maximum | Same rule | Provider egress may be observable through purchased service | Setting and saved preview |
| New message | Recipient permits it | Permitted unless Nobody or a block | Listing inquiry requires consent; purchases do not grant unrestricted messaging | Can choose mode and block |
| Existing message history | Participants only | Participants only | Participants only | Export includes participant history with deleted content tombstoned |
| SDP / ICE | Withheld | Withheld without a matching active order/session | Both participants must opt in; own role only | Same participant checks |

Privacy-sensitive map and geo response caching is disabled to prevent stale consent snapshots. Coarsening happens before final bounding-box filtering. Catalog metadata on the public map uses a guest projection even for a signed-in owner. Legacy geo aliases return 410 and name the current map endpoint.

Individual public traffic-session and provider-earnings feeds are retired. Public topology is unavailable by default (`PUBLIC_TOPOLOGY_ENABLED`); no synthetic links are substituted. Its aggregation code filters consented inputs and suppresses small session buckets, but activation requires a separate review of the traffic-disclosure policy and distinct-participant thresholds.

## Account security and closure

Browser access JWTs carry `sid`, without email or wallet claims. The device row and refresh family share that ID. Expiry, revocation, account status, and current role are checked at admission; realtime delivery checks authorization again. Old browser JWTs without a bound session require a new login. Refresh rotation does not extend the original authenticated session lifetime.

MFA primary authentication returns a five-minute challenge with no session cookies or access/refresh tokens. Challenges have a five-attempt limit, are single use, and require a locked settings row. Authenticator secrets use the configured credential encryption hooks; startup migrates older plaintext seeds and fails if protection is unavailable. QR codes are rendered locally from an `otpauth` URI. Enabled factors cannot be silently replaced; disable and recovery-code regeneration require a current factor or unused recovery code.

Closure requires a linked external-wallet signature or a fresh matching Google identity, plus MFA where enabled. Scheduling hides public visibility immediately. Users can inspect and cancel the schedule; successful full sign-in also cancels it. The grace period is 30 days.

Scheduling and purging check balances and unsettled services/cash-outs. Managed key destruction additionally requires an available chain verifier, zero SOL, and no SPL or Token-2022 accounts. Failed verification preserves recoverable keys and account records. Never send funds to an address after its key is destroyed. Required payment records and public blockchain history can outlive account closure. A staging purge drill must include funded, empty, active-order, verification-outage, cancelled, and newly funded-during-grace cases.

Export schema 2 streams allowlisted rows into a temporary archive, then returns the completed file. A failed class aborts the response instead of returning an apparently complete partial archive. `manifest.json` lists classes, counts, format, and exclusions. Seeds, recovery-code hashes, signing keys, reusable tokens, proxy credentials, internal fraud signals, and other accounts' private profiles are excluded. External vendor records and on-chain history require their own access mechanisms.

## Network, media, analytics, and retention

- Buyer credential responses and SDK examples advertise HTTPS. The extension preserves the scheme and rejects remote plaintext or unspecified transport. Explicit loopback HTTP is a development exception. Gateway strict environments and release builds require buyer TLS; explicit TLS enablement with missing certificates fails closed.
- `P2P_SIGNALING_ENABLED` defaults off. Enabling it does not bypass per-user consent, active order/session ownership, role checks, blocks, payload limits, capacity, or expiry.
- `EXTERNAL_GEOIP_ENABLED` defaults off. Explicit configuration requires `EXTERNAL_GEOIP_URL` over HTTPS, no redirects, a bounded response, and a bounded one-hour cache. Offline/manual country/city hints remain usable. Activation requires a documented disclosure/processor policy.
- Public profile images permit embedded raster data or HTTPS origins explicitly listed in `PROFILE_MEDIA_ORIGINS`. Arbitrary third-party images are suppressed, including previously stored URLs. No image-fetch proxy is introduced.
- Optional marketplace analytics require an authenticated account's opt-in. Anonymous events are dropped. Event metadata has a small string allowlist. Mandatory billing/security accounting remains independent.
- General request logs omit queries, client IP, user agent, and account IDs; route templates avoid recording path identifiers. SQL logging uses parameterized queries. Security records retain the context needed for account investigations under the retention policy below.

| Record class | Default operational retention |
| --- | --- |
| MFA challenges | Remove 24 hours after expiry |
| Expired browser device and refresh rows | Remove 30 days after expiry |
| Login attempts | 90 days |
| Optional marketplace funnel events | 30 days |
| Audit network metadata | Remove IP/UA/metadata after 90 days while retaining the event |
| Profile / private profile data | Scheduled closure and dependency checks; 30-day grace |
| Managed signing keys | Preserve until closure checks prove the supported wallet empty |
| Payment, accounting, backups, service logs | Deployment-specific retention and access policy required; not silently deleted by the operational cleanup worker |

## Trust boundaries and release evidence

| Subsystem | What remains trusted |
| --- | --- |
| Settlement | Solana program, deployed binary and IDL, upgrade authorities, configured RPCs, and the escrow/oracle paths actually used |
| Account authentication | Central API, identity verifier, database, browser session controls, and independent administrator credentials |
| Managed wallets | Operator custody. Dedicated symmetric Cloud KMS KEKs protect stored data keys; user signing keys are decrypted in API memory. Local environment KEKs are rejected when either conventional environment variable names a strict deployment. Production key provisioning, workload identity and deployment verification remain activation prerequisites. See [custody runbook](EMBEDDED_WALLET_KMS_RUNBOOK.md). |
| Discovery / moderation | API/database indexes, registry filters, moderator decisions, and configured gateway operators |
| Routing / metering | Gateways, providers, credential caches, usage accounting and proof/receipt implementation. A signature is not proof of an unobservable physical network. |
| Privacy | Policy enforcement reduces disclosures; operators still handle metadata and purchased egress is observable. No onion routing or unlinkable settlement claim is made. |

Before release, attach evidence of:

1. Migration application/rollback on a restored staging database, preserved recoverable funds, and user communication about opt-outs and reauthentication.
2. Trusted buyer TLS handshake and packet capture proving credentials remain inside the encrypted outer connection; reject plaintext and certificate/hostname failures on each supported browser and SDK.
3. Two-device revoke-one/revoke-all, suspend/ban/reactivate, MFA recovery/reset/replay, and established realtime disconnect behavior.
4. Guest/contact/buyer privacy matrix, direct route aliases, map opt-out during concurrent reads, and owner/guest catalog cache priming.
5. Export inventory reconciliation with populated records and a large-account resource test; closure with managed wallets, disputes, ledger archives, payment retention, and an RPC outage.
6. Approved custody provider and key-rotation/recovery evidence, or proof that new managed onboarding remains unavailable.
7. Source/IDL/deployed program bytecode and authority matching; independent gateway/RPC ownership evidence and real failover drills.
8. Log/backup access controls, backup expiry and deletion evidence, telemetry retention, moderation recovery, and operations runbooks.

Local verification results are recorded with the final implementation handoff. These external deployment gates are not satisfied by local source tests.

## Local verification record

The subsequent [custody implementation and staging drill](CUSTODY_STAGING_DRILL_2026-11-03.md) adds real Cloud KMS HSM rotation/recovery, HTTP/realtime revocation, closure and buyer TLS evidence. It also corrects the jury fixture skip described in the initial record below.

Verified on 3 November 2026 using synthetic accounts. Initial PostgreSQL checks used an isolated Docker network/container with no published ports. When Docker stopped accepting process-start/removal operations, final database checks used an isolated native PostgreSQL 16.4 runtime bound only to `127.0.0.1:56439`; no existing project database was used.

- **583 top-level Go tests passed** across API, middleware, models, workers, GeoIP, topology, custody, realtime, funnel, and closure packages. One existing jury-settlement test skipped because its fixture omits the required listing foreign key. The final API rerun has no failures. `authstate` and `privacy` have no standalone test files; their behavior is covered by API/middleware tests.
- All Go packages compile with Go 1.26.10 (`go test -run '^$' ./...`).
- **6 Chromium browser tests passed**: privacy settings/acknowledgments/previews, inbox pagination/deep links and legacy recipient links, message lifecycle, accepted-send recovery, and theme hydration.
- Web TypeScript checking and the extension's HMAC, verification, reliability, bridge, and TypeScript checks passed.
- `cargo check --locked --no-default-features --manifest-path services/edge-gateway/Cargo.toml` passed. Existing compiler warnings remain; no full-feature gateway build or production packet-capture claim is made.
- `git diff --check` passed.

The native test database and browser server are stopped after verification. Docker removal did not complete while its process-start operations were unresponsive. Task-only Docker resources may therefore remain: container `phub-privacy-impl-pg`, network `phub-privacy-impl-test`, and volumes `phub-privacy-impl-gomod` / `phub-privacy-impl-gocache`. Once Docker responds, remove that container first, then that network and those two volumes. Other projects' Docker services were not restarted.
