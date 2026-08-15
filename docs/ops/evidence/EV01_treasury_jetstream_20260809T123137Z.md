# EV-01 TREASURY JetStream — Testnet evidence

**When:** 2026-08-09T12:31:37Z  
**Host:** `proxyhubb-testnet`  
**Scripts:** `scripts/ops-ev01-treasury-jetstream-smoke.sh`, `scripts/_deploy-ev01-treasury.sh`  
**Result:** `EV01_TREASURY_JETSTREAM_PASS`

## Scope

Audit EV-01: `proxy.treasury.v1.topup` / `proxy.treasury.v1.reconciliation` published with **no JetStream stream** → silent drop.

## Already in code

- `TREASURY` stream (`proxy.treasury.v1.>`, 30d, 500MiB) in `nats/connector.go`
- Durable consumer `treasury-event-consumer` in `worker/treasury_event_consumer.go`
- Lag gauges include `TREASURY` in `nats/metrics.go`

## This close-out

1. Hardened consumer: recreate `Messages()` iterator inside supervised loop (survives reconnect / API restart).
2. Live smoke: publish → stream last seq advances → ack floor catches up → `unprocessed=0`.

## Evidence snapshot

| Check | Result |
|-------|--------|
| Stream subjects | `proxy.treasury.v1.>` |
| Active consumers | 1 (`treasury-event-consumer`) |
| Before | last/ack seq `620` |
| Publish | `proxy.treasury.v1.topup` marker `ev01-smoke-20260809T123137Z` |
| After | last/ack seq `621`, unprocessed `0` |
| Historical backlog | 620+ messages retained since 2026-07-31 (no longer dropped) |

## Not claimed

- Deep side-effects on consume (intentionally log+ack; alerting already via `ops_alerts` / reconciliation path)
- NATS cluster HA
- Fix for control-api restart pressure (observed separately; health recovered for smoke)

## Re-run

```bash
sudo bash /opt/proxyhubb/scripts/ops-ev01-treasury-jetstream-smoke.sh
```
