# ProxyHubb Tokenomics: Live vs Planned Matrix (2026-04-01)

Purpose: compact checklist of what is operational today versus what is still roadmap work.

Status legend:
- Live: implemented and active in code paths.
- Partial: implemented, but still hybrid or off-chain authoritative.
- Planned: documented target state, not implemented yet.

| Area | Live Now | Planned / Target | Status | Evidence |
|---|---|---|---|---|
| Base chain and settlement context | System runs on Solana and current buyer bandwidth payments are SOL-based. | Evolve toward full L2 posture with PHB as native token role. | Partial | [PROXYHUBB_L2_PROGRESS_REPORT.md#L30](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L30), [PROXYHUBB_L2_PROGRESS_REPORT.md#L32](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L32), [PROXYHUBB_L2_PROGRESS_REPORT.md#L35](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L35) |
| Governance proposal eligibility | Proposal creation enforces PHB minimum when PHB mint is configured (100 PHB threshold in raw units). | Keep moving governance authority/finality fully on-chain. | Partial | [services/control-api/internal/api/governance.go#L119](../../services/control-api/internal/api/governance.go#L119), [docs/architecture/l2-full-decentralization-scorecard-2026-04-01.md#L34](l2-full-decentralization-scorecard-2026-04-01.md#L34) |
| Governance voting weight | Voting power includes PHB token balance from on-chain balance check helper. | Full on-chain proposal state, voting, execution finality. | Partial | [services/control-api/internal/api/governance.go#L747](../../services/control-api/internal/api/governance.go#L747), [services/control-api/internal/api/governance.go#L748](../../services/control-api/internal/api/governance.go#L748), [docs/architecture/l2-full-decentralization-scorecard-2026-04-01.md#L34](l2-full-decentralization-scorecard-2026-04-01.md#L34) |
| PHB staking entry points | PHB stake and unstake routes exist; stake verifies on-chain balance, records PHB staking position, applies 12% APY baseline and quality boost. | Move from DB-recorded commitments to on-chain stake account/vault semantics. | Partial | [services/control-api/internal/api/staking.go#L26](../../services/control-api/internal/api/staking.go#L26), [services/control-api/internal/api/staking.go#L27](../../services/control-api/internal/api/staking.go#L27), [services/control-api/internal/api/staking.go#L455](../../services/control-api/internal/api/staking.go#L455), [services/control-api/internal/api/staking.go#L465](../../services/control-api/internal/api/staking.go#L465), [docs/architecture/l2-full-decentralization-scorecard-2026-04-01.md#L30](l2-full-decentralization-scorecard-2026-04-01.md#L30) |
| PHB staking custody model | Tokens remain in provider wallet (no vault lock yet). | Phase 5 on-chain PHB vault with stake/unstake instructions. | Planned | [services/control-api/internal/api/staking.go#L349](../../services/control-api/internal/api/staking.go#L349), [PROXYHUBB_L2_PROGRESS_REPORT.md#L521](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L521), [PROXYHUBB_L2_PROGRESS_REPORT.md#L524](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L524) |
| Fee policy control | Platform fee reads from on-chain ProgramConfig PDA (fallback 10%), with on-chain cap enforcement in program update path. | Expand more economics knobs to chain-authoritative flows. | Partial | [services/control-api/internal/api/session.go#L1000](../../services/control-api/internal/api/session.go#L1000), [services/control-api/internal/api/session.go#L1002](../../services/control-api/internal/api/session.go#L1002), [services/control-api/internal/solana/program_config.go#L31](../../services/control-api/internal/solana/program_config.go#L31), [services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L2479](../../services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L2479), [services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L2486](../../services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L2486) |
| Session fee currency | Session creation currently checks SOL wallet balance before allowing usage. | Roadmap item explicitly plans charging session fees in PHB. | Planned | [services/control-api/internal/api/session.go#L581](../../services/control-api/internal/api/session.go#L581), [services/control-api/internal/api/session.go#L819](../../services/control-api/internal/api/session.go#L819), [PROXYHUBB_L2_PROGRESS_REPORT.md#L510](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L510) |
| PHB as L2 gas and escrow currency | Not active as universal gas token yet. | Documented Phase 11b target: PHB as fee currency across L2 operations plus PHB escrow instructions. | Planned | [PROXYHUBB_L2_PROGRESS_REPORT.md#L505](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L505), [PROXYHUBB_L2_PROGRESS_REPORT.md#L512](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L512) |
| Penalty economics | Slashing logic exists for provider insurance path in program code. | Broader validator/sequencer economics still roadmap. | Partial | [services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L1870](../../services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L1870), [services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L1894](../../services/solana-programs/proxyhub/programs/proxyhub/src/lib.rs#L1894), [PROXYHUBB_L2_PROGRESS_REPORT.md#L555](../../PROXYHUBB_L2_PROGRESS_REPORT.md#L555) |

## Live Runtime Validation Snapshot (2026-04-01)

Validated directly against the running API (port 18080) and current compose runtime.

| Check | Endpoint / Path | Runtime Result | Interpretation |
|---|---|---|---|
| Oracle configured and reachable | `/v1/solana/health` | HTTP 200, oracle public key and balance returned | Live oracle wiring is active in runtime. |
| Governance relay availability | `POST /v1/governance/proposals/:id/vote/relay` | HTTP 400 with `Invalid signed_transaction_base64` | Chain-authoritative governance relay path is now executable in this environment and reaches signed transaction validation. |
| Explorer trust/status visibility | `/v1/explorer/decentralization/status` | HTTP 200, `explorer_mode=centralized_single_writer`, `fully_decentralized=false` | Explorer decentralization telemetry works and currently reports non-quorum single-writer state. |
| Explorer full-mode protection | `/v1/explorer/metrics` | HTTP 503 with full-decentralization gate error | Full-mode fail-closed behavior is active as designed. |
| Staking API exercisability (provider test account) | `POST /v1/staking/node/stake` and `POST /v1/staking/node/unstake` | Listing creation now succeeds (HTTP 201); stake returns HTTP 400 `Insufficient SOL balance`; unstake returns HTTP 400 `No staked amount to unstake` | Staking path is executable end-to-end in runtime; current failures are business-state checks (funding/position), not schema/runtime blockers. |

## Treasury / Rewards / Emissions Runtime Matrix (2026-04-01)

| Area | Runtime Result | Status | Confidence | Evidence |
|---|---|---|---|---|
| Treasury monitoring and balance visibility | `GET /v1/monitoring/treasury` returns HTTP 200 with treasury address, lamports/SOL balance, thresholds, and status (`BELOW_TARGET`). | Live | High | Runtime check on 2026-04-01; route registered in [services/control-api/internal/api/monitoring.go#L35](../../services/control-api/internal/api/monitoring.go#L35) and in [services/control-api/main.go#L396](../../services/control-api/main.go#L396). |
| Rewards surfaces (referral + milestone rewards) | `GET /v1/referral/rewards` returns HTTP 200 (`{"rewards":null}`) while DB lacks `referral_rewards` and `referral_codes` tables (`to_regclass(...)` returns null); `GET /v1/milestones` returns HTTP 200 with `total_rewards=0` and `unclaimed_rewards=0` for the test account. | Partial / Degraded | High | Runtime checks on 2026-04-01; referral/milestone routes in [services/control-api/internal/api/referral.go#L21](../../services/control-api/internal/api/referral.go#L21), [services/control-api/internal/api/milestones.go#L17](../../services/control-api/internal/api/milestones.go#L17); reward table definitions in [services/control-api/internal/models/features.go#L43](../../services/control-api/internal/models/features.go#L43). |
| Emissions API / schedule surface | `GET /v1/tokenomics/emissions` and `GET /v1/rewards/emissions` both return HTTP 404; no emission routes found in control-api route registration. | Planned / Not implemented | High | Runtime checks on 2026-04-01; route registration map in [services/control-api/main.go#L390](../../services/control-api/main.go#L390) through [services/control-api/main.go#L484](../../services/control-api/main.go#L484), with no emissions endpoint present. |

## Practical Takeaway

Today, ProxyHubb has real token-related mechanics (PHB governance gates/weighting, PHB staking endpoints, on-chain-configured fee policy) but still depends on hybrid or DB-authoritative components for important economic flows. The roadmap already defines the next cutover points (PHB gas fees, PHB vault custody, deeper on-chain authority).

## Known Consistency Risk

PHB decimal handling appears inconsistent in current code paths and should be normalized before relying on displayed balances:
- Governance/staking calculations use 9-decimal scaling.
- Explorer wallet PHB display divides raw token balance by 1e6.

References:
- [services/control-api/internal/api/governance.go#L119](../../services/control-api/internal/api/governance.go#L119)
- [services/control-api/internal/api/staking.go#L412](../../services/control-api/internal/api/staking.go#L412)
- [services/control-api/internal/api/explorer.go#L592](../../services/control-api/internal/api/explorer.go#L592)