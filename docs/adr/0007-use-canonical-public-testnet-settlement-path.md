# ADR 0007: Use Canonical Public Testnet Settlement Path

## Status

Proposed

## Context

ProxyHubb currently carries multiple proof and settlement paths at the same time:

- `services/control-api/internal/billing/zk_aggregator.go` batches signed usage proofs, attaches an external Halo2 proof when available, and submits a batch root on-chain.
- `services/edge-gateway/src/billing/zk.rs` implements a local Groth16 proving path in the gateway.
- `services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs` currently defines `submit_zk_batch` as a Phase 4 commitment-first instruction that stores batch metadata and `proof_hash`, but does not yet perform full on-chain proof verification.

This leaves the public testnet story ambiguous:

- Which proof system is canonical?
- Which service is authoritative for settlement?
- What is actually verified on-chain versus only attested or audited off-chain?

The public testnet release candidate needs one authoritative path so engineering, QA, docs, and operator runbooks can converge.

## Decision

For the public testnet release candidate, ProxyHubb will use the following canonical settlement path:

1. The control-api is the authoritative off-chain settlement coordinator.
2. The canonical batch proof attachment path is the external Halo2 prover integrated through `ZKAggregator` in the control-api.
3. The on-chain `submit_zk_batch` flow remains commitment-first for this sprint. Public testnet semantics are batch-root commitment plus proof-hash attestation, not full on-chain proof verification.
4. The edge-gateway Groth16 prover path is non-authoritative for public testnet. It may remain available for local experiments or future migration work, but it must not define user-facing finality or default settlement behavior.
5. Public docs, API payloads, UI states, and release validation must distinguish between:
   - off-chain usage recorded
   - ledger committed
   - batch committed on-chain
   - proof attested off-chain
   - future on-chain proof verification

## Consequences

### Positive

- Engineering gets one concrete settlement path to implement and validate.
- QA can build one end-to-end release scenario instead of testing conflicting proof systems.
- Docs can describe the real public testnet semantics without overstating trustlessness.
- The current control-api integration with the external Halo2 prover is used instead of inventing a third path.

### Negative

- The public testnet remains hybrid rather than fully trustless.
- The gateway-local Groth16 path becomes explicitly non-authoritative, which may require future cleanup or deprecation work.
- Full on-chain proof verification is deferred beyond this release candidate.

## Alternatives Considered

### Option 1: Keep Halo2, Groth16, and commitment-first paths active together

- **Pros**: No immediate convergence work required.
- **Cons**: QA, operators, and external users cannot tell which path is authoritative; release risk remains high.
- **Decision**: Rejected.

### Option 2: Make the gateway-local Groth16 path canonical for public testnet

- **Pros**: Keeps settlement closer to the data plane and may reduce some control-api responsibility.
- **Cons**: Conflicts with the existing control-api Halo2 integration and does not match the current batch-attestation story already wired into the backend.
- **Decision**: Rejected.

### Option 3: Delay public testnet until full on-chain proof verification exists

- **Pros**: Cleaner decentralization narrative.
- **Cons**: Delays release candidate learning and blocks the current convergence sprint on a larger protocol milestone.
- **Decision**: Rejected for the release-candidate sprint.

## Implementation Notes

- `HALO2_PROVER_URL` should remain the canonical proof-service integration for the public testnet path.
- `proof_hash` in `submit_zk_batch` must be treated as an attestation reference, not equivalent to on-chain proof verification.
- The default runtime configuration should not present the gateway-local Groth16 path as the authoritative settlement mechanism.
- Operator docs and UI copy must avoid implying stronger finality than the chain currently enforces.
- RC-02, RC-03, RC-06, and RC-08 should be executed against this decision unless the ADR is amended.

## References

- [services/control-api/internal/billing/zk_aggregator.go](../../services/control-api/internal/billing/zk_aggregator.go)
- [services/edge-gateway/src/billing/zk.rs](../../services/edge-gateway/src/billing/zk.rs)
- [services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs](../../services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs)
- [PROXYHUBB_TECHNICAL_EVALUATION_2026-05-01.md](../../PROXYHUBB_TECHNICAL_EVALUATION_2026-05-01.md)
