# Evidence: Wave 5.C.1 browse registry hard-filter — 2026-08-12

## Verdict

**PASS** — `W5C_BROWSE_FILTER_OK` + negative proof `W5C_BROWSE_FILTER_NEG_OK` on gcp-testnet.

## Exit claim

`PROXYHUB_BROWSE_REGISTRY_FILTER=enforce` omits listings without PG
`provider_nodes.is_registered_on_chain` from browse/map/detail discovery.
Honesty meta exposes `browse_registry_filter`.

**Does not** claim an on-chain listing PDA index, treasury CPI, credential CONNECT
enforce, or DePIN.

## Live smoke

```
browse_registry_filter=enforce
honesty includes browse_registry_filter=enforce + hard-filter note
W5C_BROWSE_FILTER_OK
```

Negative (ephemeral unregistered listing):

```
unreg_detail_http=404
unreg_omitted_from_browse=yes
W5C_BROWSE_FILTER_NEG_OK
```

## Changes

| Path | Role |
|------|------|
| `internal/decentralization/mode.go` | `BrowseRegistryFilterMode` |
| `internal/api/listings_discovery.go` | Filter + honesty field |
| `internal/api/listings.go` | Browse + detail apply filter |
| `internal/api/marketplace_geo.go` | Geo/map SQL filter |
| `docker-compose.gcp-testnet.yml` | Default `enforce` |
| `scripts/gcp-smoke-sprint-w5c-browse-filter.sh` | Smoke |

## Non-claims

- Not on-chain listing catalog / PDA index
- Delist still platform moderation
- Session activate registry gate unchanged (W3.1)
- Money path still `pending_custody` (treasury CPI later)
- Credential proofs still observe-only on credentials GET
