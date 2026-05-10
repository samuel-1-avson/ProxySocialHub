# Public Testnet Release Gate

## Overview

This runbook defines the RC-09 release gate for public-testnet promotion.

It deliberately points every validation slice at the same authoritative sources:

- [docs/openapi.yaml](../openapi.yaml) is the only public API contract for release review.
- [public-testnet-authority-matrix.md](public-testnet-authority-matrix.md) defines which surfaces are authoritative for each critical flow.
- [services/control-api/docs](../../services/control-api/docs/README.md) is legacy Swagger output and is not part of the release contract.

## Promotion Command

For a release-candidate promotion decision, run:

```powershell
./scripts/validate-release-gate-rc.ps1 -RunSettlementIntegration
```

The script blocks promotion on the first failing slice and writes a machine-readable summary plus per-slice logs under `testing/artifacts/release-gate-<timestamp>/`.

## Gate Slices

| Slice | Command | Contract / authority reference | Evidence captured |
| ----- | ------- | ------------------------------ | ---------------- |
| Backend settlement | `./scripts/validate-settlement-rc.ps1 -RunIntegration` | [docs/openapi.yaml](../openapi.yaml) and the settlement row in [public-testnet-authority-matrix.md](public-testnet-authority-matrix.md) | `rc03-settlement-unit-*.jsonl`, `rc03-settlement-integration-*.jsonl`, settlement log |
| Web auth E2E | `npx playwright test e2e/auth.spec.ts --project=chromium` in `apps/web` | [docs/openapi.yaml](../openapi.yaml) wallet-first auth flow | Playwright JSON results, HTML report, auth E2E log |
| Anchor chain slice | `anchor test` in `services/solana-programs/proxyhub` | Escrow chain-required classification from [public-testnet-authority-matrix.md](public-testnet-authority-matrix.md) | Anchor test log |

## Blocking Rule

- Any non-zero exit code blocks release promotion.
- Mirror-only explorer data must never override a failing authoritative slice.
- A backend pass without `-RunSettlementIntegration` is useful for local smoke checks, but it does not satisfy the release-promotion gate.

## Prerequisites

### Backend Settlement Slice

- Go toolchain available in the shell.
- `DATABASE_URL`
- `HALO2_PROVER_URL`
- `SOLANA_ORACLE_KEYPAIR` or `infra/oracle-keypair.json`
- reachable integration database and prover for the target environment.

### Web Auth Slice

- Node.js dependencies installed under `apps/web`.
- reachable control-api on the intended auth base URL, default `http://localhost:18080`.
- if the web app is not already running, Playwright will start the local Next dev server on `http://localhost:4011`.

### Anchor Slice

- Solana CLI available.
- Anchor CLI available.
- Node.js dependencies installed under `services/solana-programs/proxyhub`.
- localnet or target chain test prerequisites required by the Anchor workspace.

## Artifact Layout

Each gate run writes:

- `testing/artifacts/release-gate-<timestamp>/gate-summary.json`
- `testing/artifacts/release-gate-<timestamp>/backend/`
- `testing/artifacts/release-gate-<timestamp>/web/`
- `testing/artifacts/release-gate-<timestamp>/anchor/`

Use `gate-summary.json` as the first triage entry point. It records the executed command, the authoritative contract references, slice status, and artifact paths.

## Current Scope

- The web slice intentionally gates on the focused wallet-first auth scenario in [apps/web/e2e/auth.spec.ts](../../apps/web/e2e/auth.spec.ts). That is the release-critical browser flow already hardened in RC-05 and kept current in RC-07.
- This gate does not replace deeper service-specific test suites. It defines the minimum release-promotion bar across backend, web, and chain validation.
- If a slice becomes flaky, fix the slice or descope it explicitly. Do not waive failures by pointing at mirror-only surfaces.
