# Marketplace Phase 3B status (order FSM)

**Last updated:** 2026-07-30  
**Epic:** [#8](https://github.com/samuel-1-avson/ProxySocialHub/issues/8)  
**ADR:** [adr/0006-order-status-fsm.md](../adr/0006-order-status-fsm.md)

## Track 3B workstreams

| WS | Issue | Status | Evidence |
|----|-------|--------|----------|
| **3B-1** Model + ADR | [#21](https://github.com/samuel-1-avson/ProxySocialHub/issues/21) | **Done** | ADR 0006 documents existing `CanTransitionOrderStatus` graph |
| **3B-2** Central Transition + tests | [#22](https://github.com/samuel-1-avson/ProxySocialHub/issues/22) | **Done** | `internal/orders/fsm.TransitionOrder`; activator + escrow listener/cleaner wired |
| **3B-3** Handler/worker integration | [#23](https://github.com/samuel-1-avson/ProxySocialHub/issues/23) | Open | Remaining API handlers (`orders`, `escrow`, `dispute_jury`) |
| **3B-4** Observability | [#24](https://github.com/samuel-1-avson/ProxySocialHub/issues/24) | Open | Illegal transition metrics/alerts |
| **3B-5** Web OrderStatus sync | [#25](https://github.com/samuel-1-avson/ProxySocialHub/issues/25) | Open | Remove TS `\| string`; UI copy for 7 states |

## Known gaps (from ADR)

1. ~~`solana/activator.go` mutates order status without `ValidateOrderStatusTransition`.~~ Fixed in 3B-2 via `fsm.TransitionOrder`.
2. ~~No single `TransitionOrder(tx, id, to, source)` write path yet.~~ `orders/fsm.TransitionOrder` exists; API handlers adopt in 3B-3.
3. DB has no CHECK/enum on `orders.status` (optional follow-up).
