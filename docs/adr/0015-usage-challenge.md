# ADR 0015 — Usage challenge (Wave 12.A)

- **Status:** Accepted. Slice 1 **client** exists (`cmd/w12a-usage-challenge`);
  no new program. Live usage **release** soak claimed 2026-08-15
  (`W12_A_usage_challenge_soak_20260815.md`). Slash soak unclaimed.
- **Date:** 2026-08-14 (design); slice 1 client 2026-08-15
- **Related:** ADR 0010, ADR 0014, `WAVE10_DEPIN_AND_MARKETPLACE_ROADMAP.md` W12.A,
  `GATEWAY_OPERATOR_SLASH.md`
- **Non-goals:** TEE, R1CS-over-packets, `programs/session`, mainnet, staking APY,
  claiming trustless metering or DePIN

---

## Context

ADR 0010 is still true: the edge remains byte SoT. Groth16 binds a **claimed**
`leaves_hash` (digest-v2), not physical traffic. Settlement receipts
(`PROXYHUB_SETTLEMENT_RECEIPT:v1`) let an auditor reconstruct a window; they do
not let a buyer **dispute** that window on-chain.

Wave 8 / ADR 0014 `programs/gateway-bond` already has accuse → ≥3600s window →
`resolve_slash` or `resolve_release`. That path is **operator misbehavior**
(honeytoken / opaque `evidence_hash`). It is not a usage-leaf dispute.

Escrow Phase B challenge windows are **payment holds**, not metering disputes.

WAVE10 W12.A: a buyer or protocol accuser can open a challenge on a settlement
window / leaf set, reuse the Wave 8 window pattern, **not** session slash, and
resolve after the window: slash bond, clawback pending, or release.

On-chain **lease PDAs** (if ever needed) are a later ADR (**0016+**), not this
number.

## Decision

### D1 — Dispute the claim, not the packets

A usage challenge targets:

- `window_key` (settlement receipt)
- `leaves_hash` (ADR 0010 digest-v2)
- optional receipt signature

It does **not** prove or disprove physical bytes. Forbidden language: “trustless
metering”, “ZK proves real traffic”, “TEE-attested packets”.

Canonical evidence (first slice):

```
evidence_hash = SHA256(
  "PROXYHUB_USAGE_CHALLENGE:v1:"
  || window_key || "|"
  || hex(leaves_hash) || "|"
  || receipt_signature
)
```

### D2 — Reuse Wave 8 window, never session slash

Same invariants as ADR 0014:

- `challenge_window_secs >= 3600`
- one open challenge per operator bond (first slice)
- no lamport move until `clock >= resolve_after` for **slash**
- `resolve_release` does not move stake
- dual-gate any path that sends SOL
  (`PROXYHUB_GATEWAY_SLASH_AUTO` + `PROXYHUB_GATEWAY_SLASH_CONFIRM=1` for bond
  slash; a separate dual-gate for escrow clawback)
- `programs/session` (`8TP21…` `slash_gateway`) stays undeployed

### D3 — Who may open (honest first slice)

WAVE10 wants “buyer or protocol accuser.” `gateway-bond` `accuse` is signed by
`config.accuser` only.

**Slice 1 (no new program):** the buyer files an off-chain petition (signed
receipt + disputed `leaves_hash`). The **protocol accuser** (same pubkey as
Wave 8 `config.accuser`) opens `accuse` with D1 `evidence_hash`. This is not
permissionless buyer-to-chain.

**Slice 2 (new program or ix, later):** a buyer-signed open that does not require
ProxyHubb to be `config.accuser`. Required before calling the product
permissionless. Not this ADR’s code freeze.

### D4 — Resolve outcomes (after the window)

| Outcome | Vehicle | Moves SOL? |
|---------|---------|------------|
| **Release** | `gateway-bond` `resolve_release` | no (rent refund to accuser only) |
| **Slash bond** | `gateway-bond` `resolve_slash` | bond PDA → treasury (bps cap, rent floor) |
| **Clawback pending** | existing escrow / settlement pending | yes — **separate** dual-gate; `WouldBroadcast` stays false until a soak |

Prefer **release** for the first public-cluster soak (W11.C already takes that
shape for operator-misbehavior). A usage-challenge **slash** soak is a distinct
claim and may set `live_economic_slash=true` **for that cluster only** after
evidence. Do not set that flag from this ADR.

### D5 — Honesty

- `live_economic_slash` remains **false** until a claimed slash soak.
- Public copy must still say bytes are gateway-attested.
- A usage challenge that **releases** is not economic slash.
- Not DePIN.

### D6 — Code freeze (this document)

This ADR shipped as design only. W12.A slice 1 after acceptance:

- Off-chain petition + D1 `evidence_hash` (`internal/settlement`)
- Protocol-accuser `accuse` CLI (`cmd/w12a-usage-challenge`)
- **No** new program, ix, or HTTP route
- **No** `resolve_slash` command; prefer `resolve_release` via `w8-gateway-bond`

## Consequences

- W11.C (`accuse` / `resolve_release` client) is the window **vehicle**, not the
  usage dispute UX.
- Slice 1 still has a ProxyHubb-shaped accuser SPOF.
- Metering remains honor-system plus disputable **claims**, not physics.
