# Explorer release verification

Checklist before merging explorer remediation PRs or tagging a release. Run against **staging** with real indexer data when possible.

## Environment

- [ ] `FULL_DECENTRALIZATION` on and off: `/v1/explorer/metrics` behaves per gate config
- [ ] `EXPLORER_METRICS_INTERVAL` job running; `explorer_metrics` rows exist for `solana` / `hourly`
- [ ] Migration `000089_explorer_orphan_partial_indexes` applied (`\d explorer_transactions` shows partial indexes)

## API truth

- [ ] `GET /v1/explorer/metrics`: `active_wallets` matches distinct tx addresses (24h), not wallet table count
- [ ] `transactions_per_second` includes `tps_window_hours: 24`
- [ ] `GET /v1/explorer/bandwidth?period=24h`: `last_24h_bandwidth_gb` from usage records; `total_bandwidth_gb` cumulative
- [ ] `avg_throughput_mbps` > 0 when usage exists in period
- [ ] Public node/tx lists exclude `is_orphaned = true`
- [ ] No provider PII in public DTOs (grep response for internal IDs if needed)

## WebSocket

- [ ] Connect to `/v1/explorer/ws`; receive block/tx updates without auth
- [ ] Rate limit / message size limits do not break normal dashboard load

## Frontend smoke

- [ ] `/explorer` dashboard loads; metric subs mention 24h TPS and cumulative bandwidth
- [ ] `/explorer/search`: tx sig (64–90 chars), contract, nodes query → correct routes
- [ ] `/explorer/nodes?q=...` server search works
- [ ] Leaderboard links from nodes page open `?category=uptime` / `?category=bandwidth`
- [ ] `/explorer/contracts` uses shared API client (no raw `fetch`)
- [ ] Map and analytics pages load without console errors

## Automated

- [ ] `cd services/control-api && go test ./internal/api/...`
- [ ] Web CI / `npm run build` (or project equivalent) for `apps/web`

## Sign-off

| Role | Date | Notes |
|------|------|-------|
| | | |
