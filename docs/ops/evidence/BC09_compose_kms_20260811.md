# BC-09 residual key hygiene — W1.4 evidence

| Field | Value |
|-------|-------|
| Date | 2026-08-11 |
| Scope | Compose + runbook (workstation scrub is operator-executed) |
| Result | `BC09_COMPOSE_KMS_PASS` (code); workstation scrub = runbook ready |

## Changes

1. [`docker-compose.prod.yml`](../../docker-compose.prod.yml) — removed
   `./oracle-keypair.json` and `./treasury-hot-keypair.json` mounts; require
   `USE_GCP_KMS` / `USE_GCP_KMS_HOT` (+ key names) like gcp-testnet.
2. [`docker-compose.gcp-testnet.yml`](../../docker-compose.gcp-testnet.yml) —
   cosigner mount documented as residual until KMS/sealed secret.
3. Runbook: [`docs/ops/BC09_WORKSTATION_SCRUB.md`](../BC09_WORKSTATION_SCRUB.md).

## Still operator-owned

- Laptop/CI shred of any historically funded key JSON
- Cosigner KMS migration
- Rotate keys that ever lived on a workstation

## Non-claims

- Does not prove every developer machine is clean without running the scrub checklist
- Does not claim mainnet-ready
