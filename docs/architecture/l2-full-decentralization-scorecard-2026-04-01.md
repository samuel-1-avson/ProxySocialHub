# Proxyhubb L2 Full Decentralization Scorecard

Date: 2026-04-01
Audience: Engineering, Protocol, DevOps, Security
Goal: Convert Proxyhubb from hybrid Web2 + chain integrations into a blockchain-authoritative L2 system.

## 1) Feasibility Summary

- Full decentralization is possible.
- The current system is partially decentralized with strong progress in staking and escrow settlement.
- The migration requires a staged architecture shift, not incremental API patching.
- Recommended path: chain-authoritative state machine + decentralized execution/indexing + deterministic off-chain query layer.

## 2) Scoring Rubric

Use this 0-5 scale per domain:

- 0: Fully centralized. DB is authority, no chain verification.
- 1: Chain checks only. DB remains authority.
- 2: Hybrid with async chain anchoring or optional chain paths.
- 3: Chain-first for critical writes, DB as mirror, but centralized operator/signer remains.
- 4: Decentralized validators/operators enforce state, DB only derived cache.
- 5: Fully decentralized L2 posture for the domain.

## 3) Domain Scorecard (Current)

| Domain | Current Authority | Score | Main Centralization Blocker | Cutover Requirement |
|---|---|---:|---|---|
| SOL staking | Chain-first, DB mirror | 3 | Oracle/operator centralization | Validator-set execution and trust-minimized tx inclusion |
| PHB staking | DB authoritative with chain balance check | 1 | Stake state in DB | On-chain PHB stake account model and vault semantics |
| Escrow release | Chain-first for escrow-backed path | 3 | Mixed admin fallback and DB dispute resolution paths | Remove DB-only release/refund authorities |
| Usage metering | Redis/DB authoritative, async chain settle | 2 | Off-chain counters are authoritative | Deterministic metering commitments and fraud-proofable accounting |
| Dispute jury | DB workflow with async chain calls | 2 | Jury selection and majority resolution are server-side | On-chain jury lifecycle and enforcement |
| Governance | DB authoritative with chain attestation | 2 | Vote and execution finality in DB | On-chain proposal state, voting, execution |
| Orders/payment intent | DB authoritative with chain preflight checks | 1 | Order lifecycle controlled by API server | On-chain order commitments and escrow lifecycle authority |
| Provider registry/heartbeat | DB authoritative with non-fatal chain mirror | 2 | Heartbeat/state transitions accepted centrally | Signed telemetry + on-chain/rollup commitments with slashing |
| KYC/trust tier | DB authoritative with async chain attestation | 1 | Compliance state mutable in DB | On-chain attestation authority and verified issuer model |
| Reviews/reputation | DB authoritative with async attestation | 2 | Canonical review state in DB | On-chain review commitments and anti-spam economics |
| Milestones/rewards | DB crediting with chain gating | 1 | Reward mint/credit from DB wallet | On-chain reward logic and treasury-controlled issuance |
| State channels | DB-authoritative channels with optional chain lock/close | 2 | Non-fatal chain settlement failures | Chain-enforced channels and challenge windows |
| API/control plane | Central API operators | 1 | Single control plane can censor and reorder | Multi-operator deterministic RPC and mempool policies |
| Data/query plane | Central Postgres/Redis | 1 | Single query truth source | Deterministic indexers, verifiable query proofs, replayability |
| Admin/ops authority | Central credentials and privileged actions | 1 | Human/operator superuser power | Governance-controlled protocol admin and time-locked changes |

Current weighted posture (engineering estimate): 1.8 / 5
Target for production L2 claim: >= 4.0 / 5 across all critical financial/state domains.

## 4) Strict Cutover Checklist By Domain

A domain is not considered decentralized until all its checklist items are complete.

### A. Staking (SOL + PHB)

- [ ] Move PHB staking position state from DB to on-chain accounts.
- [ ] Implement on-chain unstake cooldown and unlock semantics.
- [ ] Enforce stake updates only from chain events (DB becomes mirror/index).
- [ ] Remove DB-authoritative stake mutation endpoints.
- [ ] Add independent watcher reconciliation with deterministic rollback handling.

### B. Escrow and Settlement

- [ ] Eliminate admin DB-only resolution path for escrow outcomes.
- [ ] Require all release/refund transitions to be chain-confirmed.
- [ ] Make payout records derivable from chain settlement events only.
- [ ] Add finality thresholds and reorg handling policy.
- [ ] Enforce fail-closed behavior when chain settlement cannot be confirmed.

### C. Usage Metering and Billing

- [ ] Replace mutable Redis counters as authority with signed metering commitments.
- [ ] Batch commitments into periodic on-chain state roots.
- [ ] Define fraud proof path for disputed usage.
- [ ] Make payout eligibility depend on commitment inclusion/finality.
- [ ] Keep Redis only as cache, not accounting authority.

### D. Dispute Resolution

- [ ] Move jury assignment and vote state transitions on-chain.
- [ ] Make majority decision settlement fully on-chain.
- [ ] Remove server authority over payout splits.
- [ ] Add juror selection randomness source resistant to manipulation.
- [ ] Add slashable behavior for malicious juror/operator actions where applicable.

### E. Governance

- [ ] Store proposal lifecycle, vote tally, quorum, and execution conditions on-chain.
- [ ] Make protocol parameter updates executable only by governance actions.
- [ ] Time-lock critical governance actions.
- [ ] Remove DB-only executeProposal authority path.
- [ ] Add immutable governance event indexing and replay tests.

### F. Provider Registry and Heartbeat

- [ ] Commit provider status updates through signed messages with anti-replay nonces.
- [ ] Anchor heartbeat aggregates on-chain at fixed intervals.
- [ ] Penalize invalid health/performance reporting via staking/slashing policy.
- [ ] Remove non-fatal mirror semantics for canonical provider status fields.

### G. Identity/KYC and Trust Tier

- [ ] Define issuer-based attestation model (who can attest and revoke).
- [ ] Store trust tier / compliance attestations as canonical chain state.
- [ ] Make API reads derive trust state from chain/indexer.
- [ ] Restrict DB records to cache and UX metadata only.

### H. Channels and Micropayments

- [ ] Require on-chain open/close success for channel validity.
- [ ] Add challenge/dispute window for stale state submissions.
- [ ] Remove DB fallback for balance authority.
- [ ] Add deterministic settlement replay tests from chain data.

### I. Rewards and Treasury

- [ ] Move milestone reward issuance logic on-chain.
- [ ] Make treasury debits/credits chain-governed only.
- [ ] Ensure all reward claims are finality-gated.
- [ ] Remove DB credit mint authority for reward balances.

### J. Control API and Data Plane

- [ ] Convert write APIs into tx builders/broadcasters only.
- [ ] Run multiple independent API operators with deterministic behavior.
- [ ] Add protocol-level mempool and anti-censorship policy.
- [ ] Replace central DB authority with deterministic indexer network.
- [ ] Add consistency proofs from index results to chain commitments.

## 5) System-Wide Cutover Gates (Must All Pass)

- [ ] No critical financial or governance state is mutable only in DB.
- [ ] Critical endpoints fail closed on chain/write finality failure.
- [ ] At least 3 independent operators run validator/API/indexer roles.
- [ ] Rebuild test: full state can be reconstructed from chain + deterministic index rules.
- [ ] Security audit confirms no hidden centralized override path.
- [ ] Incident runbook supports partition/reorg/censorship scenarios.

## 6) Suggested Execution Plan

### Phase 1: Authority Inversion (4-8 weeks)

- Lock down critical domains to chain-first or fail-closed behavior.
- Remove DB-only mutating paths in escrow, staking, payouts, and governance.
- Introduce explicit authority tags in code and API responses.

### Phase 2: Decentralized Execution (6-12 weeks)

- Introduce validator/operator roles and threshold signing where needed.
- Replace centralized oracle assumptions.
- Add deterministic event-driven state transitions.

### Phase 3: Decentralized Data Plane (6-10 weeks)

- Stand up deterministic indexer network.
- Add chain-to-query consistency checks and proof endpoints.
- Relegate Postgres/Redis to cache and analytics only.

### Phase 4: Governance and Ops Hardening (4-8 weeks)

- Convert admin powers into governance/time-locked flows.
- Complete security and game-theory audits.
- Execute cutover gates and production readiness sign-off.

## 7) Definition of Done for "Entire System is L2 Blockchain"

You can claim full L2 posture when all are true:

- Chain is the canonical source of state transitions for all critical domains.
- Control APIs cannot unilaterally mutate critical state.
- DB/indexers are derived and reproducible.
- Governance, treasury, and dispute outcomes are chain-enforced.
- Multiple independent operators can continue correct operation without a single trusted backend.

---

Owner recommendation:

- Protocol team owns on-chain authority model and cutover gates.
- Platform team owns deterministic API/indexer execution and operator tooling.
- Security team owns decentralization threat model and release criteria.
