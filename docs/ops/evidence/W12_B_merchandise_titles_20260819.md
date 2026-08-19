# Evidence: W12.B operator directory titles — 2026-08-19

## Verdict

**PASS** — `W12B_MERCHANDISE_TITLES_OK`.

Titles only on `gateway_operators.display_name`. No CONNECT change. No fake
shop listings / `catalog_products`. Host-A `control-api` was **not** restarted
for this write (`StartedAt` stayed `2026-08-18T22:19:07.846230183Z` until the
later enforce recreate the same day).

The branded shop UI does **not** consume `GET /v1/gateways/operators`. This is
directory merchandising, not a marketplace listing card.

## Titles

| slug | org_id | display_name |
|------|--------|----------------|
| `edge-ext` | `fiffi-500411` | `Fiffi join host (not live CONNECT)` |
| `edge-org3` | `gen-lang-client-0098858574` | `Org-3 join host (not live CONNECT)` |

Live `GET https://api.proxyhubb.com/v1/gateways/operators` returns those
`display_name` values. Buyer URLs on those rows stay documentation; neither
join host runs an edge process.

## Replay

```
bash scripts/gcp-w12b-merchandise-titles.sh   # Host-A, psql only
```

## Non-claims

- Not live CONNECT on `edge-ext` / `edge-org3`
- Not permissionless shop listing
- Not DePIN
