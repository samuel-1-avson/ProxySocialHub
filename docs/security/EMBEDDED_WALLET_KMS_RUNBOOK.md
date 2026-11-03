# Embedded wallet custody and recovery

The API supports a dedicated symmetric Google Cloud KMS KEK for embedded Solana wallets. The KEK stays in KMS. Per-wallet data keys and signing keys are decrypted briefly in the API process; this is operator custody, not noncustodial signing or an HSM-held user signing key.

## Deployment configuration

Use a separate `ENCRYPT_DECRYPT`, `GOOGLE_SYMMETRIC_ENCRYPTION` CryptoKey for each environment. Do not reuse the asymmetric treasury or oracle signing keys. Use HSM protection for production. Attach a dedicated workload identity to the API and grant `roles/cloudkms.cryptoKeyEncrypterDecrypter` on that CryptoKey only. Historical reader keys should receive decrypt-only access (`roles/cloudkms.cryptoKeyDecrypter`). Runtime identities must not have key administration, IAM administration, key export/import, or project-wide KMS access. Use ADC via workload identity; do not create downloadable service-account keys.

```dotenv
EMBEDDED_WALLET_KEK_PROVIDER=gcp-kms
EMBEDDED_WALLET_GCP_KMS_KEY=projects/PROJECT/locations/REGION/keyRings/embedded-production/cryptoKeys/wallet-dek
EMBEDDED_WALLET_GCP_KMS_READ_KEYS=
EMBEDDED_WALLET_KMS_PROTECTION_LEVEL=HSM
```

Supply an **unversioned** CryptoKey resource. The adapter always calls the fixed HTTPS Cloud KMS endpoint, rejects redirects, checks CRC32C and authenticated additional data, bounds responses and deadlines, and checks the returned resource and protection level. `SOFTWARE` protection requires explicit configuration and applies to every configured reader as well. A strict deployment never falls back to a local key.

The main, development, minimal, full, production and secure Compose configurations forward these variables. GCP overrides inherit them from the base configuration. ADC availability inside the deployed container must be verified with its actual workload identity.

Run from `services/control-api`, with the deployment's configuration and identity:

```sh
go run ./cmd/custody-check
```

This wraps and recovers a random data key without touching wallets or funds. `/v1/auth/capabilities` uses a bounded cached readiness probe (30 seconds on success, 5 seconds on failure). Every new wallet independently proves its wrapped key can be recovered before the row is stored. Provider failure aborts signup; existing linked Google accounts can still authenticate. Signing fails when decryption is unavailable.

## Provisioning a production key

Run the following under a separate operator identity with the intended project, region, dedicated runtime service account and naming variables set. These commands are a deployment template; the implementation work did not execute them against production.

```sh
gcloud kms keyrings create "$KEY_RING" --project="$PROJECT" --location="$REGION"
gcloud kms keys create "$KEY_NAME" --project="$PROJECT" --location="$REGION" \
  --keyring="$KEY_RING" --purpose=encryption --protection-level=hsm \
  --default-algorithm=google-symmetric-encryption --rotation-period=90d \
  --next-rotation-time="$FIRST_ROTATION_UTC"
gcloud kms keys add-iam-policy-binding "$KEY_NAME" --project="$PROJECT" \
  --location="$REGION" --keyring="$KEY_RING" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
```

Enable Cloud KMS Data Access audit logging and an alert on denied/degraded crypto operations, unexpected decrypt volume, IAM changes and key-state changes. Separate operator access and recovery access from the API identity. Review inherited project/folder IAM; a narrow key binding does not remove inherited grants. Validate the operator/runbook, regional outage response and backup access before onboarding funded accounts.

## Rotation and recovery

KMS primary-version rotation uses the same stored `gcp-kms:v1:<CryptoKey>` ID. Existing ciphertext identifies its original version, so keep all versions needed by current rows, replicas, rollback images and backups enabled. Changing the primary does not re-encrypt stored ciphertext. See Google's [rotation behavior](https://cloud.google.com/kms/docs/key-rotation) and [integrity requirements](https://cloud.google.com/kms/docs/data-integrity-guidelines).

For rotation to a different CryptoKey, configure the new key as active and the old key in `EMBEDDED_WALLET_GCP_KMS_READ_KEYS` (maximum eight, explicit allowlist). The API never derives a remote destination from a database key ID. Drain old API instances before retiring a reader.

Use the offline operator command with a backup and a restricted database credential. It does not run application startup or migrations. Default operation is a dry run; it still performs KMS crypto operations and recovery checks. `--apply` updates only `wrapped_dek` and `kek_id`, one locked row per transaction. Signing ciphertext, user IDs and addresses remain unchanged.

```sh
go run ./cmd/custody-rewrap --from='gcp-kms:v1:projects/PROJECT/locations/REGION/keyRings/OLD/cryptoKeys/OLD_KEY' --limit=100
go run ./cmd/custody-rewrap --from='gcp-kms:v1:projects/PROJECT/locations/REGION/keyRings/OLD/cryptoKeys/OLD_KEY' --limit=100 --apply
```

Continue using `--after=<next_cursor>` until a batch checks zero rows. Run one job at a time. The same procedure with source equal to active ID rewraps data under the current primary version. On failure, completed rows remain committed and the returned cursor identifies progress; the failed row remains on its source key. Investigate before resuming. Keep source keys available throughout rollback and backup retention. A database count of key IDs cannot prove an older version is unused because IDs intentionally name the CryptoKey, not its version.

For a legacy `local:v1` migration, stop old writers, keep a protected backup and set `EMBEDDED_WALLET_LEGACY_KEK` only in the isolated operator process. Select a remote target through the normal configuration and use `--from=local:v1 --read-legacy-local`, dry run first, then `--apply`. The API never reads that migration variable. Remove it from the operator environment afterwards. Do not switch the API to the remote key while unmigrated local wallets still need to sign; complete the bounded migration during the write pause, verify recovery, then resume.

Prove recovery with a restored pre-rotation backup and retained source access. Test new writes and signatures under the target, including after restarting the process. Do not disable/destroy source versions until all dependent backups and rollback paths have expired or been re-encrypted and restored successfully. KMS key-state changes can propagate after acknowledgement. For emergency denial, revoke the runtime's IAM access as well as disabling the key, then observe actual crypto refusal; restore both for recovery. Google's [consistency guidance](https://cloud.google.com/kms/docs/consistency) explains these different propagation paths.

## Repeatable security drill

Use a dedicated PostgreSQL instance bound to loopback. The test harness recreates per-package databases, so never point it at an application database. A local run includes real HTTP and established WebSocket revocation, refresh rejection, MFA/replay/privacy/export cases, closure preservation and injected provider faults:

```powershell
./scripts/security/staging-security-drill.ps1 `
  -TestDatabaseUrl 'postgres://postgres@127.0.0.1:56439/custody_security_drill_test?sslmode=disable' `
  -OutputDirectory 'C:/evidence/custody-drill'
```

To add real KMS crypto and rotation, provision two HSM keys in the dedicated `proxyhubb-embedded-staging` ring. Give a dedicated `proxyhubb-custody-staging` service account crypto access to those keys and allow the operator to impersonate it without creating credentials. Pass `-KmsKeyA`, `-KmsKeyB`, and `-ImpersonateServiceAccount`. `-ExerciseKmsControl` explicitly enables operator-controlled key disable/re-enable, exact runtime IAM revocation/restoration, and primary-version rotation on those staging keys. The application identity must receive HTTP 403 on key administration. Control credentials remain separate from runtime credentials and are passed only to the test process; neither appears in command arguments or evidence logs.

After the drill, remove test-only IAM bindings and service identities, and disable/schedule destruction of every synthetic test key version. Resource objects remain until they satisfy Google's [deletion requirements](https://cloud.google.com/kms/docs/delete-kms-resources). Keep production resources out of this drill. A local API/database rehearsal plus real cloud KMS is not evidence of a deployed staging application, buyer TLS certificate chain, packet capture, production database restore or independent RPC/gateway failover; those require their actual deployment targets.

For an explicit local buyer TLS drill, create a new fixture directory with `go run ../../scripts/security/generate-tls-drill/main.go -out <new-directory>` from `services/control-api`. Set `TLS_DRILL_DIR` to that directory and run `cargo test --locked --manifest-path services/edge-gateway/Cargo.toml --test buyer_tls_security_drill -- --ignored` from the repository root. The test uses the production buyer TLS acceptor, trusts only the disposable CA for the successful request, inspects captured encrypted TCP bytes for synthetic credential disclosure, and rejects plaintext, an untrusted certificate and a hostname mismatch. It does not change the machine trust store or validate a deployed certificate.
