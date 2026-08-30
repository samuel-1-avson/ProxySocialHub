# Evidence: D.3 OpenAPI spec route + F.6 CI dead-job cleanup — 2026-08-21

## D.3 — OpenAPI contract reachable from the API host

**Change:** `services/control-api/internal/api/openapi_spec.go` (`RegisterOpenAPISpecRoutes`) +
registration in `main.go`. `/openapi.json` and `/openapi.yaml` 302-redirect to the
repo-authoritative spec hosted by the docs site (`https://docs.proxyhubb.com/openapi.yaml`),
so the spec can never drift between API and docs. Override: `PROXYHUB_OPENAPI_URL`.

**Doc reconciliation:** the phantom routes from the audit (`/v1/nodes`, `/v1/providers`,
`/v1/discovery/browse`) were already doc-dropped — `docs/MARKETPLACE_DISCOVERY_API.md`
explicitly lists them as non-existent, and neither `docs/openapi.yaml` nor the docs site
reference them (grepped). No code routes added; docs and API agree.

**Tests:** `TestOpenAPISpecRoutes_RedirectToDocs`, `TestOpenAPISpecRoutes_EnvOverride` PASS.

**Deploy:** `scripts/gcp-deploy-d3-openapi.sh` on `proxyhubb-testnet`
(project `gen-lang-client-0022105784`), 2026-08-21 13:23 UTC. control-api only —
no `--remove-orphans`, edge-a untouched (started 2026-08-13, unchanged).
Rollback tag: `proxyhubb-control-api:pre-d3-openapi-20260821-1319`.

**Live verification (external):**

| Probe | Result |
|---|---|
| `https://api.proxyhubb.com/openapi.json` | 302 → `https://docs.proxyhubb.com/openapi.yaml` |
| `https://api.proxyhubb.com/openapi.yaml` | 302 → `https://docs.proxyhubb.com/openapi.yaml` |
| `https://docs.proxyhubb.com/openapi.yaml` | 200 |
| `https://api.proxyhubb.com/metrics` (D.1 regression) | 404 (lock intact) |
| `https://api.proxyhubb.com/health` | 200 |

## F.6 — CI dead jobs removed

`.github/workflows/proxyhubb-ci.yml` no longer contains the `packages/contracts` Hardhat job
(or its path filter) and the web `npm test -- --coverage` step (web has no `test` script) is
gone — the frontend job runs lint, `validate:routes`, typecheck, `test:e2e:marketplace`,
build, and the three contract scripts. YAML validated; 16 jobs, no dangling `needs:`.
