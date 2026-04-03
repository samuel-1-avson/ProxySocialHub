# ProxyHubb Decentralized Explorer Implementation Plan (2026-04-01)

## Objective

Move the explorer from a single-operator query stack to a multi-operator, verifiable query system where clients can independently validate that explorer responses match canonical chain state.

## Current State (Ground Truth)

- Explorer API and websocket are served by one control-plane service.
- Explorer reads are primarily served from centralized tables (explorer_blocks, explorer_transactions, explorer_nodes, provider_earnings).
- One blockchain indexer process currently writes explorer block/transaction rows.
- Decentralization scorecard currently marks API/control plane and data/query plane as centralized.

## Target State (Definition of Done)

The explorer is considered decentralized when all of the following hold:

1. At least 3 independent indexer operators continuously attest canonical block/hash observations.
2. Query responses include verifiable proof metadata tied to an attested snapshot root.
3. Clients can cross-check proofs against published attestation roots from multiple operators.
4. Any single API/indexer outage cannot censor or rewrite explorer truth.
5. Explorer trust assumptions are machine-readable in API responses.

## Delivery Strategy

Ship in phases with backward-compatible APIs. Do not block current explorer UX while trust model upgrades roll out.

---

## Phase 0: Quorum Attestation Foundation (implemented now)

Goal: introduce multi-writer evidence collection without breaking current explorer behavior.

Delivered:

- New attestation persistence table: explorer_block_attestations.
- Blockchain indexer now writes a per-slot attestation tuple:
  - chain
  - slot
  - block_hash
  - parent_hash
  - writer_id
  - rpc_endpoint
  - attested_at
- New public endpoint: GET /v1/explorer/decentralization/status
  - reports unique writer count
  - reports slots meeting quorum
  - reports conflicting slots
  - reports explorer mode and fully_decentralized flag

Operational knobs:

- EXPLORER_INDEXER_WRITER_ID
- EXPLORER_MIN_WRITERS

Exit criteria:

- At least one writer continuously emits attestations in production.
- Observability endpoint returns non-empty slot analysis.

---

## Phase 1: Multi-Operator Ingestion Quorum

Goal: eliminate single-writer truth for indexed block history.

Tasks:

1. Deploy 3+ independent indexer writers (different infra providers/regions).
2. Add writer registration and health scoring (uptime, lag, conflict rate).
3. Introduce canonical slot selection policy:
   - choose block_hash with highest writer quorum
   - tie-break by finalized commitment and oldest attested_at
4. Mark low-confidence slots when quorum is not met.
5. Add API headers for trust level:
   - X-ProxyHubb-Explorer-Mode
   - X-ProxyHubb-Explorer-Quorum
   - X-ProxyHubb-Explorer-Confidence

Exit criteria:

- >= 95% of recent slots have quorum >= configured threshold.
- conflicting slot rate below SLO threshold (for example < 0.5% in 24h).

---

## Phase 2: Signed Attestations and Operator Identity

Goal: make attestation provenance cryptographically verifiable.

Tasks:

1. Assign each writer an on-chain or governance-approved public key identity.
2. Sign attestation payloads:
   - sign(chain, slot, block_hash, parent_hash, attested_at, writer_id)
3. Store signature and key id per attestation row.
4. Expose writer registry endpoint with key material and revocation status.
5. Reject unsigned or invalid attestations from quorum calculation.

Exit criteria:

- 100% of quorum-eligible attestations are signature-verified.
- key rotation and revocation path tested.

---

## Phase 3: Verifiable Query Proofs

Goal: make explorer responses independently checkable by clients.

Tasks:

1. Build deterministic snapshot batches over canonical explorer rows.
2. Compute Merkle root per snapshot window (slot range).
3. Publish roots and metadata with writer signatures.
4. Extend API response schema with proof object:
   - snapshot_id
   - root
   - leaf hash
   - Merkle branch
   - signer set
5. Add client verifier utility in sdk package.

Exit criteria:

- Clients can verify sampled responses offline against signed roots.
- invalid proof injection test fails as expected.

---

## Phase 4: Decentralized Query Plane

Goal: remove single API gateway as a censorship/choke point.

Tasks:

1. Serve read APIs from multiple operator endpoints.
2. Add aggregator mode in frontend/sdk:
   - query N operators
   - compare proof roots
   - return majority/threshold-verified result
3. Add fallback routing by trust score and latency.
4. Publish public operator list with capabilities and SLOs.

Exit criteria:

- Explorer reads continue during single-operator outage.
- Majority-consistent responses in >= 99% of sampled requests.

---

## Phase 5: Governance Hardening

Goal: make explorer trust policy governance-controlled.

Tasks:

1. Move quorum threshold and trusted writer set to on-chain config or governance-controlled registry.
2. Time-lock policy changes.
3. Add emergency downgrade policy with auditable events.

Exit criteria:

- Critical trust parameters no longer mutable only by central admin env vars.

## Testing and Security Plan

- Unit tests:
  - quorum classification
  - conflict detection logic
  - proof verification
- Integration tests:
  - multi-writer divergence simulation
  - re-org handling with quorum updates
- Chaos tests:
  - writer outage
  - stale writer replay
  - byzantine writer publishing conflicting hashes
- Security controls:
  - signed attestations
  - replay protection (nonce/timestamp windows)
  - rate limits on writer ingestion

## Rollout Plan

1. Canary phase: quorum status endpoint only, no behavior change.
2. Soft enforcement: label low-confidence slots but keep serving.
3. Hard enforcement: require quorum for canonical slot claims.
4. Client verification default-on in SDK/frontend.

## Success Metrics

- Quorum coverage ratio over last 256 slots.
- Conflicting slot percentage over 24h.
- Median attestation lag (slot -> attested_at).
- Proof verification success ratio on sampled responses.
- Read availability under partial operator outage.

## Immediate Next Sprint Tasks

1. Deploy at least two additional indexer writers with unique EXPLORER_INDEXER_WRITER_ID values.
2. Build writer health endpoint and dashboard panel for attestation lag/conflicts.
3. Add signed attestation schema fields and verification middleware.
4. Add frontend trust badge on explorer pages using /explorer/decentralization/status.
