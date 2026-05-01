# ProxyHubb Public Testnet RC Sprint Board

Date: 2026-05-01

Source plan: [PROXYHUBB_TECHNICAL_EVALUATION_2026-05-01.md](PROXYHUBB_TECHNICAL_EVALUATION_2026-05-01.md)

## Sprint Goal

Ship a public-testnet release candidate with:

- one canonical proof and settlement path
- one accurate wallet-first external API contract
- one release-gated validation path across backend, web, and Anchor

## Suggested GitHub Project Board

Use four columns:

- `Ready`
- `Blocked`
- `In Progress`
- `Done`

## Board Cards

| Ticket | Title | Initial Status | Primary Owner | Supporting Roles | Depends On | Target Window | Suggested Labels |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RC-01 | Decide canonical proof path | Ready | Protocol Lead | Backend Lead, QA/Release Lead | None | Days 1-2 | `sprint:testnet-rc`, `priority:p0`, `area:protocol`, `area:settlement`, `type:architecture` |
| RC-02 | Align settlement pipeline to canonical decision | Blocked | Protocol Lead | Backend Lead, DevOps/SRE Lead | RC-01 | Days 3-4 | `sprint:testnet-rc`, `priority:p0`, `area:protocol`, `area:backend`, `area:settlement`, `type:implementation` |
| RC-03 | Prove end-to-end settlement lifecycle | In Progress | Backend Lead | QA/Release Lead, DevOps/SRE Lead | RC-01, RC-02 | Days 7-8 | `sprint:testnet-rc`, `priority:p0`, `area:backend`, `area:qa`, `area:settlement`, `type:validation` |
| RC-04 | Separate gateway auth and session signing secrets | Done | Security Lead | Backend Lead, DevOps/SRE Lead | RC-01 | Days 3-4 | `sprint:testnet-rc`, `priority:p0`, `area:security`, `area:backend`, `type:hardening` |
| RC-05 | Fix browser token and websocket auth handling | Done | Frontend Lead | Security Lead, QA/Release Lead | RC-04 | Days 5-6 | `sprint:testnet-rc`, `priority:p0`, `area:frontend`, `area:security`, `type:implementation` |
| RC-06 | Update OpenAPI and wallet-first integration docs | Blocked | Developer Experience Lead | Backend Lead | RC-01 | Days 5-6 | `sprint:testnet-rc`, `priority:p0`, `area:docs`, `area:backend`, `type:contract` |
| RC-07 | Rewrite stale web auth coverage | In Progress | Frontend Lead | QA/Release Lead | RC-05, RC-06 | Days 5-6 | `sprint:testnet-rc`, `priority:p0`, `area:frontend`, `area:qa`, `type:test` |
| RC-08 | Publish authority matrix | Blocked | Developer Experience Lead | Protocol Lead, Backend Lead | RC-01, RC-02, RC-06 | Days 7-8 | `sprint:testnet-rc`, `priority:p1`, `area:docs`, `area:protocol`, `type:operator-docs` |
| RC-09 | Add release-gated integration matrix | Blocked | QA/Release Lead | DevOps/SRE Lead, Backend Lead, Frontend Lead | RC-02, RC-03, RC-05, RC-07 | Days 9-10 | `sprint:testnet-rc`, `priority:p0`, `area:qa`, `area:devops`, `type:release` |
| RC-10 | Complete secret-hygiene pass | Ready | Security Lead | DevOps/SRE Lead | None | Days 9-10 | `sprint:testnet-rc`, `priority:p1`, `area:security`, `area:devops`, `type:remediation` |

## Current Execution Review

### Path Check

- [x] The current implementation order matches the right sprint path: RC-01 decision, RC-02 settlement convergence, then RC-06 contract alignment.
- [x] The canonical public-testnet settlement decision is documented in [docs/adr/0007-use-canonical-public-testnet-settlement-path.md](docs/adr/0007-use-canonical-public-testnet-settlement-path.md).
- [x] The legacy edge-side Groth16 submission path is now opt-in and default-disabled behind `LEGACY_EDGE_ZK_SUBMISSION_ENABLED`.
- [ ] RC-03 and RC-09 are still open, so release-gated validation is not complete yet.

### OpenAPI Note

- [x] [docs/openapi.yaml](docs/openapi.yaml) is currently serving as the hand-maintained external API contract.
- [x] [docs/openapi.yaml](docs/openapi.yaml) is included in release artifacts today.
- [x] The contract-consolidation decision is now recorded in [docs/adr/0008-use-openapi-as-public-api-contract-source.md](docs/adr/0008-use-openapi-as-public-api-contract-source.md).
- [ ] [docs/openapi.yaml](docs/openapi.yaml) is not currently wired as a runtime source of truth or generated frontend SDK input in this repo.
- [ ] The repo still carries a separate legacy Swagger 2.0 artifact under [services/control-api/docs](services/control-api/docs), so contract consolidation remains outstanding.

### Implemented So Far

- [x] RC-01 decision artifact exists and defines the canonical proof and settlement story.
- [x] RC-02 has started with runtime gating of the non-canonical edge settlement path and default-off configuration.
- [x] RC-06 has materially advanced: wallet-first auth and a large portion of the live public API surface are now reflected in [docs/openapi.yaml](docs/openapi.yaml).
- [x] The contract-source decision has been recorded so RC-03 and RC-07 can use [docs/openapi.yaml](docs/openapi.yaml) as the public validation contract.
- [x] RC-03 now has a committed validation script and runbook, and both unit + integration validation runs emit JSONL artifacts (integration supports chain submission “attempted or simulated” with captured evidence).
- [x] RC-04 has the secret split landed and a dedicated gateway/session secret rotation runbook is now documented under `docs/runbooks/`.
- [x] RC-04 gateway-header rotation has been proven live in non-production: the pre-rotation header now returns `401`, while the rotated header reaches the route and fails later with `404` on a fake intent ID.
- [x] RC-04 session-intent CONNECT proof is now live on the rebuilt `edge-gateway`: the pre-rotation `SESSION_SECRET` token returns `407`, while the rotated token authenticates and reaches provider selection, where it fails later with `503` because no healthy providers are available.
- [x] RC-05 is complete: browser auth no longer persists access or refresh tokens in `localStorage`, websocket/SSE auth no longer relies on query-string tokens, and the focused Chromium auth spec passes locally against `4011`/`18080`.
- [x] The earlier local Playwright failures were environmental: host port `4001` is already occupied by Docker/IPFS, so the repo's local web and Playwright defaults now use `4011`.
- [x] RC-07 auth coverage no longer depends on `/v1/auth/dev/login` and defaults to the current local API port (`18080`).
- [ ] RC-02 is not fully complete until the full control-api settlement path, sequence diagram, and operator validation converge.
- [ ] RC-06 is not fully complete until the contract is externally reviewed and the repo chooses one authoritative API-doc source.

## GitHub Issue Tickets

The following sections are written to be copied into GitHub issues with minimal editing.

<!-- markdownlint-disable MD024 -->

### RC-01 Decide Canonical Proof Path

#### Title

`[Testnet RC] Decide canonical proof path`

#### Owner

- Protocol Lead

#### Supporting Roles

- Backend Lead
- QA/Release Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:protocol`
- `area:settlement`
- `type:architecture`

#### Depends On

- None

#### Issue Body

Choose one canonical proof architecture for public testnet and document how it maps to current code paths, prover ownership, verifier ownership, and on-chain batch semantics.

#### Acceptance Criteria

- [x] One ADR or equivalent decision document is merged.
- [x] The document names one canonical proof system.
- [x] The document states whether public testnet verifies proofs on-chain, verifies off-chain, or commits only.
- [x] Contradictory proof paths are explicitly categorized as active, deprecated, or disabled.
- [ ] Backend Lead and QA/Release Lead approve the decision.

#### Implementation Subtasks

- Protocol
  - [x] Compare the current Halo2 service path, Groth16 gateway path, and commitment-only on-chain semantics.
  - [x] Decide the canonical proof system and verifier boundary for public testnet.
  - [x] Define the authoritative meaning of `submit_zk_batch` for this sprint.
  - [ ] Produce a proof-and-settlement sequence diagram input for engineering.
- Backend
  - [x] Inventory all proof-related code paths in control-api, including the external prover client and local verifier helpers.
  - [ ] Identify which endpoints, workers, and DB states depend on proof status today.
  - [x] Mark non-canonical backend paths for removal, disablement, or explicit non-authoritative status.
  - [ ] Review data-model impacts for usage receipts, settlement manifests, and batch persistence.
- Frontend
  - [ ] Audit explorer and wallet-facing settlement states that assume proof verification versus commitment-only status.
  - [ ] Identify UI copy that must distinguish pending commitment, committed, mirrored, and final states.
  - [ ] Capture any frontend dependency on proof artifacts or batch detail payloads.
  - [ ] Confirm whether UI changes are required for the selected authority model.
- QA
  - [ ] Draft the validation matrix for the chosen proof path.
  - [ ] Define minimum evidence required to call the path release-ready.
  - [ ] Record regression cases for deprecated proof paths that must no longer appear active.
  - [ ] Sign off that the decision is testable with available environments.
- DevOps
  - [ ] Inventory services, env vars, and compose profiles affected by the proof decision.
  - [ ] Confirm whether the external prover remains mandatory for testnet.
  - [ ] Document deployment-order implications of the chosen path.
  - [ ] Identify config cleanup needed once non-canonical paths are disabled.

### RC-02 Align Settlement Pipeline To Canonical Decision

#### Title

`[Testnet RC] Align settlement pipeline to canonical proof decision`

#### Owner

- Protocol Lead

#### Supporting Roles

- Backend Lead
- DevOps/SRE Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:protocol`
- `area:backend`
- `area:settlement`
- `type:implementation`

#### Depends On

- RC-01

#### Issue Body

Refactor the active settlement pipeline so the control-api, gateway, prover path, and chain-facing semantics all reflect the canonical proof decision.

#### Acceptance Criteria

- [ ] Contradictory code paths are removed, disabled, or clearly marked non-authoritative.
- [ ] One end-to-end settlement sequence diagram is merged.
- [ ] Active runtime configuration only exposes the canonical path by default.
- [ ] The backend, gateway, and deployment config all agree on the authoritative flow.

#### Implementation Subtasks

- Protocol
  - [ ] Translate the ADR into an implementation contract for off-chain and on-chain teams.
  - [ ] Confirm the expected state transitions between usage capture, batching, proofing, and commitment.
  - [ ] Define fallback behavior when proof generation or chain submission fails.
  - [ ] Approve the canonical sequence diagram before code freeze.
- Backend
  - [ ] Refactor settlement and batching code to use the chosen proof path only.
  - [x] Remove or feature-flag verifier paths that contradict the chosen architecture.
  - [ ] Normalize settlement state names exposed to API consumers.
  - [ ] Ensure mirrored DB state clearly represents authoritative versus informational fields.
- Frontend
  - [ ] Update settlement-related UI labels and state mapping to the canonical lifecycle.
  - [ ] Hide or feature-flag unsupported proof states from explorer and provider surfaces.
  - [ ] Align client-side assumptions with the updated API payloads.
  - [ ] Verify no dashboard or explorer surface still presents deprecated proof semantics.
- QA
  - [ ] Write validation cases for happy-path, retry, failure, and replay scenarios under the canonical path.
  - [ ] Confirm deprecated paths are not reachable in default runtime config.
  - [ ] Review sequence diagram against actual runtime behavior.
  - [ ] Produce a sign-off checklist for settlement-path convergence.
- DevOps
  - [ ] Update compose files, env templates, and service manifests to favor the canonical path.
  - [ ] Remove unused service dependencies or mark them non-default.
  - [ ] Validate that required prover, Redis, NATS, DB, and Solana dependencies start in the correct order.
  - [ ] Ensure environment examples and deployment scripts match the chosen architecture.

### RC-03 Prove End-To-End Settlement Lifecycle

#### Title

`[Testnet RC] Prove end-to-end settlement lifecycle`

#### Owner

- Backend Lead

#### Supporting Roles

- QA/Release Lead
- DevOps/SRE Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:backend`
- `area:qa`
- `area:settlement`
- `type:validation`

#### Depends On

- RC-01
- RC-02

#### Issue Body

Create a reproducible validation path that demonstrates the settlement lifecycle from session usage to persisted receipts or ledgers, batch or proof generation, chain submission or simulation, and final mirrored state.

#### Acceptance Criteria

- One scripted or test-driven scenario can be run repeatably.
- The run shows session usage recorded and persisted.
- The run shows batch or commitment creation.
- The run shows chain submission attempted or simulated with captured evidence.
- The run shows final mirrored state updated in storage and visible to operators.
- The evidence artifact is attached to the issue or committed to the repo as a runbook reference.

#### Implementation Subtasks

- Protocol
  - [ ] Define the expected authoritative state transition list for the validation scenario.
  - [x] Specify which outputs count as proof of success for public testnet.
  - [x] Confirm the acceptable fallback behavior when chain submission is simulated instead of live.
  - [ ] Review the final evidence artifact for correctness.
- Backend
  - [x] Build or update an integration test, script, or harness that drives the lifecycle from session metering to settlement persistence.
  - [x] Emit machine-readable evidence for session usage, batch creation, submission attempt, and final mirrored state.
  - [ ] Expose any missing debug or operator endpoints needed to verify state transitions.
  - [x] Ensure the scenario is deterministic enough for repeat runs.
- Frontend
  - [ ] Validate that explorer or provider-facing surfaces can display the lifecycle states produced by the scenario.
  - [ ] Add a smoke step or fixture that checks user-visible status changes where applicable.
  - [ ] Verify UI wording matches the canonical settlement semantics.
  - [ ] Confirm no user-facing screen implies stronger finality than the backend actually guarantees.
- QA
  - [x] Convert the lifecycle scenario into a release-check runbook.
  - [x] Capture pass/fail evidence requirements for each phase.
  - [ ] Execute the scenario in the target environment and record findings.
  - [ ] File follow-up defects for any mismatched state transitions or missing observability.
- DevOps
  - [ ] Provide an environment profile that includes DB, Redis, NATS, the canonical prover dependency, and Solana connectivity.
  - [ ] Ensure logs and metrics are retained long enough to support the validation run.
  - [ ] Script environment bring-up and teardown for repeatability.
  - [ ] Verify the scenario can be rerun without manual data repair.

### RC-04 Separate Gateway Auth And Session Signing Secrets

#### Title

`[Testnet RC] Separate gateway auth and session signing secrets`

#### Owner

- Security Lead

#### Supporting Roles

- Backend Lead
- DevOps/SRE Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:security`
- `area:backend`
- `type:hardening`

#### Depends On

- RC-01

#### Acceptance Criteria

- Session-intent signing no longer depends on the same secret used for gateway route auth, or a documented exception with compensating controls is approved.
- Secret names, env examples, and deployment docs are updated.
- Rotation steps are validated in a non-production environment.

### RC-05 Fix Browser Token And Websocket Auth Handling

#### Title

`[Testnet RC] Fix browser token and websocket auth handling`

#### Owner

- Frontend Lead

#### Supporting Roles

- Security Lead
- QA/Release Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:frontend`
- `area:security`
- `type:implementation`

#### Depends On

- RC-04

#### Acceptance Criteria

- Websocket auth no longer relies on long-lived JWTs in the query string.
- Browser token storage has lower exposure than the current `localStorage` pattern.
- Login, refresh, logout, and protected route access pass E2E coverage.

### RC-06 Update OpenAPI And Wallet-First Integration Docs

#### Title

`[Testnet RC] Update OpenAPI and wallet-first integration docs`

#### Owner

- Developer Experience Lead

#### Supporting Roles

- Backend Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:docs`
- `area:backend`
- `type:contract`

#### Depends On

- RC-01

#### Acceptance Criteria

- [x] [docs/openapi.yaml](docs/openapi.yaml) no longer advertises retired email/password auth flows or active admin APIs.
- [x] Wallet-first auth, refresh behavior, and session-intent/gateway flows are documented.
- [ ] At least one engineer outside backend can use the docs to understand the current integration path.

### RC-07 Rewrite Stale Web Auth Coverage

#### Title

`[Testnet RC] Rewrite stale web auth coverage`

#### Owner

- Frontend Lead

#### Supporting Roles

- QA/Release Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:frontend`
- `area:qa`
- `type:test`

#### Depends On

- RC-05
- RC-06

#### Acceptance Criteria

- [x] [apps/web/e2e/auth.spec.ts](apps/web/e2e/auth.spec.ts) validates the wallet-oriented flow or an approved test-mode substitute.
- [x] No references remain to `/v1/auth/dev/login` or the stale `8081` backend assumption.
- [ ] CI or local release validation can run the auth coverage without manual patching (blocked here by a Next/SWC native module issue on Node v24).

### RC-08 Publish Authority Matrix

#### Title

`[Testnet RC] Publish authority matrix`

#### Owner

- Developer Experience Lead

#### Supporting Roles

- Protocol Lead
- Backend Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p1`
- `area:docs`
- `area:protocol`
- `type:operator-docs`

#### Depends On

- RC-01
- RC-02
- RC-06

#### Acceptance Criteria

- The repo contains a concise matrix for escrow, governance, provider heartbeat, settlement, and explorer writes.
- Each flow is labeled DB-authoritative, mirror-only, or chain-required.
- QA and operator docs both reference the same matrix.

### RC-09 Add Release-Gated Integration Matrix

#### Title

`[Testnet RC] Add release-gated integration matrix`

#### Owner

- QA/Release Lead

#### Supporting Roles

- DevOps/SRE Lead
- Backend Lead
- Frontend Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p0`
- `area:qa`
- `area:devops`
- `type:release`

#### Depends On

- RC-02
- RC-03
- RC-05
- RC-07

#### Acceptance Criteria

- One documented command set or CI workflow runs the backend integration slice, the web E2E slice, and the Anchor test slice.
- Release candidate status is blocked when any slice fails.
- The release gate produces logs or artifacts that make triage possible.

### RC-10 Complete Secret-Hygiene Pass

#### Title

`[Testnet RC] Complete secret-hygiene pass`

#### Owner

- Security Lead

#### Supporting Roles

- DevOps/SRE Lead

#### Labels

- `sprint:testnet-rc`
- `priority:p1`
- `area:security`
- `area:devops`
- `type:remediation`

#### Depends On

- None

#### Acceptance Criteria

- High-confidence secret findings are triaged into true positives, accepted false positives, or rotated credentials.
- Any real credentials found in active config or artifacts are replaced and documented.
- The team has one tracked secret inventory and remediation record for this sprint.

<!-- markdownlint-enable MD024 -->

## Ready-To-Assign Summary

If the team wants to start immediately, this is the recommended initial assignment split:

- Protocol Lead: RC-01, RC-02
- Backend Lead: RC-02, RC-03, RC-04 support, RC-06 support
- Frontend Lead: RC-05, RC-07, RC-02 support, RC-03 support
- QA/Release Lead: RC-01 support, RC-03, RC-07 support, RC-09
- DevOps/SRE Lead: RC-02 support, RC-03 support, RC-04 support, RC-09, RC-10 support
- Security Lead: RC-04, RC-05 support, RC-10
- Developer Experience Lead: RC-06, RC-08

## Definition Of Done For Sprint Planning

Do not mark this sprint green unless:

- RC-01 through RC-09 are complete or explicitly descoped by leadership
- the settlement lifecycle has one reproducible validation run
- the web auth story, docs, and tests all match the wallet-first model
- the release gate can block promotion automatically or through a documented manual check
