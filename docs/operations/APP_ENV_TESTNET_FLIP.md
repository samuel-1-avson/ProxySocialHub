# APP_ENV Flip: staging → testnet (Custody Enforcement)

## Why

The testnet stack currently boots `control-api` with `APP_ENV=staging`,
hardcoded in the compose overlays. `staging` enforces custody (KEK, KMS
strictness) but also keeps two unauthenticated admin POST routes registered
(`internal/api/system.go`):

- `POST /v1/system/geoip/backfill`
- `POST /v1/system/map/links/aggregate`

`APP_ENV=testnet` is a strict environment everywhere it matters
(`internal/custody/kek.go`, `internal/solana/client.go`,
`internal/solana/kms_gcp.go`: production/prod/staging/testnet all enforce)
while closing those two routes. The flip keeps fail-closed custody and
removes the staging-only admin surface. A `.env` setting is ignored: explicit
`environment:` entries in the overlay win, so the flip must edit the overlay
files.

## Scope

Two overlay files pin the value for `control-api`; this branch flips both:

- `docker-compose.testnet.yml`: `- APP_ENV=testnet`
- `docker-compose.gcp-testnet.yml`: `- APP_ENV=testnet`

No other value changes. The deployed VM stack (`proxyhubb-testnet`) uses the
GCP overlay; both files change so a file swap can never silently re-open
the staging routes.

Several predicates matched `staging` but not `testnet`; without fixes the
flip would have weakened them. This branch adds `testnet` alongside
`staging` in:

- `internal/treasury/addresses.go` (`isStagingEnv`): hot min/max/replenish
  fallbacks and top-up cap tier (staging 5/50/15/200 vs dev 0.1/10/2/50).
- `internal/treasury/treasury_manager.go` (`GetThresholds`): staging
  threshold tier.
- `internal/decentralization/mode.go` (`DepositRequireFinalized`): deposit
  verification stays at `finalized` when the env override is unset.
- `internal/models/ledger_journal.go`: missing-table check stays fail-closed.
- `internal/solana/client.go`: AWS KMS strictness (deployment uses GCP KMS,
  but the predicate now matches everywhere else).

Deliberately untouched: `orders_dev_activate.go` (dead switch, identical
either way), `session.go` (covered by hardcoded `GIN_MODE=release`),
`system.go` (closing those routes is the point of the flip).

## Behavior changes

- Custody stays enforcing: local KEK refused, KMS init failures fail closed,
  hot-signer strictness unchanged.
- The two POST routes above stop being registered (404). If any automation
  calls them, run the underlying jobs before the flip; do not re-add the
  routes.
- `GET /health` / boot logs will report `testnet`; update any monitor that
  matches on `staging`.

## Rollout

1. Merge this branch; rebuild + redeploy `control-api` on `proxyhubb-testnet`
   from the merged commit.
2. Live-verify on the VM:
   - `docker compose logs control-api | head`: boot line shows testnet, no
     KMS/mock fallback warnings.
   - `curl -s https://api.proxyhubb.com/health` (or the VM health port):
     healthy.
   - `curl -s -o /dev/null -w '%{http_code}' -X POST
     https://api.proxyhubb.com/v1/system/geoip/backfill` → `404`.
   - Run the gate from `services/control-api` with the deployed env:
     `APP_ENV=testnet go run ./cmd/preflight -web-env /path/to/web.env`
     → all checks PASS (WARN allowed, no FAIL).
3. Keep `APP_ENV` unset in `.env` (by design: the overlay is the source of
   truth). At mainnet cutover the overlays flip to `APP_ENV=production`.

## Rollback

Revert the two lines to `- APP_ENV=staging`, redeploy `control-api`.
Rollback re-opens the two admin POST routes; that is the only security
delta versus the flipped state.
