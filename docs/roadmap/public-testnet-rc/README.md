# Public Testnet RC Issue Import Pack

Date: 2026-05-01

This directory contains import-ready planning artifacts for the public testnet release-candidate sprint.

## Files

- `github-issues.csv`: CSV manifest for bulk issue tracking or script-driven creation
- `create-gh-issues.ps1`: PowerShell wrapper that reads the CSV and creates issues via `gh issue create`
- `team-assignment-map-2026-05-01.md`: current best-evidence assignee map and sprint rebalance
- `issues/RC-01.md` through `issues/RC-10.md`: one issue body per ticket

## Notes

- Confirmed assignee username for all currently mapped lead roles: `samuel-1-avson`.
- Team handles found in repo docs are preserved in the assignment map as reviewer or escalation fallbacks.

## Current RC Reference Set

- [docs/openapi.yaml](../../openapi.yaml) is the only authoritative public API contract for RC review.
- [docs/runbooks/public-testnet-authority-matrix.md](../../runbooks/public-testnet-authority-matrix.md) is the shared RC-08 authority reference for operators, QA, and launch review.
- [docs/runbooks/public-testnet-release-gate.md](../../runbooks/public-testnet-release-gate.md) defines the RC-09 promotion-blocking command set and artifact layout.
- [services/control-api/docs/README.md](../../../services/control-api/docs/README.md) fences the legacy generated Swagger 2.0 tree as non-authoritative.

## Suggested GitHub CLI Flow

Example:

```bash
gh issue create \
  --repo <org>/<repo> \
  --title "[Testnet RC] Decide canonical proof path" \
  --body-file docs/roadmap/public-testnet-rc/issues/RC-01.md \
  --label sprint:testnet-rc \
  --label priority:p0 \
  --label area:protocol \
  --label area:settlement \
  --label type:architecture \
  --assignee samuel-1-avson
```

If the roster changes later, update `team-assignment-map-2026-05-01.md`, `github-issues.csv`, and any issue files that still reference a different assignee model.
