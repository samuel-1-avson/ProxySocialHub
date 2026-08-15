# ADR 0014 — Bonded gateway slash (Wave 8)

- **Status:** Accepted for D1–D4 localnet soak 2026-08-13 (`W8D_BOND_SLASH_OK`).
  Devnet observe bond claimed 2026-08-14. W11.C release **client** in-repo
  2026-08-14 (live accuse/release soak unclaimed). GCP/mainnet execute unclaimed.
- **Date:** 2026-08-13
- **Related:** ADR 0007, ADR 0012, `WAVE8_DECENTRALIZATION_PLAN.md`, `GATEWAY_OPERATOR_SLASH.md`
- **Non-goals:** DePIN marketing, unsafe `programs/session`, mainnet, staking APY

---

## Context

Wave 6.D can hide unbonded operators and record honeytoken hits. It cannot move
stake. The only existing on-chain slash instruction lives in
`services/solana-programs/proxyhub/programs/session` as `slash_gateway`: admin
signs, percentage applied, lamports to treasury **immediately**. That is why
the session program stays **undeployed** (BC-03/04).

Wave 8 needs a **different program** with a challenge window, not a patched
copy of `slash_gateway`.

## Decision

### D1 — Dedicated `gateway-bond` program

Path: `programs/gateway-bond` (sibling of `programs/reputation`, not inside
the session crate). Instructions:

| Ix | Who | Moves SOL? |
|----|-----|------------|
| `initialize_config` | first admin | no |
| `set_deploy_allowed` | admin | no (`false` at init) |
| `bond` | operator | operator → bond PDA |
| `request_unbond` | operator | no (starts delay) |
| `withdraw_bond` | operator | PDA → operator after delay, no open challenge |
| `accuse` | config.accuser | no |
| `resolve_slash` | admin, after window | bond PDA → treasury (bps cap, rent floor) |
| `resolve_release` | admin; or operator after 2× window | no |

There is **no** `slash_gateway` ix. Session program ID must not be used as
`PROXYHUB_GATEWAY_BOND_PROGRAM_ID`.

### D2 — Safety invariants

1. `challenge_window_secs >= 3600` at init (cannot recreate instant slash).
2. `unbonding_secs >= challenge_window_secs`.
3. `max_slash_bps` in `(0, 10000]`; per-accuse bps cannot exceed it.
4. One open challenge per operator; unbond/withdraw blocked while open.
5. Slash amount = `stake * bps / 10000`; remainder stays on the bond PDA
   above rent-exempt minimum.
6. `deploy_allowed` starts false (same pattern as reputation).

### D3 — Dual-gate off-chain

`PROXYHUB_GATEWAY_SLASH_AUTO` + `PROXYHUB_GATEWAY_SLASH_CONFIRM=1`. Either
missing ⇒ audit row only. Both set but program undeployed ⇒ still no-op.
Honesty `live_economic_slash` stays **false** until a live soak is claimed.

### D4 — Localnet soak claimed; cluster deploy gated

Program ID `7nvrNVaNWcG4DzcPygEyXoVC3k19ePUAncGE25dUEyi5` (keypair gitignored).
Localnet `solana-program-test` soak `W8D_BOND_SLASH_OK` (2026-08-13): window
blocks early slash, then treasury receives `stake * bps / 10000`. Do not deploy
to GCP/mainnet in this ADR. `CONFIRM_W8_DEPLOY=1` is not a mainnet tool.

## Consequences

- Honeytoken path can later call `accuse` instead of only writing Postgres.
- Bond-enforce can eventually key off on-chain `OperatorBond.bonded` (not this
  slice; Postgres `bonded` remains the discovery flag).
- Jury / token-weighted slash is out of scope; admin+accuser+window is the
  honest minimum.
