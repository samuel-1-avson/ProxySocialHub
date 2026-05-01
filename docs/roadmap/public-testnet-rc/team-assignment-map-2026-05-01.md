# Public Testnet RC Team Assignment Map

Date: 2026-05-01

## Evidence Base

- Confirmed Git history identity: `samuel-1-avson` / Samuel Maxwell Obeng Avornyoh
- Documented team handles in [docs/runbooks/README.md](../../runbooks/README.md): `@tech-lead`, `@security`, `@solana-team`
- Documented action-owner handles in [docs/runbooks/security-incident.md](../../runbooks/security-incident.md): `@backend-team`, `@security-team`

## Current Role Mapping

| Placeholder Role | Assigned To | Type | Confidence | Evidence |
| --- | --- | --- | --- | --- |
| Protocol Lead | `samuel-1-avson` | Individual GitHub user | High | Git shortlog plus user confirmation |
| Backend Lead | `samuel-1-avson` | Individual GitHub user | High | Git shortlog plus user confirmation |
| Frontend Lead | `samuel-1-avson` | Individual GitHub user | High | User confirmation |
| Developer Experience Lead | `samuel-1-avson` | Individual GitHub user | High | User confirmation |
| Security Lead | `samuel-1-avson` | Individual GitHub user | High | User confirmation |
| QA/Release Lead | `samuel-1-avson` | Individual GitHub user | High | User confirmation |
| DevOps/SRE Lead | `samuel-1-avson` | Individual GitHub user | High | User confirmation |
| Solana Reviewer | `@solana-team` | Team handle only | Low | Runbook contact only; personal username not found |

## Rebalanced Sprint Allocation

All lead roles now map to `samuel-1-avson`, so rebalance is time-based rather than person-based. The goal is to limit concurrent active workstreams and keep architecture decisions ahead of implementation.

| Window | Primary DRI | Parallel Track | Tickets | Load Note |
| --- | --- | --- | --- | --- |
| Days 1-2 | `samuel-1-avson` | Solana review requested | RC-01 | Keep the sprint on a single architecture decision until the canonical path is locked |
| Days 3-4 | `samuel-1-avson` | None | RC-02, RC-04 | Pair settlement alignment with secret-boundary cleanup while context is still hot |
| Days 5-6 | `samuel-1-avson` | None | RC-06, RC-05 | Handle docs/contract updates before rewriting auth coverage |
| Days 7-8 | `samuel-1-avson` | None | RC-03, RC-07 | Validation harness and web auth tests run as one verification block |
| Days 9-10 | `samuel-1-avson` | Solana review requested | RC-08, RC-09, RC-10 | Finish operator docs, release gate, and secret sweep in the final release-prep window |

## Ticket Assignment Matrix

| Ticket | Primary Assignee | Backup / Reviewer | Current Status | Notes |
| --- | --- | --- | --- | --- |
| RC-01 | `samuel-1-avson` | `@solana-team`, `samuel-1-avson` QA/Release | In Progress | ADR draft started |
| RC-02 | `samuel-1-avson` | `samuel-1-avson` DevOps/SRE | Blocked by RC-01 | Canonical settlement implementation |
| RC-03 | `samuel-1-avson` | `samuel-1-avson` QA/Release, `samuel-1-avson` DevOps/SRE | Blocked by RC-01, RC-02 | End-to-end validation harness |
| RC-04 | `samuel-1-avson` | None | Ready after RC-01 | Secret-boundary cleanup |
| RC-05 | `samuel-1-avson` | `samuel-1-avson` Security Lead | Blocked by RC-04 | Frontend auth hardening |
| RC-06 | `samuel-1-avson` | None | Ready after RC-01 | OpenAPI and integration docs |
| RC-07 | `samuel-1-avson` | `samuel-1-avson` QA/Release | Blocked by RC-05, RC-06 | Playwright auth rewrite |
| RC-08 | `samuel-1-avson` | `@solana-team` | Blocked by RC-01, RC-02, RC-06 | Authority matrix |
| RC-09 | `samuel-1-avson` | `samuel-1-avson` DevOps/SRE | Blocked by RC-02, RC-03, RC-05, RC-07 | Release-gate ownership confirmed |
| RC-10 | `samuel-1-avson` | None | Ready | Secret-hygiene pass assigned |

## Capacity Risk

All lead roles currently map to one GitHub user. That is workable for creating the sprint board and beginning RC-01, but it creates obvious delivery risk for RC-09 and RC-10 in the final release-prep window.

If additional team members become available, rebalance in this order:

1. Move RC-09 to a dedicated QA/Release or DevOps owner.
2. Move RC-10 to a dedicated Security owner.
3. Move RC-05 and RC-07 to a dedicated Frontend owner.
