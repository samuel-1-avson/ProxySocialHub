# Custody implementation and staging drill — 3 November 2026

Production Cloud KMS support is implemented and tested. Production activation still requires its own key, workload identity and deployment verification. The drill used isolated local application/database resources and dedicated real Google Cloud HSM keys; it did not deploy the application or use real user funds.

## Delivered

- Dedicated symmetric Cloud KMS envelope encryption through ADC, separate from oracle and treasury signers. HSM protection is the default. Strict environments reject local KEKs, unknown providers and invalid resources without fallback.
- Fixed HTTPS endpoint, bounded requests/responses, redirect refusal, CRC32C checks, authenticated additional data and returned resource/protection checks. Provider errors exclude tokens, plaintext and response bodies.
- Recovery verification before wallet creation commits, context-bound signing, an allowlisted reader key ring and stable IDs across primary-version rotation. Wallet addresses and signing ciphertext remain unchanged during DEK rewrapping.
- Offline readiness and bounded rewrap commands. Rewrap defaults to dry run, verifies target recovery, locks each updated row and emits resumable progress. Legacy local migration is available only in the offline operator command.
- Compose configuration and a [deployment/recovery runbook](EMBEDDED_WALLET_KMS_RUNBOOK.md).
- A [repeatable Go security runner](../../scripts/security/staging-security-drill.ps1), disposable TLS fixture generator and explicit buyer TLS integration drill.
- The jury-settlement fixture now supplies its required listing and fails on setup errors instead of skipping.

## Verification

| Check | Result |
| --- | --- |
| Local Go security suite: API, middleware, custody, closure, workers and realtime | 540 top-level tests passed, zero failures. The explicit cloud test was skipped only in the local pass and passed separately below. |
| All Go packages, including both operator commands | Compile passed with Go 1.26.10. |
| Restricted real Cloud KMS runtime identity | Wallet create/sign, dry run, cross-key rewrap, same-key rewrap and restored-backup signing passed. Runtime key administration returned HTTP 403. |
| Real provider denial and recovery | Target version disabled and its exact staging runtime IAM binding removed. Crypto refusal observed after 57.893 seconds. Failed rewrap preserved the source row. After restoration, the recovery probe succeeded in 656 ms and migration/signing succeeded. |
| Actual KMS primary-version rotation | A new HSM version became primary; ciphertext from the previous version remained recoverable under the same stored CryptoKey ID. |
| Injected provider faults | Credential failure, denied/disabled provider, redirects, transport errors, cancellation, wrong resource/protection, corrupt or missing checksums, unverified input, malformed and oversized responses all refused safely. An encrypt-only provider could not persist an unrecoverable wallet. |
| Two-device HTTP and established WebSocket drill | Revoke-one rejected that device's API and refresh requests and closed its established socket while the other device remained usable. Revoke-all rejected and disconnected the second device. Single-use ticket replay was rejected. |
| Closure and recoverable keys | Empty wallet purge passed. Funds, SPL accounts, Token-2022 accounts, RPC outage and active orders blocked purge while signing keys stayed recoverable. Cancellation and funds arriving during grace preserved keys. |
| Gateway TLS configuration | Two tests passed. |
| Explicit TLS handshake and encrypted wire capture | Production buyer TLS acceptor accepted the trusted disposable certificate; synthetic authorization was absent from captured encrypted TCP bytes. Plaintext, an untrusted certificate and hostname mismatch were rejected. |
| Formatting and evidence | Go/Rust formatting and `git diff --check` passed. Evidence scan found no bearer/access tokens. |

The live cloud test completed in 87.64 seconds. Local tests use production handlers and middleware with synthetic identities, a loopback PostgreSQL 16.4 instance, test Redis and simulated read-only Solana RPC responses. The TLS drill uses a disposable CA without changing the machine trust store. Existing gateway compiler warnings remain.

## Cloud and cleanup scope

Only these new staging resources were used in project `gen-lang-client-0022105784`, region `us-central1`:

- Key ring `proxyhubb-embedded-staging`, HSM keys `wallet-dek-a` and `wallet-dek-b`.
- Temporary service account `proxyhubb-custody-staging`, granted crypto access on those two keys and operator impersonation on that service account only.

Key disablement is eventually consistent; the runbook uses IAM revocation alongside disablement for emergency denial and requires observing actual crypto refusal. Test-only key IAM bindings are removed during cleanup, synthetic versions are scheduled for destruction, and the temporary service account is deleted. Key material follows the provider's destruction retention period rather than disappearing immediately. The native test database is stopped afterwards.

The workstation's default DNS intermittently refused `iamcredentials.googleapis.com`. The final retry used a task-only credential helper with an address resolved through public DNS and normal HTTPS hostname/certificate verification. The address override affected that single IAM connection; production code and machine DNS configuration were unchanged. Tokens stayed in process memory/environment and were excluded from evidence.

Evidence is stored under `C:/Users/samue/.codex/visualizations/2026/11/03/01a1a033-7090-7a91-b730-f9029cc03a20/`:

- `custody-security-final/security-local.jsonl`, `compile.log`, `security-live-kms.jsonl`, `summary.json`.
- `custody-kms-integrity-final.jsonl` for the final response-resource integrity regression.
- `staging-gateway-tls-tests.log`, `staging-buyer-tls-drill.log`.
- `custody-staging-cleanup.log`, `custody-staging-cleanup.json`.

## Remaining deployment gates

Provision and attach the dedicated production HSM key and least-privilege workload identity, enable operational audit/alerts, run readiness inside the deployed container and migrate any legacy local wallets during a controlled write pause. Validate the deployed staging application's certificate chain, browser/device flows, production-data restore, retention, deployed Solana artifact/authority matching and independent RPC/gateway failover against their actual deployment targets. The implementation and isolated cloud-backed rehearsal do not replace those deployment checks.
