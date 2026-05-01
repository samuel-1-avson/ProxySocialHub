# Public Testnet Settlement Validation Runbook

## Overview

This runbook defines the current repeatable RC-03 validation path for the public-testnet settlement lifecycle.

It uses the existing settlement-focused billing tests in [services/control-api/internal/billing](../../services/control-api/internal/billing) as the executable validation anchor and treats [docs/openapi.yaml](../openapi.yaml) as the public contract reference under [docs/adr/0008-use-openapi-as-public-api-contract-source.md](../adr/0008-use-openapi-as-public-api-contract-source.md).

## What This Validates

The current validation path covers two layers:

1. A deterministic unit-backed lifecycle check that proves mirrored settlement state is persisted.
2. An optional integration-backed batch proof check that proves proof bytes are persisted and an on-chain submission is attempted through the canonical control-api path.

## Prerequisites

### Required

- Go toolchain available in the shell.
- Local repo checkout with dependencies resolved.
- reachable local test database using either `TEST_DATABASE_URL` or the repo test-profile default `postgresql://proxyhubb:proxyhubb@127.0.0.1:5433/proxyhubb_test?sslmode=disable`

### Required For Integration Mode

- `DATABASE_URL`
- `HALO2_PROVER_URL`
- reachable database with the `zk_batches` table available
- reachable Halo2 prover with a healthy `/healthz` endpoint
- Solana oracle configuration available to the control-api test environment

## Validation Commands

### Unit Validation Only

```powershell
./scripts/validate-settlement-rc.ps1
```

This runs:

- `TestMarkSettlementArtifactsSettledAdvancesSessionIntentLifecycle`

Expected evidence:

- usage receipt status moves to `settled`
- settlement manifest status moves to `settled`
- session intent lifecycle advances to `archived`
- ledger, batched, chain-committed, and archived timestamps are populated

### Unit Plus Integration Validation

```powershell
./scripts/validate-settlement-rc.ps1 -RunIntegration
```

This additionally runs:

- `TestZKAggregator_SubmitBatchDirect_PersistsProofBytesFromRealProver`

Expected evidence:

- a `zk_batches` row is created or updated for the test root
- `proof_bytes` is non-empty after Halo2 attachment

Depending on environment readiness, the chain submission evidence looks like one of:

1. **On-chain program deployed (strict)**
	- batch status becomes `confirmed`
	- `on_chain_tx_sig` is populated after the canonical control-api submission path runs

2. **On-chain submission simulated (program not deployed)**
	- the integration artifact includes `ProgramAccountNotFound` / “program that does not exist”
	- batch status becomes `failed` (but `proof_bytes` remains persisted for operator evidence)

This still satisfies RC-03’s acceptance criteria (“submission attempted or simulated with captured evidence”).

## Artifacts

The PowerShell script writes machine-readable test output under `testing/artifacts`:

- `rc03-settlement-unit-<timestamp>.jsonl`
- `rc03-settlement-integration-<timestamp>.jsonl` when integration mode is used

Use those files as the issue attachment or release-check evidence artifact for RC-03.

If the unit test is skipped, the script now fails intentionally. That prevents a false-green validation run when the test database is misconfigured.

The script seeds the repo test-profile database URL automatically when `TEST_DATABASE_URL` is unset, so the default local path matches [docker-compose.test.yml](../../docker-compose.test.yml).

## Current Limits

- This runbook does not replace the full RC-09 release-gated integration matrix.
- Integration mode still depends on external prover and chain-facing environment readiness.
- This path validates the current control-api settlement lane; it does not certify every downstream explorer or frontend surface.

## Next Follow-Up

- Extend this runbook with a single environment bring-up profile once RC-09 work starts.
- Add a frontend-visible smoke check once RC-07 wallet-first auth coverage is rewritten.
- Promote this script into CI only after the integration environment is stable enough to avoid noisy failures.
