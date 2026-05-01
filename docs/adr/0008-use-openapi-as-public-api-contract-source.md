# ADR 0008: Use OpenAPI As Public API Contract Source

## Status

Proposed

## Context

ProxyHubb currently carries two parallel API documentation tracks:

- [docs/openapi.yaml](../openapi.yaml) is the hand-maintained OpenAPI 3.1 contract that is being aligned to the live public control-api routes and is included in release artifacts.
- [services/control-api/docs](../../services/control-api/docs) contains generated Swagger 2.0 artifacts from `swaggo/swag`, but those files are stale, generic in places, and are not wired into the current runtime or frontend build as the public integration contract.

That split creates a contract-governance problem:

- external builders can be shown one contract while backend-generated artifacts imply another
- RC-06 can appear complete while the repo still contains multiple competing API specs
- RC-03 and RC-07 validation work can be blocked by uncertainty about which payloads and endpoints are authoritative

The public testnet release candidate needs one explicit contract file for public API review and downstream validation, even if runtime route registration remains the ultimate behavioral source of truth.

## Decision

For the public testnet release-candidate sprint, ProxyHubb will use the following API-contract policy:

1. [docs/openapi.yaml](../openapi.yaml) is the only authoritative public API contract document for RC work, release artifacts, frontend integration review, and QA contract validation.
2. [services/control-api/docs](../../services/control-api/docs) is a legacy generated Swagger 2.0 artifact and is non-authoritative for public API consumers.
3. Runtime behavior continues to be defined by the live backend route and handler code until a later step wires contract generation or contract tests into build validation.
4. RC-06 should continue aligning [docs/openapi.yaml](../openapi.yaml) to active public routes, but should stop expanding surface area purely for coverage until this contract-source decision is recorded.
5. RC-03 and RC-07 should treat [docs/openapi.yaml](../openapi.yaml) as the contract reference for validation work unless this ADR is amended.

## Consequences

### Positive

- Engineering, QA, and frontend work now have one explicit public contract file to target.
- RC-06 can be judged against a single artifact instead of a vague documentation goal.
- Release artifacts continue shipping the same contract that the repo is actively curating.
- RC-03 settlement validation and RC-07 auth validation can proceed without waiting for full doc-generation automation.

### Negative

- [docs/openapi.yaml](../openapi.yaml) remains manually maintained for now, so drift risk still exists until generation or contract tests are added.
- The generated Swagger 2.0 tree still exists in the repo and may confuse contributors until it is retired or clearly fenced off.
- This decision does not yet make OpenAPI the runtime source of truth.

## Alternatives Considered

### Option 1: Keep both OpenAPI and generated Swagger active until later

- **Pros**: No immediate repo cleanup or decision pressure.
- **Cons**: Continues the exact ambiguity blocking RC-06 completion and weakens QA confidence.
- **Decision**: Rejected.

### Option 2: Make generated Swagger 2.0 the public contract again

- **Pros**: Leans on an existing generated artifact.
- **Cons**: The current generated tree is stale, lower fidelity than the updated OpenAPI spec, and not aligned to the wallet-first RC work.
- **Decision**: Rejected.

### Option 3: Make OpenAPI the public contract now, then automate later

- **Pros**: Unblocks current sprint work immediately while preserving a path to future SDK generation and contract tests.
- **Cons**: Still requires disciplined manual updates until automation lands.
- **Decision**: Accepted for the release-candidate sprint.

## Implementation Notes

- Treat [docs/openapi.yaml](../openapi.yaml) as the review artifact for RC-06, RC-03, and RC-07.
- Do not add new public consumers of [services/control-api/docs](../../services/control-api/docs).
- Future contract-consolidation follow-up should do one of the following, but not both:
  - generate frontend clients and contract tests from [docs/openapi.yaml](../openapi.yaml), or
  - generate the public OpenAPI contract from backend route definitions and replace manual maintenance.
- When the follow-up lands, either remove [services/control-api/docs](../../services/control-api/docs) from active use or clearly mark it deprecated.

## References

- [docs/openapi.yaml](../openapi.yaml)
- [services/control-api/docs](../../services/control-api/docs)
- [PROXYHUBB_PUBLIC_TESTNET_RC_SPRINT_BOARD_2026-05-01.md](../../PROXYHUBB_PUBLIC_TESTNET_RC_SPRINT_BOARD_2026-05-01.md)
- [SYSTEM_WORKFLOW_V2_BLUEPRINT.md](../../SYSTEM_WORKFLOW_V2_BLUEPRINT.md)
- [SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md](../../SYSTEM_WORKFLOW_V2_IMPLEMENTATION_ROADMAP.md)
