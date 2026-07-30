# Order FSM observability (Phase 3B-4)

**ADR:** [adr/0006-order-status-fsm.md](./adr/0006-order-status-fsm.md)  
**Code:** `services/control-api/internal/orders/fsm`

## Metrics

| Metric | Labels | Meaning |
|--------|--------|---------|
| `proxyhubb_order_status_transitions_total` | `result`, `from`, `to`, `source` | Attempt count. `result` ∈ `ok` \| `invalid` \| `db_error` |
| `proxyhubb_order_status_transition_duration_seconds` | `result`, `source` | Validate + persist latency |

`from=empty` is used for create-time checks (`AssertCreatableStatus`).  
`source` identifies the caller (e.g. `api.escrow.release`, `worker.escrow_listener.init`, `solana.activator.settled`).

## Logs

Illegal transitions emit structured warnings:

```text
level=warn msg="order status transition rejected" from=... to=... source=...
```

DB write failures use `level=error` with `order_id`.

## Staging alert

Prometheus rule: `infra/prometheus/alerts/control-api-order-fsm.yml`

- **Alert:** `OrderStatusIllegalTransitions`
- **Expr:** `sum(rate(proxyhubb_order_status_transitions_total{result="invalid"}[5m])) > 0.05` for 10m

Ensure the control-api scrape job loads that rule file (same include path as `edge-gateway.yml`).

## Operator checks

```promql
# Top illegal edges
sum by (from, to, source) (rate(proxyhubb_order_status_transitions_total{result="invalid"}[15m]))

# Success vs reject ratio
sum by (result) (rate(proxyhubb_order_status_transitions_total[15m]))
```
