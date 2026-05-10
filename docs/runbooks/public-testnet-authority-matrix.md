# Public Testnet Authority Matrix

## Purpose

This matrix is the shared RC-08 authority reference for operators, QA, launch review, and external testers.

Use it to decide which surface is authoritative when public-testnet evidence disagrees across the API, runtime registry, chain, or explorer.

## Classification Rules

- `DB-authoritative`: the public-testnet release candidate still treats centrally accepted control-plane state as authoritative for this flow. Chain writes may exist, but they are attestations, mirrors, or later follow-on evidence.
- `mirror-only`: the surface is derived from another source of truth and must never be used by itself as release evidence.
- `chain-required`: release evidence must include the on-chain state transition. API rows, operator logs, and explorer views are supporting mirrors only.

## Matrix

| Flow | RC label | Authoritative release evidence | Non-authoritative or supporting surfaces | Why this is the current label |
| ---- | -------- | ------------------------------ | ---------------------------------------- | ----------------------------- |
| Escrow | `chain-required` | Solana escrow-backed release state and the transaction or account evidence that proves funds were committed, released, or refunded on-chain. | Control-api dispute rows, admin fallback actions, and explorer summaries are supporting mirrors only. | The current decentralization scorecard already treats escrow release as chain-first for the escrow-backed path, even though older DB fallback paths still exist and need further cleanup. |
| Governance | `DB-authoritative` | Control-api proposal, voting, and execution state for the current public-testnet path. | Chain relay attempts, token-balance checks, and explorer views are supporting evidence but do not define finality today. | Governance is still DB-authoritative with chain attestation in the current architecture, so launch review should not overstate chain-enforced governance finality yet. |
| Provider heartbeat | `DB-authoritative` | Centrally accepted gateway or control-plane provider liveness state, including the runtime registry and mirrored node or lease records used for routing decisions. | Future chain mirrors, analytics copies, and explorer or catalog surfaces are non-authoritative. | Provider heartbeat state transitions are still accepted centrally; chain mirroring is planned but non-fatal for the release candidate. |
| Settlement | `DB-authoritative` | Control-api settlement lifecycle state, including usage receipts, session intent lifecycle, batch persistence, and proof attachment evidence produced by the canonical Halo2-backed control-api path. | Edge-side experimental Groth16 flows, explorer rows, and chain-attested `proof_hash` or batch metadata without the matching control-api state are supporting evidence only. | ADR-0007 makes the control-api the authoritative off-chain settlement coordinator for public testnet. Chain submission is commitment-first and attestation-oriented, not full on-chain proof verification. |
| Explorer writes | `mirror-only` | None. Explorer surfaces are read models only and should be checked against the actual authoritative source for the flow they display. | Explorer API responses, explorer database rows, cached summaries, and unsigned writer output are all non-authoritative by themselves. | The explorer plan explicitly treats explorer data as a derived query plane that must become cryptographically verifiable later; it is not a release authority surface today. |

## How To Use This Matrix

- Operators should pair this matrix with the settlement and secret-rotation runbooks when deciding whether a change is healthy enough to promote.
- QA and release review should use this matrix with the public-testnet release gate so mirror-only surfaces do not accidentally override the real authoritative result.
- External testers should treat explorer mismatches as mirror bugs unless the mismatch is confirmed against the authoritative source named above.

## Source References

- [docs/architecture/l2-full-decentralization-scorecard-2026-04-01.md](../architecture/l2-full-decentralization-scorecard-2026-04-01.md)
- [docs/adr/0007-use-canonical-public-testnet-settlement-path.md](../adr/0007-use-canonical-public-testnet-settlement-path.md)
- [docs/architecture/decentralized-explorer-implementation-plan-2026-04-01.md](../architecture/decentralized-explorer-implementation-plan-2026-04-01.md)
