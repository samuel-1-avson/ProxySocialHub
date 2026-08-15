# Evidence: Wave 7.D third-party operator (org boundary) — 2026-08-13

## Verdict

**PASS** — `W7D_JOIN_CLI_OK` (unit / honesty / join CLI).

Live volunteer VPS (`W7D_EXTERNAL_VPS_OK`, `operator_org_diversity=multi_org`)
is **script-ready**, not claimed until
`CONFIRM_W7D_EXTERNAL_VPS=1 ./scripts/gcp-smoke-sprint-w7d-third-party-operator.sh`
runs against a foreign `org_id` in the directory or pinned bundle.

Host-B in `gen-lang-client-0022105784` remains **same_org**.

## Exit claim

An operator outside the platform GCP project can generate a key, sign a
manifest, and publish a bundle without giving ProxyHubb the seed. Platform seed
cannot rotate that pubkey. Honesty reports `same_org` vs `multi_org`.

## Unit proof

```
go test ./internal/gateways/ -count=1 -run 'OrgDiversity|ProtectForeign|HonestyMeta'
# two hosts in platform org => same_org
# distinct org_id => multi_org
# ProtectForeignOperatorKey blocks pubkey/manifest/org overwrite
# honesty operator_org_diversity + foreign_operator_key_rotation=operator_only
```

`W7D_JOIN_CLI_OK` (CLI: `go run ./cmd/w7d-operator-join keygen|sign` then
`w7b-manifest-bundle verify`)

## Changes

| Path | Role |
|------|------|
| `migrations/000151_gateway_operator_org` | `org_id` column |
| `gateways/org.go` | Org diversity + foreign key lock |
| `GET /v1/gateways/operators` honesty | `operator_org_diversity` |
| `cmd/w7d-operator-join` | Local keygen + sign (seed stays with operator) |
| `docs/ops/W7_THIRD_PARTY_OPERATOR.md` | Runbook |
| `scripts/gcp-smoke-sprint-w7d-third-party-operator.sh` | CLI soak + optional VPS |

## Non-claims

- Not DePIN
- Not permissionless join
- Live foreign VPS not claimed in this evidence file
- Session mint issuer may still be control-api
- No live bonded slash
